import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {consolidate,distillSegment,type Draft} from '../src/agents.js';
const id='00000000-0000-4000-8000-000000000001';
const candidate:Draft={candidateId:'candidate-0',version:'v0',experience:{sourceType:'trajectory',role:'worker',executionSummary:'observed',strategy:'verify evidence'},sources:[{type:'trajectory',id}]};
// Validate the exact JSON schema exposed to the model, using Pi's real argument
// validator before calling execute. This catches lost required/optional metadata.
function argumentsFor(tool:any,args:any) {
  const wireTool={...tool,parameters:JSON.parse(JSON.stringify(tool.parameters))};
  return validateToolArguments(wireTool,{type:'toolCall',id:'test',name:tool.name,arguments:args});
}
async function execute(tool:any,args:any){return tool.execute('test',argumentsFor(tool,args));}
for(const action of ['keep','drop'] as const)test(`actual consolidation schema accepts minimal ${action} without merge-only fields`,async()=>{
  const result=await consolidate(candidate,[],'worker',async(_r,_p,tools)=>{
    const read=tools.find(t=>t.name==='read_candidate')!,submit=tools.find(t=>t.name==='submit_consolidation')!;
    assert.deepEqual([...submit.parameters.required].sort(),['action','candidateId','candidateVersion','reason']);
    const args={action,candidateId:candidate.candidateId,candidateVersion:candidate.version,reason:'value assessment'};
    assert.deepEqual(argumentsFor(submit,args),args);
    await assert.rejects(execute(submit,args),/read complete/);
    await execute(read,{id:candidate.candidateId,start:0});
    await assert.rejects(execute(submit,{...args,targets:[]}),/fewer|cannot rewrite/i);
    assert.throws(()=>argumentsFor(submit,{...args,sources:[]}));
    assert.throws(()=>argumentsFor(submit,{action,candidateId:candidate.candidateId}));
    await execute(submit,args);
  });
  assert.equal(result.action,action);
});
test('actual merge tool requires valid target and experience at execution and preserves nested optional fields',async()=>{
  const other={...candidate,candidateId:'candidate-1'};
  const result=await consolidate(candidate,[other],'worker',async(_r,_p,tools)=>{
    const read=tools.find(t=>t.name==='read_candidate')!,submit=tools.find(t=>t.name==='submit_consolidation')!;
    for(const c of [candidate,other])await execute(read,{id:c.candidateId,start:0});
    const args={action:'merge',candidateId:candidate.candidateId,candidateVersion:candidate.version,reason:'same advice'};
    await assert.rejects(execute(submit,args),/invalid consolidation merge/);
    await assert.rejects(execute(submit,{...args,targets:[{candidateId:other.candidateId,version:other.version}]}),/invalid consolidation merge/);
    await assert.rejects(execute(submit,{...args,targets:[{candidateId:'invented',version:other.version}],experience:candidate.experience}),/invalid consolidation merge/);
    await assert.rejects(execute(submit,{...args,targets:[{candidateId:other.candidateId,version:other.version}],experience:{...candidate.experience,role:'manager'}}),/role must equal/);
    await execute(submit,{...args,targets:[{candidateId:other.candidateId,version:other.version}],experience:candidate.experience});
  });
  assert.equal(result.action,'merge');assert.equal(result.experience?.stage,undefined);
});
test('actual extraction tool keeps nested optional experience fields optional',async()=>{
  const result=await distillSegment(id,1,{start:1,end:1,text:'observed'},'',[{agentRole:'worker'}],async(_r,_p,tools)=>{
    const submit=tools.find(t=>t.name==='submit_candidates')!;
    assert.deepEqual([...submit.parameters.required].sort(),['candidates','summary']);
    await execute(submit,{summary:'observed',candidates:[{experience:candidate.experience,sources:candidate.sources}]});
  });
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].experience.stage,undefined);
});

test('one actual tool decision can merge several retrieved targets, only after reading all complete records',async()=>{
  const targets=['one','two'].map(candidateId=>({...candidate,candidateId,version:`version-${candidateId}`}));
  let calls=0;
  const decision=await consolidate(candidate,targets,'worker',async(_r,prompt:any,tools)=>{
    calls++;assert.equal(prompt.targets.length,2);
    const read=tools.find(t=>t.name==='read_candidate')!,submit=tools.find(t=>t.name==='submit_consolidation')!;
    const args={action:'merge',candidateId:candidate.candidateId,candidateVersion:candidate.version,
      targets:targets.map(t=>({candidateId:t.candidateId,version:t.version})),experience:candidate.experience,reason:'equivalent'};
    await execute(read,{id:candidate.candidateId,start:0});await execute(read,{id:targets[0].candidateId,start:0});
    await assert.rejects(execute(submit,args),/read complete/);
    await execute(read,{id:targets[1].candidateId,start:0});
    await assert.rejects(execute(submit,{...args,targets:[{candidateId:'one',version:'old'}]}),/version/);
    await assert.rejects(execute(submit,{...args,targets:[args.targets[0],args.targets[0]]}),/invalid consolidation merge/);
    await execute(submit,args);
  });
  assert.equal(calls,1);assert.equal(decision.targets?.length,2);
});
