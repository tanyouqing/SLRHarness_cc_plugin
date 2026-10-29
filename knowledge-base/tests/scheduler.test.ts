import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../src/db.js';
import {claim,defer} from '../src/store.js';

test('distillation scheduling grants two completion turns then extraction, with persisted counters',async t=>{
  let ingest=0,completion=0;const chosen:string[]=[],queries:string[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    queries.push(sql);
    if(sql.startsWith('SELECT ingest_streak'))return {rows:[{ingest_streak:ingest,completion_streak:completion}]};
    if(sql.startsWith('SELECT id,kind,')){
      assert.equal(args[1],'ingest'); // No ingest row exists in this fixture: SQL falls back to distill.
      const phase=args[2]?'consolidating':'segments';chosen.push(phase);return {rows:[{id:'task',kind:'distill',phase}]};
    }
    if(sql.startsWith('UPDATE worker_scheduler'))[ingest,completion]=args;
    if(sql.includes("SET status='running'"))return {rows:[{id:'task'}]};
    return {rows:[]};
  }} as any));
  for(let i=0;i<6;i++)await claim();
  assert.deepEqual(chosen,['consolidating','consolidating','segments','consolidating','consolidating','segments']);
  const sql=queries.find(q=>q.startsWith('SELECT id,kind,'))!;
  assert.doesNotMatch(sql,/interval '15 minutes'/);
  assert.match(sql,/NOT IN \('segments','triage'\)/);
  assert.match(sql,/AND NOT \(kind='distill'.*='waiting'\)/);
  assert.ok(sql.indexOf('=$3::boolean')<sql.indexOf('scheduled_at NULLS FIRST'));
  assert.match(sql,/scheduled_at NULLS FIRST, created_at,id FOR UPDATE SKIP LOCKED/);
});

test('fallback to completion when extraction is empty does not erase the extraction entitlement',async t=>{
  let completion=2;
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    if(sql.startsWith('SELECT ingest_streak'))return {rows:[{ingest_streak:0,completion_streak:completion}]};
    if(sql.startsWith('SELECT id,kind,')){assert.equal(args[2],false);return {rows:[{id:'task',kind:'distill',phase:'submitting'}]};}
    if(sql.startsWith('UPDATE worker_scheduler'))completion=args[1];
    if(sql.includes("SET status='running'"))return {rows:[{id:'task'}]};
    return {rows:[]};
  }} as any));
  await claim();await claim();assert.equal(completion,2);
});

test('productive yields are immediately runnable, waiting children delay 15s, and lease loss prevents mutation',async t=>{
  let lease=true;const delays:number[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    if(sql.startsWith('SELECT * FROM jobs'))return {rows:lease?[{}]:[]};
    if(sql.includes("SET status='queued'")){
      assert.match(sql,/attempts=GREATEST\(attempts-1,0\)/);assert.match(sql,/lease_token=NULL,lease_until=NULL/);delays.push(args[1]);
    }
    return {rows:[]};
  }} as any));
  const job:any={id:'task',lease_token:'lease'};
  await defer(job);await defer(job,15);assert.deepEqual(delays,[0,15]);
  lease=false;await assert.rejects(defer(job),/lease lost/);assert.equal(delays.length,2);
  await assert.rejects(defer(job,-1),/invalid defer/);
});
