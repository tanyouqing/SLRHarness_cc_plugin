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
function harness(candidates:any[]=[candidate],checkpoint:any=null,policyVersion?:string) {
  let saved=checkpoint,finished:any,modelCalls=0,submitCalls=0;
  const receipts=new Map();
  const deps:any={store:{
    read:async()=>({id,content:'{}',line_count:1,origins:[{agentRole:'worker'}]}),
    checkpoint:async(_j:any,p:any)=>{saved=structuredClone(p);},defer:async()=>{},
    submit:async(content:any,sources:any)=>{submitCalls++;const key=JSON.stringify({content,sources});if(!receipts.has(key))receipts.set(key,{id:`strategy-${receipts.size}`,status:'duplicate'});return receipts.get(key);},
    getJob:async()=>({status:'succeeded',result:{ids:['existing']}}),finish:async(_j:any,result:any)=>{finished=result;},
  },distillSegment:async()=>{modelCalls++;return {summary:'summary',candidates};},
    ensureIndexes:async()=> 'test-model',retrieveCandidates:async(_j:any,_c:any,items:any[])=>({targets:items.slice(0,5),modelVersion:'test-model'}),
    consolidate:async(current:any)=>({action:'keep',candidateId:current.candidateId,candidateVersion:current.version,reason:'independent supported lesson'})};
  const step=()=>{const j=job(structuredClone(saved));if(policyVersion)j.payload.policyVersion=policyVersion;return processDistill(j,deps);};
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
  h.deps.consolidate=async(current:any,targets:any[])=>{
    comparisons++;
    const matches=targets.filter(t=>t.experience.strategy===current.experience.strategy);
    return matches.length?
      {action:'merge',candidateId:current.candidateId,candidateVersion:current.version,targets:matches.map(t=>({candidateId:t.candidateId,version:t.version})),experience:current.experience,reason:'same advice'}:
      {action:'keep',candidateId:current.candidateId,candidateVersion:current.version,reason:'independent'};
  };
  await drain(h);assert.equal(h.finished.consolidated_count,2);assert.equal(comparisons,4);
  assert.equal(h.saved.finalCandidates.find((c:any)=>c.experience.strategy==='action').sources.length,2);
});
test('all low-value advice may be dropped and zero-output trajectory succeeds',async()=>{
  const h=harness();h.deps.consolidate=async(c:any)=>({action:'drop',candidateId:c.candidateId,candidateVersion:c.version,reason:'incidental tool success'});
  await drain(h);assert.equal(h.submitCalls,0);assert.deepEqual(h.finished.ids,[]);
});
test('there is no whole-trajectory five-strategy hard cap',async()=>{
  const h=harness(Array.from({length:6},(_,i)=>({...candidate,experience:{...candidate.experience,strategy:`distinct ${i}`}})));
  await drain(h);assert.equal(h.finished.consolidated_count,6);
});
test('lost submission receipt repeats stable content and yields only one stored strategy',async()=>{
  const h=harness();await h.step();
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

test('twenty independent candidates require twenty model decisions, not pairwise calls',async()=>{
  const h=harness(Array.from({length:20},(_,i)=>({...candidate,experience:{...candidate.experience,strategy:`distinct ${i}`}})));
  let calls=0;const original=h.deps.consolidate;
  h.deps.consolidate=async(...args:any[])=>{calls++;assert.ok(args[1].length<=5);return original(...args);};
  await h.step();await h.step();
  assert.equal(h.saved.consolidation.items.length,1);
  assert.equal(h.saved.consolidation.current.candidateId,'candidate-1');
  assert.equal(calls,1); // no dispatch just to append the previous candidate
  await drain(h);assert.equal(calls,20);assert.equal(h.finished.strategy_count,20);
});

test('model failure reuses the durable retrieved ID/version snapshot',async()=>{
  const h=harness();await h.step();let retrievals=0;
  const retrieve=h.deps.retrieveCandidates,model=h.deps.consolidate;
  h.deps.retrieveCandidates=async(...args:any[])=>{retrievals++;return retrieve(...args);};
  h.deps.consolidate=async()=>{throw new Error('provider down');};
  await assert.rejects(h.step(),/provider down/);assert.ok(h.saved.consolidation.snapshot);
  h.deps.consolidate=model;await drain(h);assert.equal(retrievals,1);
});

test('index failure after a decision resumes indexing without replaying that decision',async()=>{
  const h=harness();await h.step();let calls=0,failed=false;
  const model=h.deps.consolidate;
  h.deps.consolidate=async(...args:any[])=>{calls++;return model(...args);};
  h.deps.ensureIndexes=async()=>{if(calls&&!failed){failed=true;throw new Error('embedding offline');}return 'test-model';};
  await assert.rejects(h.step(),/embedding offline/);
  assert.equal(h.saved.consolidation.items.length,1);assert.equal(h.saved.consolidation.indexPending,true);
  await drain(h);assert.equal(calls,1);assert.equal(h.submitCalls,1);
});

test('retrieval failure is not treated as an empty successful result',async()=>{
  const h=harness();await h.step();let calls=0;
  h.deps.retrieveCandidates=async()=>{throw new Error('index unavailable');};
  h.deps.consolidate=async()=>{calls++;};
  await assert.rejects(h.step(),/index unavailable/);assert.equal(calls,0);assert.equal(h.submitCalls,0);
});

test('old pairwise checkpoint preserves merged content, sources and audit history',async()=>{
  const retained={...candidate,candidateId:'candidate-0'};
  const current={...candidate,candidateId:'candidate-2',experience:{...candidate.experience,strategy:'already merged'}};
  const oldDecision={action:'merge',candidateId:'candidate-2',targetId:'candidate-1',reason:'old merge'};
  const h=harness([],{phase:'consolidating',next:1,total:1,summary:'saved',candidates:[candidate,candidate,candidate],
    consolidation:{next:3,items:[retained],current,compare:1,assessed:true,decisions:[oldDecision]},children:null});
  h.deps.consolidate=async(c:any,targets:any[],_role:any,_invoke:any,allowDrop:any)=>{
    assert.equal(c.experience.strategy,'already merged');assert.equal(targets[0].candidateId,'candidate-0');assert.equal(allowDrop,false);
    return {action:'keep',candidateId:c.candidateId,candidateVersion:c.version,reason:'different'};
  };
  await drain(h);assert.equal(h.modelCalls,0);assert.equal(h.finished.consolidated_count,2);
  assert.deepEqual(h.saved.consolidation.decisions[0],oldDecision);assert.equal(h.saved.next,1);
});

test('pending children wait fifteen seconds and do not repeat submission',async()=>{
  const h=harness([],{phase:'waiting',children:[{job_id:'original'}],candidates:[]});let delay:any;
  h.deps.store.getJob=async()=>({status:'queued'});h.deps.store.defer=async(_j:any,d:any)=>{delay=d;};
  await h.step();assert.equal(delay,15);assert.equal(h.submitCalls,0);assert.equal(h.finished,undefined);
});

test('failure before decision checkpoint commit cannot duplicate retained candidates',async()=>{
  const h=harness();await h.step();let fail=true;
  const save=h.deps.store.checkpoint;
  h.deps.store.checkpoint=async(j:any,p:any)=>{
    if(fail&&p.consolidation?.agentDecisionCount===1){fail=false;throw new Error('transaction rollback');}
    return save(j,p);
  };
  await assert.rejects(h.step(),/transaction rollback/);assert.equal(h.saved.consolidation.items.length,0);
  await drain(h);assert.equal(h.saved.consolidation.items.length,1);assert.equal(h.submitCalls,1);
});

for(const kind of ['failure','recovered_success','unique_success','unknown'])test(`new ${kind} triage is saved once and passed to extraction`,async()=>{
  const h=harness([],null,'selective-v2');let calls=0;
  h.deps.assessTrajectory=async()=>{calls++;return {kind,reason:'task outcome',evidence:[{start:1,end:1,observation:'result'}],...(kind==='unique_success'?{uniqueValue:'non-obvious evidenced technique'}:{})};};
  h.deps.distillSegment=async(...args:any[])=>{assert.equal(args[6],'selective-v2');assert.equal(args[7].kind,kind);return {summary:'later repair resolved earlier error',candidates:[]};};
  await h.step();assert.equal(h.saved.triage.kind,kind);await drain(h);assert.equal(calls,1);assert.equal(h.submitCalls,0);
});
test('ordinary successful trajectory finishes without extraction, indexing or consolidation',async()=>{
  const h=harness([],null,'selective-v2');let calls=0;
  h.deps.assessTrajectory=async()=>{calls++;return {kind:'routine_success',reason:'ordinary task completed',evidence:[{start:1,end:1,observation:'completed'}]};};
  h.deps.distillSegment=h.deps.consolidate=h.deps.ensureIndexes=async()=>assert.fail('routine success must skip');
  const finish=h.deps.store.finish;let fail=true;
  h.deps.store.finish=async(...args:any[])=>{if(fail){fail=false;throw new Error('lost finish');}return finish(...args);};
  await assert.rejects(h.step(),/lost finish/);assert.equal(h.saved.phase,'skipped');await drain(h);
  assert.equal(calls,1);assert.equal(h.finished.distillation,'skipped');assert.deepEqual(h.finished.ids,[]);
});
test('triage provider failure is recoverable and never treated as a skip',async()=>{
  const h=harness([],null,'selective-v2');h.deps.assessTrajectory=async()=>{throw new Error('provider timeout');};
  await assert.rejects(h.step(),/provider timeout/);assert.equal(h.finished,undefined);assert.equal(h.modelCalls,0);
  h.deps.assessTrajectory=async()=>({kind:'unknown',reason:'outcome missing',evidence:[]});await drain(h);
});
test('legacy task and its ingestion children retain old policy; all final candidates enqueue in one turn',async()=>{
  const finals=Array.from({length:3},(_,i)=>({...candidate,experience:{...candidate.experience,strategy:`independent ${i}`}}));
  const h=harness([],{phase:'submitting',candidates:finals,finalCandidates:finals,children:[],submitted:0});
  const original=h.deps.store.submit;const saved:number[]=[];
  h.deps.store.submit=async(...args:any[])=>{assert.equal(args[3].policyVersion,'legacy-v1');assert.equal(args[3].parentJob.id,id);return original(...args);};
  const save=h.deps.store.checkpoint;h.deps.store.checkpoint=async(j:any,p:any)=>{saved.push(p.submitted);return save(j,p);};
  h.deps.assessTrajectory=async()=>assert.fail('legacy must not triage');
  await h.step();assert.equal(h.submitCalls,3);assert.equal(h.finished.strategy_count,3);assert.ok(saved.includes(1)&&saved.includes(2)&&saved.includes(3));
});
test('interrupted continuous enqueue resumes stable receipts without duplicate children',async()=>{
  const finals=Array.from({length:3},(_,i)=>({...candidate,experience:{...candidate.experience,strategy:`independent ${i}`}}));
  const h=harness([],{phase:'submitting',candidates:finals,finalCandidates:finals,children:[],submitted:0});
  const save=h.deps.store.checkpoint;let fail=true;
  h.deps.store.checkpoint=async(j:any,p:any)=>{if(fail&&p.submitted===2){fail=false;throw new Error('checkpoint lost');}return save(j,p);};
  await assert.rejects(h.step(),/checkpoint lost/);assert.equal(h.saved.submitted,1);await drain(h);
  assert.equal(h.receipts.size,3);assert.equal(h.saved.children.length,3);assert.equal(h.finished.strategy_count,3);
});
