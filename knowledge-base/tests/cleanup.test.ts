import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupPlan,applyCleanup,type Snapshot} from '../src/role-cleanup.js';
import {pool} from '../src/db.js';
function fixture():Snapshot {
  const experience=(role:string)=>({sourceType:'trajectory',role});
  return {trajectories:[{id:'valid',origins:[{agentRole:'worker'}]},{id:'unknown',origins:[]}],
    experiences:[{id:'good',content:experience('worker'),sources:[{id:'valid'}]},
      {id:'bad',content:experience('manager'),sources:[{id:'valid'}]},
      {id:'unknown-product',content:experience('worker'),sources:[{id:'unknown'}]},
      {id:'mixed',content:experience('worker'),sources:[{id:'valid'},{id:'unknown'}]},
      {id:'review',content:{sourceType:'review',role:'worker'},sources:[]}],
    jobs:[{id:'parent',kind:'distill',status:'queued',payload:{trajectory_id:'valid'},checkpoint:{candidates:[{experience:experience('manager'),sources:[{id:'valid'}]}],children:[]}},{id:'legacy',kind:'distill',payload:{trajectory_id:'unknown'}}],ingestions:[],decisions:[],transfers:[]};
}
test('cleanup deletes unknown/cross-role products, preserves good strategies, reviews and raw evidence',()=>{
  const s=fixture(),p=cleanupPlan(s);
  assert.deepEqual(p.experiences.map(x=>x.id),['bad','mixed','unknown-product']);
  assert.deepEqual(p.jobs.map(x=>x.id),['legacy','parent']);
  assert.equal(s.trajectories.length,2);assert.deepEqual(p.trajectories.map(x=>x.id),['unknown','valid']);
});
test('cleanup closes parent/child and ingestion/decision dependencies without removing valid completed products',()=>{
  const s=fixture();s.jobs.push({id:'child',kind:'ingest',status:'queued',payload:{kind:'experience',content:{sourceType:'trajectory',role:'worker'},sources:[{id:'valid'}]}});
  s.jobs[0].checkpoint.children=[{job_id:'child'}];
  s.jobs.push({id:'other-parent',kind:'distill',payload:{trajectory_id:'valid'},checkpoint:{children:[{job_id:'child'}]}});
  const p=cleanupPlan(s);assert.ok(p.jobs.some(x=>x.id==='child'));assert.ok(p.jobs.some(x=>x.id==='other-parent'));
  assert.ok(!p.experiences.some(x=>x.id==='good'));
});
function fake(t:any,s:Snapshot,fail=false) {
  const sqls:string[]=[];let trigger=true,removed=false,saved:any;
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string){
    sqls.push(sql);
    if(sql==='BEGIN')saved={trigger,removed};
    if(sql==='ROLLBACK'){trigger=saved.trigger;removed=saved.removed;}
    if(sql.includes('DISABLE TRIGGER'))trigger=false;
    if(sql.startsWith('DELETE FROM revisions')){removed=true;if(fail)throw new Error('disk error');}
    if(sql.includes('ENABLE TRIGGER'))trigger=true;
    const rows=sql.startsWith('SELECT t.id')?s.trajectories:sql.startsWith('SELECT e.id')?s.experiences:sql.startsWith('SELECT id,kind')?s.jobs:sql.startsWith('SELECT * FROM ingestions')?s.ingestions:sql.startsWith('SELECT id,job_id')?s.decisions:sql.startsWith('SELECT id,receipt')?s.transfers:[];
    return {rows};
  }} as any));return {sqls,get trigger(){return trigger;},get removed(){return removed;}};
}
test('cleanup transaction revalidates preview, removes dependencies and restores immutable trigger',async t=>{
  const s=fixture(),db=fake(t,s);await applyCleanup(cleanupPlan(s));
  assert.ok(db.trigger&&db.removed);assert.equal(db.sqls.at(-1),'COMMIT');
  assert.ok(db.sqls.indexOf('DELETE FROM revisions WHERE entity_id=ANY($1::uuid[])')<db.sqls.indexOf('DELETE FROM entities WHERE id=ANY($1::uuid[])'));
});
test('cleanup failure rolls back deletion and trigger changes',async t=>{
  const s=fixture(),db=fake(t,s,true);await assert.rejects(applyCleanup(cleanupPlan(s)),/disk error/);
  assert.ok(db.trigger);assert.equal(db.removed,false);assert.equal(db.sqls.at(-1),'ROLLBACK');
});
test('stale or modified cleanup preview performs no deletions',async t=>{
  const s=fixture(),p=cleanupPlan(s);p.jobs=[];const db=fake(t,s);
  await assert.rejects(applyCleanup(p),/stale or altered/);assert.ok(!db.sqls.some(x=>x.startsWith('DELETE')));
});
