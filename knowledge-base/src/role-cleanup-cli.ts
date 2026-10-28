import { readFile } from 'node:fs/promises';
import { pool,transaction } from './db.js';
import { snapshot,cleanupPlan,applyCleanup } from './role-cleanup.js';
try {
  const [action,file,confirm]=process.argv.slice(2);
  if(action==='preview')console.log(JSON.stringify(await transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return cleanupPlan(await snapshot(db));
  }),null,2));
  else if(action==='apply'&&file&&confirm==='--writers-stopped')console.log(JSON.stringify(await applyCleanup(JSON.parse(await readFile(file,'utf8')))));
  else throw new Error('use preview | apply <preview.json> --writers-stopped');
} finally {await pool.end();}
