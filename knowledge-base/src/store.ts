import {currentPolicy,policyOf,type Policy} from './policy.js';
import { trajectoryInput, assemble, sha256, type TrajectoryMetadata } from './trajectory.js';
import { pool, transaction, type DB } from './db.js';
import { config } from './config.js';
import { canonical, hash, validateTrajectory, keywords, normalizeDoi, normalizeArxiv, fuse, type Kind, type Payload, type Source, type Paper, type Experience, type Decision } from './domain.js';
import { queryVector, vectorSql, type Prepared } from './embedding.js';
import { sourceRole, assertExperienceRole } from './roles.js';
import {distillationProgress} from './consolidation-state.js';

export async function validateExperienceRole(db: DB, content: Payload, sources: Source[]) {
  if (!('sourceType' in content) || content.sourceType === 'review') return;
  if (!sources.length) throw new Error('trajectory experience requires sources');
  for (const id of [...new Set(sources.map(s => s.id))].sort()) {
    const row = (await db.query('SELECT id,distillation_blocked_reason FROM trajectories WHERE id=$1 FOR SHARE',[id])).rows[0];
    if (!row) throw new Error('trajectory source unavailable');
    const origins = (await db.query('SELECT metadata FROM trajectory_origins WHERE trajectory_id=$1',[id])).rows.map(r => r.metadata);
    assertExperienceRole(content,sourceRole(origins));
  }
}

export async function validateSources(db: DB, sources: Source[]) {
  for (const source of sources) {
    const row = (await db.query('SELECT line_count FROM trajectories WHERE id=$1', [source.id])).rows[0];
    if (!row) throw new Error(`source trajectory not found: ${source.id}`);
    if (source.event_range && source.event_range.end > row.line_count) throw new Error('source range exceeds trajectory');
  }
}
export async function addSources(db: DB, id: string, sources: Source[]) {
  await validateSources(db, sources);
  for (const s of sources) await db.query('INSERT INTO experience_sources(experience_id,trajectory_id,start_line,end_line) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id,s.id,s.event_range?.start ?? null,s.event_range?.end ?? null]);
}
export async function sourcesFor(id: string, db: DB = pool): Promise<Source[]> {
  const rows = (await db.query('SELECT * FROM experience_sources WHERE experience_id=$1 ORDER BY trajectory_id,start_line NULLS FIRST', [id])).rows;
  return rows.map(r => ({ type:'trajectory', id:r.trajectory_id, ...(r.start_line ? {event_range:{start:r.start_line,end:r.end_line}} : {}) }));
}
export async function submit(kind: Kind, content: Payload, sources: Source[] = [],options:{policyVersion?:Policy;parentJob?:Job}={}) {
  const fingerprint = hash(content);
  return transaction(async db => {
    if(options.parentJob)await lockJob(db,options.parentJob);
    const policyVersion=policyOf({policyVersion:options.policyVersion??currentPolicy});
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${kind}:${fingerprint}`]);
    await validateSources(db, sources);
    await validateExperienceRole(db, content, sources);
    const existing = (await db.query('SELECT * FROM ingestions WHERE kind=$1 AND content_hash=$2', [kind,fingerprint])).rows[0];
    if (existing) {
      if (existing.entity_id) {
        if (kind === 'experience') await addSources(db,existing.entity_id,sources);
        return { status:'duplicate', id:existing.entity_id, job_id:existing.job_id };
      }
      // Lock prevents losing new evidence while the worker publishes the result.
      const job = (await db.query('SELECT payload,status,result FROM jobs WHERE id=$1 FOR UPDATE', [existing.job_id])).rows[0];
      if (job.status === 'succeeded') {
        const id = job.result.ids[0];
        if (kind === 'experience') await addSources(db,id,sources);
        return {status:'duplicate',id,job_id:existing.job_id};
      }
      const merged = [...new Map([...job.payload.sources,...sources].map((s: Source) => [canonical(s),s])).values()];
      await db.query("UPDATE jobs SET payload=jsonb_set(payload,'{sources}',$2::jsonb) WHERE id=$1", [existing.job_id,JSON.stringify(merged)]);
      return { status:'pending', id:null, job_id:existing.job_id };
    }
    const same = (await db.query('SELECT e.id FROM entities e JOIN revisions r ON r.entity_id=e.id AND r.revision=e.current_revision WHERE e.kind=$1 AND r.content_hash=$2 LIMIT 1',[kind,fingerprint])).rows[0];
    if (same) {
      if (kind === 'experience') await addSources(db,same.id,sources);
      return {status:'duplicate',id:same.id,job_id:null};
    }
    const job = (await db.query("INSERT INTO jobs(kind,payload) VALUES('ingest',$1) RETURNING id", [JSON.stringify({kind,content,sources,fingerprint,policyVersion})])).rows[0];
    await db.query('INSERT INTO ingestions(kind,content_hash,job_id) VALUES($1,$2,$3)',[kind,fingerprint,job.id]);
    return { status:'pending', id:null, job_id:job.id };
  });
}
async function persistTrajectory(db:DB,content:string,metadata?:TrajectoryMetadata) {
  const lines=validateTrajectory(content),fingerprint=hash(lines.map(l=>JSON.parse(l)));
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`trajectory:${fingerprint}`]);
  let row=(await db.query('SELECT id FROM trajectories WHERE content_hash=$1',[fingerprint])).rows[0];
  const duplicate=Boolean(row);
  if(!row)row=(await db.query('INSERT INTO trajectories(content,content_hash,line_count) VALUES($1,$2,$3) RETURNING id',[content,fingerprint,lines.length])).rows[0];
  const locked=(await db.query('SELECT id,distillation_blocked_reason FROM trajectories WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
  if(metadata)await db.query('INSERT INTO trajectory_origins(trajectory_id,metadata_hash,metadata) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,hash(metadata),JSON.stringify(metadata)]);
  let reason=locked.distillation_blocked_reason;
  if(!reason)try {sourceRole((await db.query('SELECT metadata FROM trajectory_origins WHERE trajectory_id=$1',[row.id])).rows.map(r=>r.metadata));}
  catch(error){reason=(error as Error).message;}
  if(reason)return {status:duplicate?'duplicate':'stored',id:row.id,job_id:null,distillation:'skipped',reason};
  let job=(await db.query("SELECT id FROM jobs WHERE kind='distill' AND payload->>'trajectory_id'=$1",[row.id])).rows[0];
  if(!job)job=(await db.query("INSERT INTO jobs(kind,payload) VALUES('distill',$1) RETURNING id",[JSON.stringify({trajectory_id:row.id,policyVersion:currentPolicy})])).rows[0];
  return {status:duplicate?'duplicate':'stored',id:row.id,job_id:job.id};
}
export async function submitTrajectory(content:string,metadata?:TrajectoryMetadata,transfer?:unknown) {
  const input=trajectoryInput.parse({content,metadata,transfer});
  return transaction(async db=>{
    if(!input.transfer)return persistTrajectory(db,content,metadata);
    const t=input.transfer;
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`transfer:${t.id}`]);
    await db.query('INSERT INTO trajectory_transfers(id,content_hash,part_count,metadata) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[t.id,t.contentHash,t.count,metadata?JSON.stringify(metadata):null]);
    const row=(await db.query('SELECT * FROM trajectory_transfers WHERE id=$1 FOR UPDATE',[t.id])).rows[0];
    if(row.content_hash!==t.contentHash||row.part_count!==t.count||canonical(row.metadata)!==canonical(metadata??null))throw new Error('trajectory transfer metadata conflict');
    const previous=(await db.query('SELECT content_hash FROM trajectory_transfer_parts WHERE transfer_id=$1 AND part_index=$2',[t.id,t.index])).rows[0];
    if(previous&&previous.content_hash!==sha256(content))throw new Error('trajectory part content conflict');
    if(row.receipt)return row.receipt;
    await db.query('INSERT INTO trajectory_transfer_parts(transfer_id,part_index,content,content_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[t.id,t.index,content,sha256(content)]);
    const parts=(await db.query('SELECT part_index AS index,content FROM trajectory_transfer_parts WHERE transfer_id=$1 ORDER BY part_index',[t.id])).rows;
    const complete=assemble(parts,t.count,t.contentHash);
    let receipt:any={status:'accepted',transfer_id:t.id,received:parts.length,part_count:t.count};
    if(complete!==null)receipt=await persistTrajectory(db,complete,metadata);
    await db.query('UPDATE trajectory_transfers SET updated_at=now(),receipt=$2 WHERE id=$1',[t.id,complete===null?null:JSON.stringify(receipt)]);
    return receipt;
  });
}
export async function read(type: 'paper' | 'experience' | 'trajectory', id: string, revision?: number, range?: {start:number;end:number}) {
  if (type === 'trajectory') {
    const row = (await pool.query('SELECT * FROM trajectories WHERE id=$1',[id])).rows[0];
    if (!row) throw new Error('record not found');
    if (range) {
      if (range.end > row.line_count) throw new Error('event range exceeds trajectory');
      row.content = validateTrajectory(row.content).slice(range.start-1,range.end).join('\n');
      row.event_range = range;
    }
    const origins=(await pool.query('SELECT metadata FROM trajectory_origins WHERE trajectory_id=$1 ORDER BY metadata_hash',[id])).rows.map(r=>r.metadata);
    return {type,...row,origins};
  }
  const row = (await pool.query(`SELECT e.id,e.kind,r.revision,r.content,e.created_at,e.updated_at FROM entities e
    JOIN revisions r ON r.entity_id=e.id AND r.revision=COALESCE($3::int,e.current_revision) WHERE e.id=$1 AND e.kind=$2`,[id,type,revision ?? null])).rows[0];
  if (!row) throw new Error('record not found');
  const conflicts = (await pool.query('SELECT left_id,right_id,reason FROM conflicts WHERE left_id=$1 OR right_id=$1',[id])).rows;
  return {...row,sources:type === 'experience' ? await sourcesFor(id) : [],conflicts};
}
export async function getJob(id: string) {
  const row = (await pool.query('SELECT id,kind,status,attempts,result,error,created_at,updated_at,checkpoint,payload FROM jobs WHERE id=$1',[id])).rows[0];
  if (!row) throw new Error('job not found');
  const checkpoint=row.checkpoint,payload=row.payload;delete row.checkpoint;delete row.payload;
  return {...row,...(row.kind==='distill'?{progress:distillationProgress({...row,checkpoint,payload})}:{})};
}
export async function search(kind: Kind, query: string, filters: Record<string,unknown> = {}, limit=10) {
  const vector = await queryVector(query);
  const args: unknown[] = [kind,vectorSql(vector.embedding),keywords(query),vector.model_version];
  const conditions = ['e.kind=$1', 'c.revision=e.current_revision', 'c.model_version=$4', '$2::vector IS NOT NULL', '$3::text IS NOT NULL'];
  const bind = (value: unknown) => {args.push(value);return `$${args.length}`;};
  if (kind === 'paper') {
    if (filters.year_from !== undefined) conditions.push(`(r.content->'metadata'->>'year')::int >= ${bind(filters.year_from)}`);
    if (filters.year_to !== undefined) conditions.push(`(r.content->'metadata'->>'year')::int <= ${bind(filters.year_to)}`);
    if (filters.author) conditions.push(`EXISTS(SELECT 1 FROM jsonb_array_elements_text(r.content->'metadata'->'authors') a WHERE lower(a)=lower(${bind(filters.author)}))`);
    if (filters.venue) conditions.push(`lower(r.content->'metadata'->>'venue')=lower(${bind(filters.venue)})`);
    if (filters.doi) conditions.push(`r.content->'metadata'->>'doi'=${bind(normalizeDoi(String(filters.doi)))}`);
    if (filters.arxivId) conditions.push(`regexp_replace(lower(r.content->'metadata'->>'arxivId'),'v[0-9]+$','')=${bind(normalizeArxiv(String(filters.arxivId)))}`);
  } else {
    for (const key of ['role','stage','sourceType']) if (filters[key]) {
      const match = `r.content->>'${key}'=${bind(filters[key])}`;
      conditions.push(key==='stage' ? `(${match} OR r.content->>'stage' IS NULL)` : match);
    }
  }
  const base = `FROM search_chunks c JOIN entities e ON e.id=c.entity_id JOIN revisions r ON r.entity_id=e.id AND r.revision=c.revision WHERE ${conditions.join(' AND ')}`;
  const columns = 'c.id,c.entity_id,c.revision,c.text,c.location,r.content';
  const [lexical,dense] = await Promise.all([
    pool.query(`SELECT ${columns} ${base} AND c.keywords @@ plainto_tsquery('simple',$3) ORDER BY ts_rank_cd(c.keywords,plainto_tsquery('simple',$3)) DESC,c.id LIMIT 50`,args),
    pool.query(`SELECT ${columns} ${base} ORDER BY c.embedding <=> $2::vector,c.id LIMIT 50`,args),
  ]);
  // Both SQL branches reference every parameter to avoid PostgreSQL's unused-parameter type ambiguity.
  return Promise.all(fuse(lexical.rows,dense.rows,limit).map(async row => ({
    id:row.entity_id,revision:row.revision,score:row.score,snippet:row.text,location:row.location,
    ...(kind === 'paper' ? {metadata:row.content.metadata} : {task:row.content.task,role:row.content.role,stage:row.content.stage,applicability:row.content.applicability,sources:await sourcesFor(row.entity_id)}),
  })));
}
export async function candidates(kind: Kind, content: Payload, sources: Source[] = []) {
  const query = kind === 'paper' ? (content as Paper).metadata.title : [(content as Experience).task,(content as Experience).strategy].filter(v=>v!==undefined).join('\n');
  const filters = kind === 'experience' ? {role:(content as Experience).role,sourceType:(content as Experience).sourceType} : {};
  const matches = await search(kind,query.slice(0,8000),filters,kind==='experience'?12:8);
  const ids = new Set<string>();
  if(kind==='experience' && sources.length) {
    const sameSource=await pool.query(`SELECT e.id,MIN(CASE
      WHEN s.start_line IS NULL OR incoming.start_line IS NULL THEN 2147483647
      WHEN s.start_line<=incoming.end_line AND incoming.start_line<=s.end_line THEN 0
      ELSE LEAST(abs(s.start_line-incoming.end_line),abs(incoming.start_line-s.end_line)) END) AS distance
      FROM experience_sources s JOIN entities e ON e.id=s.experience_id
      JOIN revisions r ON r.entity_id=e.id AND r.revision=e.current_revision
      JOIN jsonb_to_recordset($1::jsonb) AS incoming(id uuid,start_line integer,end_line integer) ON incoming.id=s.trajectory_id
      WHERE r.content->>'role'=$2 AND r.content->>'sourceType'=$3
      GROUP BY e.id ORDER BY distance,e.id LIMIT 12`,[JSON.stringify(sources.map(s=>({id:s.id,start_line:s.event_range?.start??null,end_line:s.event_range?.end??null}))),filters.role,filters.sourceType]);
    sameSource.rows.forEach(r=>ids.add(r.id));
  }
  matches.forEach(r=>ids.add(r.id));
  if (kind === 'paper') {
    const p = content as Paper;
    const strong = (await pool.query(`SELECT id FROM papers WHERE ($1::text IS NOT NULL AND metadata->>'doi'=$1)
      OR ($2::text IS NOT NULL AND regexp_replace(lower(metadata->>'arxivId'),'v[0-9]+$','')=$2) LIMIT 20`,[normalizeDoi(p.metadata.doi),normalizeArxiv(p.metadata.arxivId)])).rows;
    strong.forEach(r => ids.add(r.id));
  }
  return Promise.all([...ids].map(id => read(kind,id)));
}
export type Job = {id:string;kind:'ingest'|'distill';payload:any;checkpoint:any;lease_token:string;attempts:number};
export async function lockJob(db: DB, job: Job) {
  const row = (await db.query("SELECT * FROM jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>now() FOR UPDATE",[job.id,job.lease_token])).rows[0];
  if (!row) throw new Error('job lease lost');
  return row;
}
const schedulingPhase=`COALESCE(checkpoint->>'phase',CASE WHEN jsonb_typeof(checkpoint->'children')='array' THEN 'waiting' ELSE 'segments' END)`;
export const claimQuery=`SELECT id,kind,${schedulingPhase} AS phase FROM jobs
      WHERE (status='queued' AND run_after<=now() OR status='running' AND lease_until<now()) AND attempts<$1
        AND NOT (kind='distill' AND ${schedulingPhase}='waiting')
      ORDER BY CASE WHEN kind=$2 THEN 0 ELSE 1 END,
        CASE WHEN kind='distill' AND (${schedulingPhase} NOT IN ('segments','triage'))=$3::boolean THEN 0 ELSE 1 END,
        scheduled_at NULLS FIRST, created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`;
export async function claim(): Promise<Job | undefined> {
  return transaction(async db => {
    await db.query("UPDATE jobs SET status='failed',error='worker lease expired after final attempt',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until<now() AND attempts >= $1",[config.maxAttempts]);
    const scheduler=(await db.query('SELECT ingest_streak,completion_streak FROM worker_scheduler WHERE id=true FOR UPDATE')).rows[0];
    const row = (await db.query(claimQuery,
      [config.maxAttempts,scheduler.ingest_streak>=5?'distill':'ingest',scheduler.completion_streak<2])).rows[0];
    if (!row) return undefined;
    await db.query('UPDATE worker_scheduler SET ingest_streak=$1,completion_streak=$2 WHERE id=true',[
      row.kind==='ingest'?Math.min(5,scheduler.ingest_streak+1):0,
      row.kind==='ingest'?scheduler.completion_streak:['segments','triage'].includes(row.phase)?0:Math.min(2,scheduler.completion_streak+1)]);
    return (await db.query("UPDATE jobs SET status='running',scheduled_at=now(),attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+$2*interval '1 second',updated_at=now() WHERE id=$1 RETURNING *",[row.id,config.leaseSeconds])).rows[0];
  });
}
export async function heartbeat(job: Job) {
  return pool.query("UPDATE jobs SET lease_until=now()+$3*interval '1 second' WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,job.lease_token,config.leaseSeconds]);
}
export async function checkpoint(job: Job, value: unknown) {
  await transaction(async db => {await lockJob(db,job);await db.query('UPDATE jobs SET checkpoint=$2 WHERE id=$1',[job.id,JSON.stringify(value)]);});
}
export async function finish(job: Job, result: unknown) {
  await transaction(async db => {await lockJob(db,job);await db.query("UPDATE jobs SET status='succeeded',result=$2,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[job.id,JSON.stringify(result)]);});
}
export async function defer(job: Job, delaySeconds=0) {
  if(!Number.isInteger(delaySeconds)||delaySeconds<0)throw new Error('invalid defer delay');
  await transaction(async db => {await lockJob(db,job);await db.query("UPDATE jobs SET status='queued',attempts=GREATEST(attempts-1,0),run_after=now()+$2*interval '1 second',lease_token=NULL,lease_until=NULL WHERE id=$1",[job.id,delaySeconds]);});
}
export function waitingOutcome(progress:any,children:Map<string,any>) {
  const ids=new Set<string>();let pending=false;
  for(const child of progress.children??[]) {
    if(child.id){ids.add(child.id);continue;}
    const result=children.get(child.job_id);
    if(!result||result.status==='failed')return {error:'child ingestion failed or unavailable',ids:[],pending:false};
    if(result.status!=='succeeded')pending=true;
    else for(const id of result.result?.ids??[])ids.add(id);
  }
  return {ids:[...ids],pending,error:null};
}
// No model/embedding calls and no scheduler quota consumed. Locks prevent a
// live worker lease from being taken over; all status updates are transactional.
export const waitingQuery=`SELECT * FROM jobs WHERE kind='distill' AND ${schedulingPhase}='waiting'
      AND (status='queued' AND run_after<=now() OR status='running' AND lease_until<now()) AND attempts<$1
      ORDER BY run_after,created_at,id FOR UPDATE SKIP LOCKED LIMIT 100`;
export async function sweepWaiting() {
  return transaction(async db=>{
    const rows=(await db.query(waitingQuery,[config.maxAttempts])).rows;
    let completed=0;
    for(const row of rows) {
      const p=row.checkpoint;
      const childIds=(p.children??[]).filter((c:any)=>!c.id).map((c:any)=>c.job_id);
      const children=childIds.length?(await db.query('SELECT id,status,result FROM jobs WHERE id=ANY($1::uuid[])',[childIds])).rows:[];
      const outcome=waitingOutcome(p,new Map(children.map(c=>[c.id,c])));
      if(outcome.error) {
        await db.query(`UPDATE jobs SET attempts=attempts+1,status=CASE WHEN attempts+1 >= $2 THEN 'failed' ELSE 'queued' END,
          error=$3,run_after=now()+interval '15 seconds',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,[row.id,config.maxAttempts,outcome.error]);
      } else if(outcome.pending) {
        await db.query(`UPDATE jobs SET status='queued',run_after=now()+interval '15 seconds',lease_token=NULL,lease_until=NULL,
          attempts=GREATEST(attempts-$2,0) WHERE id=$1`,[row.id,row.status==='running'?1:0]);
      } else {
        const result={ids:outcome.ids,trajectory_id:row.payload.trajectory_id,candidate_count:p.candidates?.length??0,
          consolidated_count:p.finalCandidates?.length??null,strategy_count:outcome.ids.length};
        await db.query(`UPDATE jobs SET status='succeeded',result=$2,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,[row.id,JSON.stringify(result)]);
        completed++;
      }
    }
    return {checked:rows.length,completed};
  });
}
export async function fail(job: Job, error: unknown) {
  // Do not persist model messages, credentials, or provider response bodies in public errors.
  let message = error instanceof Error ? error.message : 'processing failed';
  for (const [key,value] of Object.entries(process.env)) {
    if(value && value.length>=8 && /KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL/.test(key))message=message.split(value).join('[redacted]');
  }
  message=message.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,600);
  await pool.query(`UPDATE jobs SET status=CASE WHEN attempts >= $3 THEN 'failed' ELSE 'queued' END,
    error=$4,run_after=now()+interval '10 seconds',lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE id=$1 AND lease_token=$2 AND status='running'`,[job.id,job.lease_token,config.maxAttempts,message]);
}
export async function publish(job: Job, decision: Decision, content: Payload, prepared?: Prepared) {
  await transaction(async db => {
    const current = await lockJob(db,job), {kind,fingerprint,sources} = current.payload;
    if(kind==='experience')await validateExperienceRole(db,content,sources??[]);
    let id = decision.targetId, revision = 1;
    if (id) {
      const target = (await db.query('SELECT * FROM entities WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
      if (!target || target.current_revision !== decision.expectedRevision) throw new Error('target revision changed; retry decision');
      revision = target.current_revision;
      if(kind==='experience') {
        const previous=(await db.query('SELECT content FROM revisions WHERE entity_id=$1 AND revision=$2',[id,revision])).rows[0].content;
        if(previous.role!==(content as Experience).role || previous.sourceType!==(content as Experience).sourceType)throw new Error('experience target role/sourceType mismatch');
        await validateExperienceRole(db,previous,await sourcesFor(id!,db));
      }
    }
    if (decision.action === 'new' || decision.action === 'keep_separate') {
      id = (await db.query('INSERT INTO entities(kind) VALUES($1) RETURNING id',[kind])).rows[0].id;
      revision = 1;
    } else if (decision.action === 'supplement') revision++;
    if (!id) throw new Error('missing result identity');
    if (decision.action !== 'duplicate') {
      if (!prepared) throw new Error('embedding required before publication');
      await db.query('INSERT INTO revisions(entity_id,revision,content,content_hash) VALUES($1,$2,$3,$4)',[id,revision,JSON.stringify(content),hash(content)]);
      for (const [i,c] of prepared.chunks.entries()) {
        const heading = kind === 'paper' ? (content as Paper).metadata.title : ((content as Experience).task ?? '');
        await db.query(`INSERT INTO search_chunks(entity_id,revision,ordinal,location,text,keywords,embedding,model_version)
          VALUES($1,$2,$3,$4,$5,setweight(to_tsvector('simple',$6),'A')||setweight(to_tsvector('simple',$7),'B'),$8,$9)`,
          [id,revision,i,JSON.stringify(c.location),c.text,keywords(heading),keywords(c.text),vectorSql(c.embedding),prepared.model_version]);
      }
      await db.query('UPDATE entities SET current_revision=$2,updated_at=now() WHERE id=$1',[id,revision]);
    }
    if (kind === 'experience') await addSources(db,id,sources);
    if (decision.action === 'keep_separate') await db.query('INSERT INTO conflicts(left_id,right_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[decision.targetId,id,decision.reason]);
    await db.query('INSERT INTO decisions(job_id,entity_id,decision) VALUES($1,$2,$3)',[job.id,id,JSON.stringify(decision)]);
    await db.query('UPDATE ingestions SET entity_id=$3 WHERE kind=$1 AND content_hash=$2',[kind,fingerprint,id]);
    await db.query("UPDATE jobs SET status='succeeded',result=$2,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[job.id,JSON.stringify({ids:[id],revision,decision})]);
  });
}
