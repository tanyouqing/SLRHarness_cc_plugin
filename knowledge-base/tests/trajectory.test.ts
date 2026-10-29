import test from 'node:test';
import assert from 'node:assert/strict';
import {trajectoryInput,sha256,assemble,trajectoryMetadata} from '../src/trajectory.js';
import {pool} from '../src/db.js';
import {submitTrajectory,claim} from '../src/store.js';
import {processDistill} from '../src/processing.js';
const metadata=trajectoryMetadata.parse({runId:'r',agentId:'a',agentRole:'worker',sessionId:'s',originalHash:'a'.repeat(64),projectionVersion:'1',lineMapping:'embedded-originalLine'});

// Transactional in-memory DB adapter exercises the real store code; never opens PostgreSQL.
function database(t:any) {
  let state:any={transfers:{},parts:{},trajectories:{},origins:{},jobs:{}};let saved:any;
  const db={release(){},async query(sql:string,args:any[]=[]) {
    let rows:any[]=[];
    if(sql==='BEGIN')saved=structuredClone(state);
    else if(sql==='ROLLBACK')state=saved;
    else if(sql==='COMMIT'||sql.startsWith('SELECT pg_advisory')){}
    else if(sql.startsWith('INSERT INTO trajectory_transfers'))state.transfers[args[0]]??={content_hash:args[1],part_count:args[2],metadata:args[3]?JSON.parse(args[3]):null};
    else if(sql.startsWith('SELECT * FROM trajectory_transfers'))rows=[state.transfers[args[0]]];
    else if(sql.startsWith('SELECT content_hash FROM trajectory_transfer_parts'))rows=state.parts[args[0]+args[1]]?[state.parts[args[0]+args[1]]]:[];
    else if(sql.startsWith('INSERT INTO trajectory_transfer_parts'))state.parts[args[0]+args[1]]??={transfer:args[0],index:args[1],content:args[2],content_hash:args[3]};
    else if(sql.startsWith('SELECT part_index AS index'))rows=Object.values(state.parts).filter((p:any)=>p.transfer===args[0]);
    else if(sql.startsWith('SELECT id,distillation_blocked_reason FROM trajectories'))rows=Object.values(state.trajectories).filter((t:any)=>t.id===args[0]);
    else if(sql.startsWith('SELECT metadata FROM trajectory_origins'))rows=Object.entries(state.origins).filter(([key])=>key.startsWith(args[0])).map(([,metadata])=>({metadata}));
    else if(sql.startsWith('SELECT id FROM trajectories'))rows=state.trajectories[args[0]]?[state.trajectories[args[0]]]:[];
    else if(sql.startsWith('INSERT INTO trajectories')){const row={id:`trace-${Object.keys(state.trajectories).length}`,content:args[0]};state.trajectories[args[1]]=row;rows=[row];}
    else if(sql.startsWith('INSERT INTO trajectory_origins'))state.origins[args[0]+args[1]]=JSON.parse(args[2]);
    else if(sql.startsWith('SELECT id FROM jobs'))rows=state.jobs[args[0]]?[state.jobs[args[0]]]:[];
    else if(sql.startsWith('INSERT INTO jobs')){const key=JSON.parse(args[0]).trajectory_id;const row={id:`job-${key}`};state.jobs[key]=row;rows=[row];}
    else if(sql.startsWith('UPDATE trajectory_transfers'))state.transfers[args[0]].receipt=args[1]?JSON.parse(args[1]):null;
    else throw new Error('unexpected SQL '+sql);
    return {rows,rowCount:rows.length};
  }};
  t.mock.method(pool,'connect',async()=>db as any);return ()=>state;
}
test('legacy JSONL remains accepted; metadata roles differ from experience applicability',()=>{
  assert.deepEqual(trajectoryInput.parse({content:'{}'}),{content:'{}'});
  assert.equal(metadata.agentRole,'worker');assert.throws(()=>trajectoryMetadata.parse({...metadata,agentRole:'assistant'}));
  assert.throws(()=>trajectoryInput.parse({content:'a'.repeat(4*1024*1024+1),transfer:{id:'a'.repeat(64),index:0,count:1,contentHash:'a'.repeat(64)}}));
});
test('out-of-order/repeated parts, lost final receipt, origins and direct duplicates share one trajectory/job',async t=>{
  const state=database(t),parts=['{"event":','"done"}\n'],content=parts.join('');
  const transfer=(index:number)=>({id:'b'.repeat(64),index,count:2,contentHash:sha256(content)});
  assert.equal((await submitTrajectory(parts[1],metadata,transfer(1))).status,'accepted');
  assert.equal((await submitTrajectory(parts[1],metadata,transfer(1))).received,1);
  const receipt=await submitTrajectory(parts[0],metadata,transfer(0));assert.equal(receipt.status,'stored');
  assert.deepEqual(await submitTrajectory(parts[1],metadata,transfer(1)),receipt);
  await assert.rejects(submitTrajectory('different',metadata,transfer(1)),/conflict/);
  await assert.rejects(submitTrajectory(parts[0],{...metadata,agentRole:'manager'},transfer(0)),/metadata conflict/);
  const duplicate=await submitTrajectory(content,{...metadata,agentId:'a2'});
  assert.equal(duplicate.id,receipt.id);assert.equal(duplicate.job_id,receipt.job_id);
  assert.equal(Object.keys(state().trajectories).length,1);assert.equal(Object.keys(state().jobs).length,1);assert.equal(Object.keys(state().origins).length,2);
});
test('bad assembled hash/JSON rolls back completion without losing prior parts',async t=>{
  const state=database(t),transfer=(index:number)=>({id:'c'.repeat(64),index,count:2,contentHash:sha256('{}\n')});
  await submitTrajectory('{',undefined,transfer(0));
  await assert.rejects(submitTrajectory('wrong',undefined,transfer(1)),/hash mismatch/);
  assert.equal(Object.keys(state().parts).length,1);assert.equal(Object.keys(state().jobs).length,0);
  assert.equal((await submitTrajectory('}\n',undefined,transfer(1))).status,'stored');
  assert.throws(()=>assemble([{index:0,content:'not json'}],1,sha256('not json')),/invalid JSON/);
});
test('distillation yields after one segment, carries identity and resumes legacy checkpoint',async()=>{
  let saved:any,modelCalls=0,deferred=0;const content=JSON.stringify({text:'a'.repeat(33000)});
  const deps:any={store:{read:async()=>({id:'t',content,line_count:1,origins:[metadata]}),checkpoint:async(_j:any,p:any)=>{saved=structuredClone(p);},defer:async()=>{deferred++;}},
    distillSegment:async(_id:any,_lines:any,segment:any,summary:any,origins:any)=>{modelCalls++;assert.equal(origins[0].agentRole,'worker');return {summary:'next',candidates:[]};}};
  const job:any={checkpoint:{next:1,summary:'legacy',candidates:[],children:null},payload:{trajectory_id:'t'}};
  await processDistill(job,deps);assert.equal(modelCalls,1);assert.equal(saved.next,2);assert.equal(saved.total,3);assert.equal(deferred,1);
});
test('scheduler prioritizes ingestion at most five times, then rotates distillation via scheduled_at',async t=>{
  let streak=0;const kinds:string[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    if(sql.startsWith('SELECT ingest_streak'))return {rows:[{ingest_streak:streak,completion_streak:0}]};
    if(sql.startsWith('SELECT id,kind,')){assert.match(sql,/scheduled_at NULLS FIRST/);kinds.push(args[1]);return {rows:[{id:'job',kind:args[1]}]};}
    if(sql.startsWith('UPDATE worker_scheduler'))streak=args[0];
    if(sql.includes("SET status='running'")){assert.match(sql,/scheduled_at=now\(\)/);return {rows:[{id:'job'}]};}
    return {rows:[]};
  }} as any));
  for(let i=0;i<7;i++)await claim();
  assert.deepEqual(kinds,['ingest','ingest','ingest','ingest','ingest','distill','ingest']);
});


test('unknown/unsupported source is stored without a job; conflicting new association cannot create another job',async t=>{
  const state=database(t);
  const unknown=await submitTrajectory('{"unknown":true}');
  assert.equal(unknown.job_id,null);assert.equal(unknown.distillation,'skipped');
  const unsupported=await submitTrajectory('{"reviewer":true}',{...metadata,agentRole:'reviewer'});
  assert.equal(unsupported.job_id,null);
  const valid=await submitTrajectory('{"valid":true}',metadata);assert.ok(valid.job_id);
  const conflict=await submitTrajectory('{"valid":true}',{...metadata,agentRole:'manager'});
  assert.equal(conflict.job_id,null);assert.match(conflict.reason,/conflict/);
  assert.equal(Object.keys(state().jobs).length,1);
});

test('administratively cleared raw trajectory never recreates a job on repeated upload',async t=>{
  const state=database(t),receipt=await submitTrajectory('{"cleared":true}',metadata);
  const row:any=Object.values(state().trajectories)[0];row.distillation_blocked_reason='role cleanup';
  delete state().jobs[row.id];
  const again=await submitTrajectory('{"cleared":true}',metadata);
  assert.equal(again.id,receipt.id);assert.equal(again.job_id,null);assert.equal(again.distillation,'skipped');
  assert.equal(Object.keys(state().jobs).length,0);
});
