import { sourceRole } from './roles.js';
import { hash } from './domain.js';
import { type DB, transaction } from './db.js';

export type Snapshot={trajectories:any[];experiences:any[];jobs:any[];ingestions:any[];decisions:any[];transfers:any[]};
export async function snapshot(db:DB):Promise<Snapshot> {
  const trajectories=(await db.query(`SELECT t.id,t.content_hash,t.distillation_blocked_reason,
    COALESCE((SELECT jsonb_agg(o.metadata ORDER BY metadata_hash) FROM trajectory_origins o WHERE o.trajectory_id=t.id),'[]') AS origins
    FROM trajectories t ORDER BY t.id`)).rows;
  const experiences=(await db.query(`SELECT e.id,e.content,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.trajectory_id) ORDER BY s.trajectory_id) FROM experience_sources s WHERE s.experience_id=e.id),'[]') AS sources
    FROM experiences e ORDER BY e.id`)).rows;
  const jobs=(await db.query('SELECT id,kind,status,payload,checkpoint,result,updated_at::text FROM jobs ORDER BY id')).rows;
  const ingestions=(await db.query('SELECT * FROM ingestions ORDER BY kind,content_hash')).rows;
  const decisions=(await db.query('SELECT id,job_id,entity_id FROM decisions ORDER BY id')).rows;
  const transfers=(await db.query('SELECT id,receipt FROM trajectory_transfers WHERE receipt IS NOT NULL ORDER BY id')).rows;
  return {trajectories,experiences,jobs,ingestions,decisions,transfers};
}
export function cleanupPlan(s:Snapshot) {
  const roles=new Map<string,string>(),invalid=new Map<string,string>();
  for(const t of s.trajectories)try{roles.set(t.id,sourceRole(t.origins));}catch(e){invalid.set(t.id,(e as Error).message);}
  const reason=(content:any,sources:any[])=>{
    if(content?.sourceType!=='trajectory')return null;
    if(!sources?.length)return 'trajectory experience has no source';
    for(const src of sources) {
      if(!roles.has(src.id))return invalid.get(src.id)??'source trajectory missing';
      if(roles.get(src.id)!==content.role)return 'experience role differs from source agentRole';
    }
    return null;
  };
  const entities=new Map<string,string>();
  for(const e of s.experiences){const why=reason(e.content,e.sources);if(why)entities.set(e.id,why);}
  const jobs=new Map<string,string>();
  for(const j of s.jobs) {
    if(j.kind==='distill') {
      let why=invalid.get(j.payload.trajectory_id);
      if(!roles.has(j.payload.trajectory_id))why??='source trajectory missing';
      for(const c of [...(j.checkpoint?.candidates??[]),...(j.checkpoint?.finalCandidates??[]),...(j.checkpoint?.consolidation?.items??[]),...(j.checkpoint?.consolidation?.current?[j.checkpoint.consolidation.current]:[])])
        why??=reason(c.experience,c.sources)??undefined;
      if(why)jobs.set(j.id,why);
    } else if(j.payload.kind==='experience' && j.payload.content?.sourceType==='trajectory') {
      const why=reason(j.payload.content,j.payload.sources);if(why)jobs.set(j.id,why);
    }
  }
  const isTrajectoryIngest=(j:any)=>j.kind==='ingest'&&j.payload.kind==='experience'&&j.payload.content?.sourceType==='trajectory';
  // Close references before deleting. Correct-role completed products remain intact.
  let changed=true;
  while(changed) {
    const before=jobs.size;
    for(const j of s.jobs) {
      if(j.kind==='distill') {
        const children=j.checkpoint?.children??[];
        if((j.result?.ids??[]).some((id:string)=>entities.has(id))||children.some((c:any)=>jobs.has(c.job_id)||entities.has(c.id)))jobs.set(j.id,'references removed strategy or child task');
        if(jobs.has(j.id))for(const child of children) {
          const row=s.jobs.find(x=>x.id===child.job_id);
          if(row&&isTrajectoryIngest(row)&&row.status!=='succeeded')jobs.set(row.id,'pending child of removed distillation');
        }
      } else if(isTrajectoryIngest(j)) {
        if((j.result?.ids??[]).some((id:string)=>entities.has(id))||s.ingestions.some(i=>i.job_id===j.id&&entities.has(i.entity_id))||s.decisions.some(d=>d.job_id===j.id&&entities.has(d.entity_id)))
          jobs.set(j.id,'references removed strategy');
      }
    }
    changed=jobs.size!==before;
  }
  const blocked=new Map(invalid);
  for(const j of s.jobs)if(j.kind==='distill'&&jobs.has(j.id))blocked.set(j.payload.trajectory_id,jobs.get(j.id)!);
  const entries=(m:Map<string,string>)=>[...m].sort(([a],[b])=>a.localeCompare(b)).map(([id,reason])=>({id,reason}));
  return {version:1,snapshotHash:hash(s),trajectories:entries(blocked).filter(t=>s.trajectories.some(x=>x.id===t.id)).map(t=>({...t,contentHash:s.trajectories.find(x=>x.id===t.id).content_hash??null})),
    experiences:entries(entities),jobs:entries(jobs),
    ingestions:s.ingestions.filter(i=>jobs.has(i.job_id)||entities.has(i.entity_id)),
    decisions:s.decisions.filter(d=>jobs.has(d.job_id)||entities.has(d.entity_id)),
    transfers:s.transfers.filter(t=>jobs.has(t.receipt?.job_id)||blocked.has(t.receipt?.id)).map(t=>({id:t.id,trajectoryId:t.receipt.id})),
  };
}
export type CleanupPlan=ReturnType<typeof cleanupPlan>;
export async function applyCleanup(plan:CleanupPlan, transact=transaction) {
  return transact(async db=>{
    await db.query('LOCK TABLE trajectories,trajectory_origins,trajectory_transfers,trajectory_transfer_parts,jobs,entities,revisions,experience_sources,search_chunks,ingestions,decisions,conflicts IN ACCESS EXCLUSIVE MODE');
    const fresh=cleanupPlan(await snapshot(db));
    if(hash(fresh)!==hash(plan))throw new Error('cleanup plan stale or altered; generate a new preview');
    // entities.current_revision has a deferred FK into revisions. Check each
    // statement immediately so ALTER TRIGGER never sees pending FK events.
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');
    const ids=plan.experiences.map(x=>x.id),jobs=plan.jobs.map(x=>x.id);
    for(const t of plan.trajectories)await db.query('UPDATE trajectories SET distillation_blocked_reason=$2 WHERE id=$1',[t.id,t.reason]);
    for(const t of plan.transfers)await db.query(`UPDATE trajectory_transfers SET receipt=$2,updated_at=now() WHERE id=$1`,[t.id,JSON.stringify({status:'duplicate',id:t.trajectoryId,job_id:null,distillation:'skipped',reason:'administratively removed'})]);
    await db.query('DELETE FROM decisions WHERE job_id=ANY($1::uuid[]) OR entity_id=ANY($2::uuid[])',[jobs,ids]);
    await db.query('DELETE FROM ingestions WHERE job_id=ANY($1::uuid[]) OR entity_id=ANY($2::uuid[])',[jobs,ids]);
    await db.query('DELETE FROM conflicts WHERE left_id=ANY($1::uuid[]) OR right_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM search_chunks WHERE entity_id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM experience_sources WHERE experience_id=ANY($1::uuid[])',[ids]);
    await db.query('UPDATE entities SET current_revision=NULL WHERE id=ANY($1::uuid[])',[ids]);
    // PostgreSQL DDL is transactional: rollback also restores this trigger.
    await db.query('ALTER TABLE revisions DISABLE TRIGGER immutable_revisions');
    await db.query('DELETE FROM revisions WHERE entity_id=ANY($1::uuid[])',[ids]);
    await db.query('ALTER TABLE revisions ENABLE TRIGGER immutable_revisions');
    await db.query('DELETE FROM entities WHERE id=ANY($1::uuid[])',[ids]);
    await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);
    return {removedJobs:jobs.length,removedExperiences:ids.length,blockedTrajectories:plan.trajectories.length};
  });
}
