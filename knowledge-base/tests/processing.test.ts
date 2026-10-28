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
function harness(candidates:any[]=[candidate],checkpoint:any=null) {
  let saved=checkpoint,finished:any,modelCalls=0,submitCalls=0;
  const receipts=new Map();
  const deps:any={store:{
    read:async()=>({id,content:'{}',line_count:1,origins:[{agentRole:'worker'}]}),
    checkpoint:async(_j:any,p:any)=>{saved=structuredClone(p);},defer:async()=>{},
    submit:async(content:any,sources:any)=>{submitCalls++;const key=JSON.stringify({content,sources});if(!receipts.has(key))receipts.set(key,{id:`strategy-${receipts.size}`,status:'duplicate'});return receipts.get(key);},
    getJob:async()=>({status:'succeeded',result:{ids:['existing']}}),finish:async(_j:any,result:any)=>{finished=result;},
  },distillSegment:async()=>{modelCalls++;return {summary:'summary',candidates};},
    consolidate:async(current:any)=>({action:'keep',candidateId:current.candidateId,reason:'independent supported lesson'})};
  const step=()=>processDistill(job(structuredClone(saved)),deps);
  return {deps,step,get saved(){return saved;},get finished(){return finished;},get modelCalls(){return modelCalls;},get submitCalls(){return submitCalls;},receipts};
}
async function drain(h:any){for(let i=0;i<100&&!h.finished;i++)await h.step();assert.ok(h.finished);}

test('candidates are checkpointed, consolidated, submitted and recovered without re-generation',async()=>{
  const h=harness();await h.step();assert.equal(h.saved.phase,'consolidating');assert.equal(h.submitCalls,0);
  await drain(h);assert.equal(h.modelCalls,1);assert.equal(h.submitCalls,1);assert.deepEqual(h.finished.ids,['strategy-0']);
});
test('legacy candidate checkpoint enters consolidation without repeating segments',async()=>{
  const h=harness([],{next:1,summary:'saved',candidates:[candidate],children:null});
  await drain(h);assert.equal(h.modelCalls,0);assert.equal(h.finished.consolidated_count,1);
});
test('same advice merges sources and restarts comparison; distinct advice survives',async()=>{
  const a={...candidate,sources:[{type:'trajectory',id,event_range:{start:1,end:1}}]},b={...candidate,sources:[{type:'trajectory',id}]};
  const h=harness([a,{...a,experience:{...a.experience,strategy:'different'}},b]);let comparisons=0;
  h.deps.consolidate=async(current:any,other:any)=>{
    if(other)comparisons++;
    return other&&current.experience.strategy===other.experience.strategy?
      {action:'merge',candidateId:current.candidateId,targetId:other.candidateId,experience:current.experience,reason:'same advice'}:
      {action:'keep',candidateId:current.candidateId,reason:'independent'};
  };
  await drain(h);assert.equal(h.finished.consolidated_count,2);assert.ok(comparisons>=3);
  assert.equal(h.saved.finalCandidates.find((c:any)=>c.experience.strategy==='action').sources.length,2);
});
test('all low-value advice may be dropped and zero-output trajectory succeeds',async()=>{
  const h=harness();h.deps.consolidate=async(c:any)=>({action:'drop',candidateId:c.candidateId,reason:'incidental tool success'});
  await drain(h);assert.equal(h.submitCalls,0);assert.deepEqual(h.finished.ids,[]);
});
test('there is no whole-trajectory five-strategy hard cap',async()=>{
  const h=harness(Array.from({length:6},(_,i)=>({...candidate,experience:{...candidate.experience,strategy:`distinct ${i}`}})));
  await drain(h);assert.equal(h.finished.consolidated_count,6);
});
test('lost submission receipt repeats stable content and yields only one stored strategy',async()=>{
  const h=harness();while(h.saved?.phase!=='submitting')await h.step();
  const original=h.deps.store.submit;let fail=true;
  h.deps.store.submit=async(...args:any[])=>{const receipt=await original(...args);if(fail){fail=false;throw new Error('lost receipt');}return receipt;};
  await assert.rejects(h.step(),/lost receipt/);await drain(h);
  assert.equal(h.receipts.size,1);assert.equal(h.submitCalls,2);assert.equal(h.modelCalls,1);
});
test('legacy children retain their IDs without consolidation or resubmission',async()=>{
  const h=harness([],{children:[{job_id:'original'}],candidates:[candidate]});
  h.deps.consolidate=async()=>assert.fail('must not reprocess');h.deps.store.submit=async()=>assert.fail('must not resubmit');
  await drain(h);assert.deepEqual(h.finished.ids,['existing']);assert.equal(h.modelCalls,0);
});
test('child failure does not report successful distillation',async()=>{
  const h=harness([],{children:[{job_id:'failed-child'}],candidates:[]});h.deps.store.getJob=async()=>({status:'failed'});
  await assert.rejects(h.step(),/child ingestion failed/);
});
test('source identity and role mismatch stop generation before any submission',async()=>{
  const h=harness([{...candidate,experience:{...candidate.experience,role:'manager'}}]);
  await assert.rejects(h.step(),/role must equal/);assert.equal(h.submitCalls,0);
  h.deps.store.read=async()=>({id,content:'{}',line_count:1,origins:[]});await assert.rejects(h.step(),/identity/);
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
