import test from 'node:test';
import assert from 'node:assert/strict';
import {processIngest,processDistill} from '../src/processing.js';
const id='00000000-0000-4000-8000-000000000001';
const candidate={experience:{sourceType:'trajectory',role:'worker',stage:'reading',task:'test',executionSummary:'observation',strategy:'action',applicability:'condition'},sources:[{type:'trajectory',id}]};
function job(checkpoint:any=null):any{return {id,kind:'distill',payload:{trajectory_id:id},checkpoint,lease_token:id,attempts:1};}
test('queued ingestion with a legacy unsupported role cannot bypass current validation',async()=>{
  let reachedStore=false;
  const deps:any={store:{candidates:async()=>{reachedStore=true;return [];}}};
  await assert.rejects(processIngest({...job(),payload:{kind:'experience',content:{...candidate.experience,role:'reviewer'}}},deps));
  assert.equal(reachedStore,false);
});
test('distillation checkpoints candidates before queuing, waits for child ingestion, then resumes without re-generating',async()=>{
  let persisted:any=null,distillCalls=0,childState='queued',deferred=0,finished:any;
  const deps:any={store:{
    read:async()=>({id,content:'{"event":"done"}',line_count:1}),
    checkpoint:async(_j:any,value:any)=>{persisted=structuredClone(value);},
    submit:async()=>{assert.ok(persisted.candidates.length);return {status:'pending',id:null,job_id:'child'};},
    getJob:async()=>({status:childState,result:{ids:['strategy']}}),
    defer:async()=>{deferred++;},finish:async(_j:any,result:any)=>{finished=result;},
  },distillSegment:async()=>{distillCalls++;return {summary:'summary',candidates:[candidate]};}};
  await processDistill(job(),deps);assert.equal(deferred,1);assert.equal(distillCalls,1);assert.equal(finished,undefined);
  childState='succeeded';await processDistill(job(persisted),deps);
  assert.equal(distillCalls,1);assert.deepEqual(finished.ids,['strategy']);
});
test('failure after candidate checkpoint resumes submission without repeating model calls',async()=>{
  const saved={next:1,summary:'saved',candidates:[candidate],children:null};
  let finished:any;
  const deps:any={distillSegment:async()=>{throw new Error('must not invoke model');},store:{
    read:async()=>({id,content:'{}',line_count:1}),checkpoint:async()=>{},
    submit:async()=>({status:'duplicate',id:'existing',job_id:null}),finish:async(_j:any,r:any)=>{finished=r;},
  }};
  await processDistill(job(saved),deps);assert.deepEqual(finished.ids,['existing']);
});
test('child failure does not report successful distillation',async()=>{
  const deps:any={store:{read:async()=>({id,content:'{}',line_count:1}),getJob:async()=>({status:'failed'})}};
  await assert.rejects(processDistill(job({children:[{job_id:'failed-child'}],candidates:[]}),deps),/child ingestion failed/);
});
test('index failure prevents publication',async()=>{
  let published=false;
  const deps:any={store:{candidates:async()=>[],publish:async()=>{published=true;}},prepare:async()=>{throw new Error('embedding offline');}};
  await assert.rejects(processIngest({...job(),payload:{kind:'experience',content:candidate.experience,sources:[]}},deps),/embedding offline/);
  assert.equal(published,false);
});
test('identical candidate bypasses LLM and embedding while retaining duplicate publication',async()=>{
  let action:any;
  const deps:any={store:{candidates:async()=>[{id,revision:2,content:candidate.experience}],publish:async(_j:any,d:any)=>{action=d.action;}},prepare:async()=>{throw new Error('should not embed');},manage:async()=>{throw new Error('should not call LLM');}};
  await processIngest({...job(),payload:{kind:'experience',content:candidate.experience}},deps);assert.equal(action,'duplicate');
});
