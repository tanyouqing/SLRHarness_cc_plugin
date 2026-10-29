// Read-only planning and invariant inspection: no upload, exposure, model or job execution.
import {pool,transaction} from './db.js';
try {
  await transaction(async db=>{
    await db.query('SET TRANSACTION READ ONLY');
    await db.query(`EXPLAIN SELECT id FROM entities WHERE kind='experience' AND strategy_status='active' AND NOT inactivity_exempt
      AND GREATEST(activity_started_at,COALESCE(last_retrieved_at,activity_started_at))<=now()-COALESCE(inactivity_days,90)*interval '1 day' FOR UPDATE`);
    await db.query(`EXPLAIN SELECT id FROM jobs WHERE kind='feedback' AND status='queued' AND run_after<=now() ORDER BY scheduled_at NULLS FIRST,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
    const bad=(await db.query(`SELECT count(*)::int AS count FROM entities e LEFT JOIN revisions r
      ON e.id=r.entity_id AND e.current_revision=r.revision WHERE e.kind='experience' AND r.entity_id IS NULL`)).rows[0].count;
    if(bad)throw new Error('strategy current revision missing');
    console.log(JSON.stringify({sql_plans:'valid',missing_current_revisions:bad,
      states:(await db.query("SELECT strategy_status,count(*) FROM entities WHERE kind='experience' GROUP BY strategy_status")).rows,
      feedback_jobs:(await db.query("SELECT status,count(*) FROM jobs WHERE kind='feedback' GROUP BY status")).rows}));
  });
}finally{await pool.end();}
