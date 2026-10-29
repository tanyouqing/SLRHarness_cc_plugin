import {transaction,pool} from './db.js';
import {lockJob,finish,type Job} from './store.js';
import {hash,type Paper} from './domain.js';
import {discover,type Dossier} from './paper-sources.js';
import {verifyLevel,type Identity} from './paper-verification.js';

export const paperGateDependencies={
  discover,verify:verifyLevel,
  load:async(job:Job,contentHash:string,metadataHash:string,content:Paper)=>transaction(async db=>{
    await lockJob(db,job);
    const existing=(await db.query('SELECT * FROM paper_checks WHERE job_id=$1 AND content_hash=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[job.id,contentHash])).rows[0];
    if(existing)return existing;
    const identity=(await db.query("SELECT id,dossier,report FROM paper_checks WHERE metadata_hash=$1 AND status='passed' AND report->'L1'->>'verified'='true' ORDER BY created_at DESC,id DESC LIMIT 1",[metadataHash])).rows[0];
    const dossier=identity?.dossier??{documents:[],errors:[],searched:false};
    const report=identity?{L1:identity.report.L1,identityReusedFrom:identity.id}:{};
    return (await db.query('INSERT INTO paper_checks(job_id,content_hash,metadata_hash,dossier,report,content) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[job.id,contentHash,metadataHash,JSON.stringify(dossier),JSON.stringify(report),JSON.stringify(content)])).rows[0];
  }),
  save:async(job:Job,row:any)=>transaction(async db=>{
    await lockJob(db,job);
    const r=await db.query("UPDATE paper_checks SET dossier=$3,report=$4,status=$5,updated_at=now() WHERE id=$1 AND job_id=$2 AND status='checking' RETURNING id",[row.id,job.id,JSON.stringify(row.dossier),JSON.stringify(row.report),row.status]);
    if(!r.rowCount)throw new Error('paper check changed or is already complete');
  }),
};
export async function admitPaper(job:Job,content:Paper,deps=paperGateDependencies) {
  const row=await deps.load(job,hash(content),hash(content.metadata),content);
  if(row.status!=='checking')return row;
  const dossier=row.dossier as Dossier;
  const save=()=>deps.save(job,row);
  if(!row.report.L1) {
    await deps.discover(content,dossier,save);
    row.report.L1=await deps.verify('L1',content,dossier,save);await save();
  }
  if(!row.report.L1.passed){row.status='held';row.report.verification='held';row.report.reason=row.report.L1.reason;row.report.level='L1';await save();return row;}
  if(!row.report.L2) {row.report.L2=await deps.verify('L2',content,dossier,save,row.report.L1 as Identity);await save();}
  row.status=row.report.L2.passed?'passed':'held';row.report.reason=row.report.L2.reason;row.report.level='L2';
  row.report.verification=row.status==='held'?'held':row.report.L1.verified&&row.report.L2.verified?'verified':'admitted_with_gaps';
  await save();return row;
}
export async function holdPaper(job:Job,check:any) {
  await finish(job,{ids:[],admission:'held',check_id:check.id,reason:check.report.reason,level:check.report.level});
}
export async function paperCheckHistory(jobId:string) {
  return (await pool.query('SELECT id,job_id,content_hash,content,policy,status,report,dossier,created_at,updated_at FROM paper_checks WHERE job_id=$1 ORDER BY created_at,id',[jobId])).rows;
}
export async function recheckPaper(jobId:string) {
  return transaction(async db=>{
    const job=(await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!job||job.kind!=='ingest'||job.payload.kind!=='paper'||job.status!=='succeeded'||job.result?.admission!=='held')throw new Error('paper-recheck requires a held paper ingestion');
    const old=(await db.query('SELECT content_hash,metadata_hash,content FROM paper_checks WHERE id=$1 AND job_id=$2',[job.result.check_id,jobId])).rows[0];
    if(!old)throw new Error('paper check missing');
    await db.query('INSERT INTO paper_checks(job_id,content_hash,metadata_hash,content) VALUES($1,$2,$3,$4)',[jobId,old.content_hash,old.metadata_hash,JSON.stringify(old.content)]);
    await db.query("UPDATE jobs SET status='queued',result=NULL,error=NULL,attempts=0,run_after=now(),lease_token=NULL,lease_until=NULL,checkpoint=NULL WHERE id=$1",[jobId]);
    return {rechecking:jobId};
  });
}
