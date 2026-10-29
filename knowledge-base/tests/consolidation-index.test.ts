import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../src/db.js';
import {ensureIndexes,retrieveCandidates} from '../src/consolidation-index.js';
import {versionDraft,distillationProgress,migrateConsolidation,advanceCandidate,snapshotTargets,applyConsolidation} from '../src/consolidation-state.js';
import {checkConsolidation} from '../src/agents.js';
import {config} from '../src/config.js';
import {readFileSync} from 'node:fs';

const id='00000000-0000-4000-8000-000000000001';
const job:any={id,lease_token:'lease'};
const draft=(name:string,stage='custom stage')=>versionDraft({candidateId:name,
  experience:{sourceType:'trajectory',role:'worker',strategy:`验证 evidence ${name}`,executionSummary:'observed',stage},
  sources:[{type:'trajectory',id}]});
const vector=Array(1024).fill(.01);
function mockDatabase(t:any) {
  let rows=new Set<string>(),saved=new Set<string>(),chunks=0,lease=true,failChunk=false;
  const calls:{sql:string;args:any[]}[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string,args:any[]=[]) {
    calls.push({sql,args});
    if(sql==='BEGIN')saved=new Set(rows);
    if(sql==='ROLLBACK')rows=new Set(saved);
    if(sql.includes('FROM jobs'))return {rows:lease?[job]:[],rowCount:lease?1:0};
    if(sql.startsWith('INSERT INTO distillation_candidate_indexes')) {
      const key=JSON.stringify([args[0],args[1],args[2],args[4],args[3]]),exists=rows.has(key);rows.add(key);
      return {rows:exists?[]:[{}],rowCount:exists?0:1};
    }
    if(sql.startsWith('INSERT INTO distillation_candidate_chunks')){if(failChunk)throw new Error('chunk write failed');chunks++;}
    return {rows:[],rowCount:0};
  }} as any));
  t.mock.method(pool,'query',async(sql:string,args:any[])=>{
    calls.push({sql,args});
    if(sql.includes('SELECT 1 FROM distillation_candidate_indexes'))return {rows:[],rowCount:rows.has(JSON.stringify(args))?1:0};
    return {rows:[],rowCount:0};
  });
  let embeddings=0;
  t.mock.method(globalThis,'fetch',async(url:any)=>{
    embeddings++;return new Response(JSON.stringify(String(url).endsWith('/query')?{embedding:vector,model_version:'model'}:
      {model_version:'model',chunks:[{text:'验证 evidence',location:{},embedding:vector}]}));
  });
  return {calls,get count(){return rows.size;},get chunks(){return chunks;},get embeddings(){return embeddings;},
    loseLease(){lease=false;},failChunk(){failChunk=true;},repairChunk(){failChunk=false;}};
}

test('index preparation is idempotent by task, candidate, content and model; stale lease cannot publish',async t=>{
  const db=mockDatabase(t),a=draft('a');
  await ensureIndexes(job,[a],'model');await ensureIndexes(job,[a],'model');
  assert.equal(db.count,1);assert.equal(db.chunks,1);assert.equal(db.embeddings,1);
  const changed=versionDraft({...a,experience:{...a.experience,strategy:'new advice'}});
  assert.notEqual(changed.version,a.version);
  await ensureIndexes(job,[changed],'model');assert.equal(db.count,2);
  db.loseLease();await assert.rejects(ensureIndexes({...job,id:'another-job'},[a],'model'),/lease lost/);
  assert.equal(db.count,2);
});

test('transaction rollback never exposes a partial vector index; recovery repeats only unfinished writes',async t=>{
  const db=mockDatabase(t);db.failChunk();
  await assert.rejects(ensureIndexes(job,[draft('a')],'model'),/chunk write failed/);assert.equal(db.count,0);
  db.repairChunk();await ensureIndexes(job,[draft('a')],'model');assert.equal(db.count,1);
  assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));
});

test('retrieval fuses two lists, bounds Top-K, and scopes every query to active versions, task, role and model',async t=>{
  const db=mockDatabase(t),items=Array.from({length:8},(_,i)=>draft(`item-${i}`,`stage ${i}`));
  await ensureIndexes(job,items,'model');
  const queries:{sql:string;args:any[]}[]=[];
  t.mock.method(pool,'query',async(sql:string,args:any[])=>{
    if(sql.includes('SELECT 1'))return {rows:[{}],rowCount:1};
    queries.push({sql,args});
    const order=sql.includes('WITH q')?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7];
    return {rows:order.map(i=>({id:items[i].candidateId,entity_id:items[i].candidateId}))};
  });
  const result=await retrieveCandidates(job,draft('incoming'),items,'model');
  assert.equal(result.targets.length,5);assert.equal(new Set(result.targets.map(d=>d.candidateId)).size,5);
  assert.ok(result.targets.some(d=>d.candidateId==='item-7'));assert.ok(result.targets.some(d=>d.candidateId==='item-0'));
  for(const {sql,args} of queries){
    assert.match(sql,/c.job_id=\$1 AND i.role=\$3 AND c.model_version=\$4/);
    assert.match(sql,/active.version=c.content_version/);assert.match(sql,/LIMIT 20/);
    assert.doesNotMatch(sql,/stage|search_chunks|entities/);assert.equal(args[0],job.id);assert.equal(args[2],'worker');
    assert.deepEqual(JSON.parse(args[1]),items.map(d=>({id:d.candidateId,version:d.version})));
    for(let i=1;i<=args.length;i++)assert.ok(sql.includes(`$${i}`));
  }
  assert.match(queries[0].sql,/string_agg[\s\S]*' \| '/);assert.equal(db.count,8);
  const old=config.consolidationTopK;
  try {config.consolidationTopK=1;assert.equal((await retrieveCandidates(job,draft('in'),items,'model')).targets.length,1);}
  finally {config.consolidationTopK=old;}
});

test('embedding errors and model changes cannot masquerade as no related candidates',async t=>{
  mockDatabase(t);
  await assert.rejects(retrieveCandidates(job,draft('a'),[],'old-model'),/model version changed/);
  await assert.rejects(ensureIndexes(job,[draft('a')],'old-model'),/model version changed/);
  t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:503}));
  await assert.rejects(retrieveCandidates(job,draft('a'),[]),/HTTP 503/);
});

test('bounded multilingual retrieval text preserves Unicode characters',async t=>{
  mockDatabase(t);let seen='';
  t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{
    seen=JSON.parse(init.body).text;return new Response(JSON.stringify({embedding:vector,model_version:'model'}));
  });
  const current=versionDraft({...draft('unicode'),experience:{...draft('unicode').experience,strategy:'文😀'.repeat(6000)}});
  const result=await retrieveCandidates(job,current,[]);
  assert.equal(Array.from(seen).length,8000);assert.equal(Buffer.from(seen).toString('utf8'),seen);assert.deepEqual(result.targets,[]);
});

test('multi-target merge preserves real sources, reduces candidates and invalidates the query snapshot',()=>{
  const a=draft('a'),b=versionDraft({...draft('b'),sources:[{type:'trajectory',id,event_range:{start:1,end:2}}]}),current=draft('c');
  const c:any={current,items:[a,b],decisions:[],agentDecisionCount:0,snapshot:{currentId:'c',version:current.version,targets:[a,b].map(d=>({candidateId:d.candidateId,version:d.version}))}};
  const targets=snapshotTargets(c);
  const decision=checkConsolidation({action:'merge',candidateId:'c',candidateVersion:current.version,
    targets:targets.map(d=>({candidateId:d.candidateId,version:d.version})),experience:current.experience,reason:'same action'},current,targets,'worker');
  applyConsolidation(c,decision);
  assert.equal(c.items.length,0);assert.equal(c.current.sources.length,2);assert.notEqual(c.current.version,current.version);
  assert.equal(c.currentProtected,true);assert.equal(c.snapshot,null);assert.equal(c.indexPending,true);
  assert.throws(()=>checkConsolidation({action:'drop',candidateId:'c',candidateVersion:c.current.version,reason:'covered'},c.current,[],'worker',false),/cannot drop/);
});

test('snapshot target versions cannot silently switch and progress separates retained from published',()=>{
  const p:any={candidates:[draft('a')],consolidation:{next:1,current:draft('a'),items:[draft('b')],decisions:[],compare:0,assessed:true}};
  migrateConsolidation(p);const c=p.consolidation;
  c.snapshot={currentId:'a',version:c.current.version,targets:[{candidateId:'b',version:'stale'}]};
  assert.throws(()=>snapshotTargets(c),/version changed/);
  assert.equal(migrateConsolidation(p),false);
  const progress=distillationProgress({status:'queued',checkpoint:{...p,phase:'consolidating'}});
  assert.equal(progress.retained_count,1);assert.equal(progress.strategy_count,null);assert.equal(progress.consolidation_algorithm,'retrieval-v1');
  const empty:any={candidates:[]};migrateConsolidation(empty);advanceCandidate(empty);assert.equal(empty.phase,'submitting');
});

test('private indexes cascade with job cleanup and are not added to public search',()=>{
  const migration=readFileSync(new URL('../migrations/004_retrieval_consolidation.sql',import.meta.url),'utf8');
  assert.match(migration,/REFERENCES jobs\(id\) ON DELETE CASCADE/);
  assert.match(migration,/REFERENCES distillation_candidate_indexes ON DELETE CASCADE/);
  const store=readFileSync(new URL('../src/store.ts',import.meta.url),'utf8');
  assert.doesNotMatch(store.slice(store.indexOf('export async function search('),store.indexOf('export async function candidates(')),/distillation_candidate/);
});
