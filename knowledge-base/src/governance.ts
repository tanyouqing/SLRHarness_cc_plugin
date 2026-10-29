import {pool,transaction,type DB} from './db.js';
import * as store from './store.js';
import {hash,keywords} from './domain.js';
import {prepare,vectorSql,type Prepared} from './embedding.js';
import {govern} from './agents.js';
import {feedbackSchema,checkIdentity,assertVersion} from './governance-domain.js';

export async function event(db:DB,id:string,jobId:string|null,kind:string,detail:unknown) {
  await db.query('INSERT INTO strategy_events(entity_id,job_id,event,detail) VALUES($1,$2,$3,$4)',[id,jobId,kind,JSON.stringify(detail)]);
}
export async function reportFeedback(raw:unknown) {
  const input=feedbackSchema.parse(raw),fingerprint=hash(input);
  return transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`feedback:${fingerprint}`]);
    const record=(await db.query(`SELECT e.kind,r.content FROM entities e JOIN revisions r ON r.entity_id=e.id
      AND r.revision=$2 WHERE e.id=$1 FOR SHARE OF e`,[input.strategy_id,input.revision])).rows[0];
    if(!record||record.kind!=='experience'||record.content.role!==input.context.role)throw new Error('feedback strategy/revision/role mismatch');
    if(input.related_feedback_id) {
      const related=(await db.query('SELECT entity_id FROM strategy_feedback WHERE id=$1',[input.related_feedback_id])).rows[0];
      if(related?.entity_id!==input.strategy_id)throw new Error('feedback related record mismatch');
    }
    const previous=(await db.query('SELECT id,job_id FROM strategy_feedback WHERE fingerprint=$1',[fingerprint])).rows[0];
    if(previous)return {status:'duplicate',feedback_id:previous.id,job_id:previous.job_id};
    const job=(await db.query("INSERT INTO jobs(kind,payload) VALUES('feedback',$1) RETURNING id",[JSON.stringify({entity_id:input.strategy_id,input})])).rows[0];
    const row=(await db.query('INSERT INTO strategy_feedback(fingerprint,entity_id,revision,input,job_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [fingerprint,input.strategy_id,input.revision,JSON.stringify(input),job.id])).rows[0];
    await event(db,input.strategy_id,job.id,'feedback_received',{feedback_id:row.id,input});
    return {status:'accepted',feedback_id:row.id,job_id:job.id};
  });
}
// Called within ingestion's publication transaction, so receipt and recheck are atomic.
export async function enqueueRecheck(db:DB,id:string,input:unknown,key:string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recheck:${key}`]);
  const existing=(await db.query("SELECT id FROM jobs WHERE kind='feedback' AND payload->>'recheck_key'=$1",[key])).rows[0];
  if(existing)return existing.id;
  const row=(await db.query("INSERT INTO jobs(kind,payload) VALUES('feedback',$1) RETURNING id",[JSON.stringify({entity_id:id,input,recheck_key:key,reactivation:true})])).rows[0];
  await event(db,id,row.id,'recheck_requested',input);return row.id;
}
async function snapshot(id:string) {return store.read('experience',id);}
async function lockedRecord(db:DB,job:store.Job,p:any) {
  await store.lockJob(db,job);
  const row=(await db.query('SELECT * FROM entities WHERE id=$1 FOR UPDATE',[job.payload.entity_id])).rows[0];
  assertVersion(row,p.snapshot);return row;
}
async function commit(job:store.Job,p:any,fn?:(db:DB,row:any)=>Promise<void>) {
  await transaction(async db=>{
    const row=await lockedRecord(db,job,p);if(fn)await fn(db,row);
    await db.query('UPDATE jobs SET checkpoint=$2 WHERE id=$1',[job.id,JSON.stringify(p)]);
  });
}
async function transition(db:DB,id:string,status:string,reason:string|null,detail:string,jobId:string|null) {
  await db.query(`UPDATE entities SET strategy_status=$2,status_reason=$3,status_detail=$4,status_version=status_version+1,
    status_updated_at=now(),updated_at=now(),activity_started_at=CASE WHEN $2='active' THEN now() ELSE activity_started_at END,
    last_retrieved_at=CASE WHEN $2='active' THEN NULL ELSE last_retrieved_at END WHERE id=$1`,[id,status,reason,detail]);
  await event(db,id,jobId,'status_changed',{status,reason,detail});
}
async function finish(job:store.Job,p:any,result:any) {
  await transaction(async db=>{
    await lockedRecord(db,job,p);
    await event(db,job.payload.entity_id,job.id,'feedback_completed',result);
    await db.query("UPDATE jobs SET status='succeeded',result=$2,checkpoint=$3,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
      [job.id,JSON.stringify(result),JSON.stringify(p)]);
  });
}
async function applyAssessment(job:store.Job,p:any) {
  await commit(job,p,async(db,row)=>{
    const decision=p.assessment;
    await event(db,row.id,job.id,'assessment',decision);
    if(decision.action==='disable'||decision.action==='revise') {
      await transition(db,row.id,decision.action==='disable'?'disabled':'need_revised',decision.action==='disable'?'low_utility':'process_conflict',decision.reason,job.id);
      p.snapshot={...p.snapshot,status_version:row.status_version+1,strategy_status:decision.action==='disable'?'disabled':'need_revised',status_reason:decision.action==='disable'?'low_utility':'process_conflict',status_detail:decision.reason};
    }
    p.phase=decision.action==='revise'?'draft':decision.action==='reactivate'?'verify':'finish';
    if(decision.action==='reactivate'&&!job.payload.reactivation)throw new Error('feedback cannot request unsolicited reactivation');
  });
}
async function saveDraft(job:store.Job,p:any) {
  await commit(job,p,async(db,row)=>{
    checkIdentity(p.snapshot.content,p.draft.content);
    const result=(await db.query(`INSERT INTO strategy_drafts(entity_id,job_id,base_revision,status_version,content,reason)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(job_id,status_version) DO NOTHING RETURNING id`,
      [row.id,job.id,row.current_revision,row.status_version,JSON.stringify(p.draft.content),p.draft.reason])).rows[0];
    p.draftId=result?.id??(await db.query('SELECT id FROM strategy_drafts WHERE job_id=$1 AND status_version=$2',[job.id,row.status_version])).rows[0].id;p.phase='verify';
    await event(db,row.id,job.id,'draft_created',{draft_id:p.draftId,reason:p.draft.reason});
  });
}
async function activate(job:store.Job,p:any,encoded?:Prepared) {
  await transaction(async db=>{
    const row=await lockedRecord(db,job,p);let revision=row.current_revision;
    if(p.draft?.content) {
      const content=p.draft.content;checkIdentity(p.snapshot.content,content);
      await store.validateExperienceRole(db,content,p.snapshot.sources??[]);
      if(!encoded)throw new Error('embedding required before activation');
      revision=(await db.query('SELECT COALESCE(MAX(revision),0)+1 AS n FROM revisions WHERE entity_id=$1',[row.id])).rows[0].n;
      await db.query('INSERT INTO revisions(entity_id,revision,content,content_hash) VALUES($1,$2,$3,$4)',[row.id,revision,JSON.stringify(content),hash(content)]);
      for(const [i,c] of encoded.chunks.entries())await db.query(`INSERT INTO search_chunks(entity_id,revision,ordinal,location,text,keywords,embedding,model_version)
        VALUES($1,$2,$3,$4,$5,to_tsvector('simple',$6),$7,$8)`,[row.id,revision,i,JSON.stringify(c.location),c.text,keywords([content.task,c.text].filter(Boolean).join('\n')),vectorSql(c.embedding),encoded.model_version]);
      await db.query('UPDATE entities SET current_revision=$2 WHERE id=$1',[row.id,revision]);
    }
    await transition(db,row.id,'active',null,p.verification.reason,job.id);
    await event(db,row.id,job.id,'verification_passed',{...p.verification,draft_id:p.draftId??null,revision});
    await db.query("UPDATE jobs SET status='succeeded',result=$2,checkpoint=$3,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
      [job.id,JSON.stringify({id:row.id,revision,status:'active',outcome:'verified'}),JSON.stringify(p)]);
  });
}
export const governanceDependencies={original:(id:string,revision:number)=>store.read('experience',id,revision),snapshot,commit,applyAssessment,saveDraft,activate,finish,govern,prepare,
  checkpoint:store.checkpoint,defer:store.defer};
export async function processFeedback(job:store.Job,deps=governanceDependencies) {
  let p=structuredClone(job.checkpoint??{});
  const current=await deps.snapshot(job.payload.entity_id);
  if(p.snapshot&&(p.snapshot.status_version!==current.status_version||p.snapshot.current_revision!==current.current_revision))p={};
  if(!p.snapshot){p={phase:'assess',snapshot:current};await deps.checkpoint(job,p);}
  const context={feedback:job.payload.input,reactivation:!!job.payload.reactivation,record:p.snapshot,
    assessment:p.assessment,draft:p.draft,original:job.payload.input?.revision?await deps.original(current.id,job.payload.input.revision):null};
  if(p.phase==='assess') {
    p.assessment=await deps.govern('assess',context);p.phase='apply';await deps.commit(job,p);
    await deps.applyAssessment(job,p);
    if(p.phase==='finish')await deps.finish(job,p,{id:current.id,status:p.snapshot.strategy_status,outcome:p.assessment.action,reason:p.assessment.reason,evidenceNeeded:p.assessment.evidenceNeeded??[]});
    else await deps.defer(job);return;
  }
  if(p.phase==='apply'){await deps.applyAssessment(job,p);await deps.defer(job);return;}
  if(p.phase==='draft') {
    p.draft=await deps.govern('draft',context);p.phase='save_draft';await deps.commit(job,p);
  }
  if(p.phase==='save_draft') {
    if(!p.draft.content){await deps.finish(job,p,{id:current.id,status:p.snapshot.strategy_status,outcome:'needs_evidence',reason:p.draft.reason});return;}
    await deps.saveDraft(job,p);await deps.defer(job);return;
  }
  if(p.phase==='verify') {
    p.verification=await deps.govern('verify',context);p.phase='publish';await deps.commit(job,p);
  }
  if(p.phase==='publish') {
    if(!p.verification.approved){await deps.finish(job,p,{id:current.id,status:p.snapshot.strategy_status,outcome:'verification_rejected',reason:p.verification.reason});return;}
    const encoded=p.draft?.content?await deps.prepare('experience',p.draft.content):undefined;
    await deps.activate(job,p,encoded);return;
  }
  if(p.phase==='finish')await deps.finish(job,p,{id:current.id,status:p.snapshot.strategy_status,outcome:p.assessment.action,reason:p.assessment.reason});
}
export function inactivityConfig() {
  const days=Number(process.env.KB_INACTIVITY_DAYS??90);
  if(!Number.isInteger(days)||days<1)throw new Error('KB_INACTIVITY_DAYS must be a positive integer');
  return {enabled:process.env.KB_INACTIVITY_ENABLED!=='false',days};
}
export async function sweepInactive() {
  const cfg=inactivityConfig();if(!cfg.enabled)return {disabled:true};
  return transaction(async db=>{
    const scheduler=(await db.query('SELECT inactivity_checked_at FROM worker_scheduler WHERE id=true FOR UPDATE')).rows[0];
    if(scheduler.inactivity_checked_at&&Date.now()-new Date(scheduler.inactivity_checked_at).getTime()<86400000)return {checked:0};
    const rows=(await db.query(`SELECT id FROM entities WHERE kind='experience' AND strategy_status='active' AND NOT inactivity_exempt
      AND GREATEST(activity_started_at,COALESCE(last_retrieved_at,activity_started_at))<=now()-COALESCE(inactivity_days,$1)*interval '1 day'
      FOR UPDATE`,[cfg.days])).rows;
    for(const row of rows)await transition(db,row.id,'disabled','inactive','No external strategy search exposure within configured period',null);
    await db.query('UPDATE worker_scheduler SET inactivity_checked_at=now() WHERE id=true');return {disabled:rows.length};
  });
}
export async function history(id:string) {
  return {record:await snapshot(id),events:(await pool.query('SELECT * FROM strategy_events WHERE entity_id=$1 ORDER BY created_at,id',[id])).rows,
    drafts:(await pool.query('SELECT * FROM strategy_drafts WHERE entity_id=$1 ORDER BY created_at,id',[id])).rows,
    revisions:(await pool.query('SELECT revision,content,created_at FROM revisions WHERE entity_id=$1 ORDER BY revision',[id])).rows};
}
export async function setInactivity(id:string,days:number|null,exempt:boolean,reason:string) {
  if(days!==null&&(!Number.isInteger(days)||days<1)||!reason.trim())throw new Error('invalid inactivity policy');
  return transaction(async db=>{
    const row=(await db.query("UPDATE entities SET inactivity_days=$2,inactivity_exempt=$3 WHERE id=$1 AND kind='experience' RETURNING id",[id,days,exempt])).rows[0];
    if(!row)throw new Error('record not found');await event(db,id,null,'inactivity_policy',{days,exempt,reason});return row;
  });
}
export async function requestReactivation(id:string,reason:string) {
  if(!reason.trim())throw new Error('reactivation requires evidence/reason');
  return transaction(async db=>{
    const row=(await db.query("SELECT * FROM entities WHERE id=$1 AND kind='experience' FOR UPDATE",[id])).rows[0];
    if(!row)throw new Error('record not found');
    return {job_id:await enqueueRecheck(db,id,{operator:true,reason},hash({id,reason,status_version:row.status_version}))};
  });
}
