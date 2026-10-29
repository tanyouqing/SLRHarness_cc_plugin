// Operator-only static SQL planning. No ANALYZE, model, embedding, or job execution.
import {pool,transaction} from './db.js';
import {claimQuery} from './store.js';
import {consolidationQueries} from './consolidation-index.js';
try {
  await transaction(async db=>{
    await db.query('SET TRANSACTION READ ONLY');
    const vector='['+Array(1024).fill(0).map((_,i)=>i===0?1:0).join(',')+']';
    const args=['00000000-0000-4000-8000-000000000000','[]','worker','static-inspection',vector,'验证 evidence'];
    for(const [name,sql] of Object.entries(consolidationQueries)) {
      await db.query('EXPLAIN '+sql,args);console.log(`SQL plan valid: ${name}`);
    }
    await db.query('EXPLAIN '+claimQuery,[3,'distill',true]);console.log('SQL plan valid: scheduler');
  });
} finally {await pool.end();}
