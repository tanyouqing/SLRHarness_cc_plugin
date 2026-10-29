import {pool} from './db.js';
const db=await pool.connect();
try {
  await db.query('BEGIN READ ONLY');
  await db.query("EXPLAIN SELECT id,status,report FROM paper_checks WHERE job_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",['00000000-0000-4000-8000-000000000001']);
  await db.query("EXPLAIN SELECT id FROM paper_checks WHERE content_hash=$1 AND status='passed'",['hash']);
  await db.query("EXPLAIN SELECT r.entity_id,EXISTS(SELECT 1 FROM paper_checks pc WHERE pc.content_hash=r.content_hash AND pc.status='passed') FROM revisions r");
  const triggers=(await db.query("SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('paper_revision_admission','immutable_completed_paper_checks','immutable_revisions') ORDER BY tgname")).rows;
  if(triggers.length!==3||triggers.some(t=>t.tgenabled!=='O'))throw new Error('paper admission/history triggers unavailable');
  const counts=(await db.query("SELECT status,count(*) FROM paper_checks GROUP BY status ORDER BY status")).rows;
  console.log(JSON.stringify({sql_plans:'valid',triggers,checks:counts}));
}finally{await db.query('ROLLBACK');db.release();await pool.end();}
