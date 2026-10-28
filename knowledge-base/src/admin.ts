import { pool, transaction } from './db.js';
import { z } from 'zod';
// Operator-only command inside the worker container; deliberately not an MCP tool.
const [action,id]=process.argv.slice(2);
try {
  if(action==='retry') {
    z.string().uuid().parse(id);
    const result=await transaction(async db=>{
      const job=(await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!job || job.status!=='failed')throw new Error('retry requires a failed job');
      // Retry failed children as well; keep successful stages and candidates intact.
      for(const child of job.checkpoint?.children??[])if(child.job_id)await db.query("UPDATE jobs SET status='queued',attempts=0,error=NULL,run_after=now() WHERE id=$1 AND status='failed'",[child.job_id]);
      await db.query("UPDATE jobs SET status='queued',attempts=0,error=NULL,run_after=now(),lease_token=NULL,lease_until=NULL WHERE id=$1",[id]);
      return {retried:id};
    });
    console.log(JSON.stringify(result));
  } else if(action==='status') {
    console.log(JSON.stringify((await pool.query('SELECT status,kind,count(*) FROM jobs GROUP BY status,kind ORDER BY kind,status')).rows,null,2));
  } else throw new Error('Usage: node dist/admin.js <status|retry JOB_ID>');
} finally {await pool.end();}
