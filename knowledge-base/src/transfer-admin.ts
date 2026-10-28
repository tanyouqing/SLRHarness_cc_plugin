import {pool,transaction} from './db.js';
const [action,id,confirmation]=process.argv.slice(2);
try {
  if(action==='list') {
    const rows=await pool.query(`SELECT t.id,t.part_count,count(p.part_index)::int AS received,t.created_at,t.updated_at,
      t.receipt IS NOT NULL AS completed FROM trajectory_transfers t LEFT JOIN trajectory_transfer_parts p ON p.transfer_id=t.id
      GROUP BY t.id ORDER BY t.created_at`);
    console.log(JSON.stringify(rows.rows,null,2));
  } else if(action==='abandon'&&/^[a-f0-9]{64}$/.test(id??'')&&confirmation==='--confirm-no-client-running') {
    await transaction(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`transfer:${id}`]);
      const deleted=await db.query('DELETE FROM trajectory_transfers WHERE id=$1 AND receipt IS NULL RETURNING id',[id]);
      console.log(JSON.stringify({abandoned:deleted.rows}));
    });
  } else throw new Error('use list OR abandon <transfer-id> --confirm-no-client-running; stop its uploading client first');
} finally {await pool.end();}
