import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../src/db.js';
import {sweepWaiting,waitingOutcome,submit} from '../src/store.js';

test('waiting resolution deduplicates final IDs, keeps pending, and reports missing/failed children',()=>{
  const p={children:[{id:'a'},{job_id:'child'}]};
  assert.deepEqual(waitingOutcome(p,new Map([['child',{status:'succeeded',result:{ids:['a','b']}}]])).ids,['a','b']);
  assert.equal(waitingOutcome(p,new Map([['child',{status:'queued'}]])).pending,true);
  assert.ok(waitingOutcome(p,new Map()).error);
  assert.ok(waitingOutcome(p,new Map([['child',{status:'failed'}]])).error);
});
test('sweep completes waiting parents without scheduler quota, leaves pending and retries child failure',async t=>{
  const queries:string[]=[],updates:any[]=[];
  const base={payload:{trajectory_id:'trace'},status:'queued',attempts:0};
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    queries.push(sql);
    if(sql.startsWith('SELECT * FROM jobs WHERE kind=')){
      assert.match(sql,/lease_until<now/);assert.match(sql,/FOR UPDATE SKIP LOCKED LIMIT 100/);
      return {rows:['done','pending','failed'].map(id=>({...base,id,checkpoint:{children:[{job_id:id}],candidates:[1,2],finalCandidates:[1]}}))};
    }
    if(sql.startsWith('SELECT id,status,result'))return {rows:[{id:args[0][0],status:args[0][0]==='done'?'succeeded':args[0][0]==='failed'?'failed':'running',result:{ids:['strategy']}}]};
    if(sql.startsWith('UPDATE jobs'))updates.push({sql,args});
    return {rows:[]};
  }} as any));
  assert.deepEqual(await sweepWaiting(),{checked:3,completed:1});
  const finished=updates.find(u=>u.args[0]==='done');assert.equal(JSON.parse(finished.args[1]).strategy_count,1);
  assert.match(updates.find(u=>u.args[0]==='failed').sql,/attempts\+1 >=/);
  assert.match(updates.find(u=>u.args[0]==='pending').sql,/interval '15 seconds'/);
  assert.ok(!queries.some(q=>q.includes('worker_scheduler')));assert.equal(queries.at(-1),'COMMIT');
});
test('sweep database failure rolls back all parent transitions',async t=>{
  const queries:string[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string) {
    queries.push(sql);
    if(sql.startsWith('SELECT *'))return {rows:[{id:'parent',payload:{trajectory_id:'t'},checkpoint:{children:[]}}]};
    if(sql.startsWith('UPDATE'))throw new Error('disk error');
    return {rows:[]};
  }} as any));
  await assert.rejects(sweepWaiting(),/disk error/);assert.equal(queries.at(-1),'ROLLBACK');
});
test('child enqueue validates parent lease before writes and persists explicit policy',async t=>{
  let live=false;const payloads:any[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    if(sql.startsWith('SELECT * FROM jobs'))return {rows:live?[{}]:[]};
    if(sql.startsWith('INSERT INTO jobs')){payloads.push(JSON.parse(args[0]));return {rows:[{id:'child'}]};}
    return {rows:[]};
  }} as any));
  const content:any={role:'paper',sourceType:'review',strategy:'action',executionSummary:'observed'};
  const parent:any={id:'parent',lease_token:'lease'};
  await assert.rejects(submit('experience',content,[],{parentJob:parent,policyVersion:'legacy-v1'}),/lease lost/);
  assert.equal(payloads.length,0);live=true;
  await submit('experience',content,[],{parentJob:parent,policyVersion:'legacy-v1'});
  await submit('experience',content);
  assert.deepEqual(payloads.map(p=>p.policyVersion),['legacy-v1','selective-v2']);
});
