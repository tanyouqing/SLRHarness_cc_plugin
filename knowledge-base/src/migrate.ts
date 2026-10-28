import { readFile, readdir } from 'node:fs/promises';
import { pool, transaction } from './db.js';
try {
  await transaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('kb-migrations'))");
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of (await readdir('migrations')).filter(f => f.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[file])).rowCount) continue;
      await db.query(await readFile(`migrations/${file}`, 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
      console.log(`Applied ${file}`);
    }
  });
} finally { await pool.end(); }
