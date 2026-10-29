import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { pool } from './db.js';
import { claim, heartbeat, fail, sweepWaiting } from './store.js';
import {processFeedback,sweepInactive} from './governance.js';
import { processDistill, processIngest } from './processing.js';
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
// One leader serializes semantic decisions. Leases allow safe recovery after a crash.
const leader=await pool.connect();
const healthPath=process.env.WORKER_HEALTH_PATH??'/data/worker-heartbeat';
const health=setInterval(()=>{void writeFile(healthPath,String(Date.now())).catch(()=>{});},10000);
try {
  const acquired=(await leader.query("SELECT pg_try_advisory_lock(hashtext('kb-worker')) AS acquired")).rows[0].acquired;
  if(!acquired)throw new Error('another knowledge-base worker is active');
  console.log(JSON.stringify({event:'worker_ready'}));
  let nextSweep=0,nextInactive=0;
  while(!stopping) {
    if(Date.now()>=nextSweep) {
      try {const result=await sweepWaiting();if(result.checked)console.log(JSON.stringify({event:'waiting_sweep',...result}));}
      catch {console.error(JSON.stringify({event:'waiting_sweep_failed'}));}
      nextSweep=Date.now()+15000;
    }
    if(Date.now()>=nextInactive) {
      try {await sweepInactive();}catch {console.error(JSON.stringify({event:'inactivity_sweep_failed'}));}
      nextInactive=Date.now()+60000;
    }
    const job=await claim();
    if(!job){await delay(1000);continue;}
    const timer=setInterval(()=>{void heartbeat(job).catch(()=>{stopping=true;});},15000);
    try {
      console.log(JSON.stringify({event:'job_started',job_id:job.id,kind:job.kind}));
      if(job.kind==='feedback')await processFeedback(job);else if(job.kind==='ingest')await processIngest(job);else await processDistill(job);
      console.log(JSON.stringify({event:'job_processed',job_id:job.id}));
    } catch(error) {
      await fail(job,error);
      console.error(JSON.stringify({event:'job_attempt_failed',job_id:job.id}));
    } finally {clearInterval(timer);}
  }
} finally {clearInterval(health);leader.release();await pool.end();}
