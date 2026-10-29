import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {consolidate,distillSegment,type Draft} from '../src/agents.js';
const id='00000000-0000-4000-8000-000000000001';
const candidate:Draft={candidateId:'candidate-0',experience:{sourceType:'trajectory',role:'worker',executionSummary:'observed',strategy:'verify evidence'},sources:[{type:'trajectory',id}]};
// Validate the exact JSON schema exposed to the model, using Pi's real argument
// validator before calling execute. This catches lost required/optional metadata.
function argumentsFor(tool:any,args:any) {
  const wireTool={...tool,parameters:JSON.parse(JSON.stringify(tool.parameters))};
  return validateToolArguments(wireTool,{type:'toolCall',id:'test',name:tool.name,arguments:args});
}
async function execute(tool:any,args:any){return tool.execute('test',argumentsFor(tool,args));}
for(const action of ['keep','drop'] as const)test(`actual consolidation schema accepts minimal ${action} without merge-only fields`,async()=>{
  const result=await consolidate(candidate,undefined,'worker',async(_r,_p,tools)=>{
    const read=tools.find(t=>t.name==='read_candidate')!,submit=tools.find(t=>t.name==='submit_consolidation')!;
    assert.deepEqual([...submit.parameters.required].sort(),['action','candidateId','reason']);
    const args={action,candidateId:candidate.candidateId,reason:'value assessment'};
    assert.deepEqual(argumentsFor(submit,args),args);
    await assert.rejects(execute(submit,args),/read complete/);
    await execute(read,{id:candidate.candidateId,start:0});
    await assert.rejects(execute(submit,{...args,targetId:''}),/cannot rewrite/);
    assert.throws(()=>argumentsFor(submit,{...args,sources:[]}));
    assert.throws(()=>argumentsFor(submit,{action,candidateId:candidate.candidateId}));
    await execute(submit,args);
  });
  assert.equal(result.action,action);
});
test('actual merge tool requires valid target and experience at execution and preserves nested optional fields',async()=>{
  const other={...candidate,candidateId:'candidate-1'};
  const result=await consolidate(candidate,other,'worker',async(_r,_p,tools)=>{
    const read=tools.find(t=>t.name==='read_candidate')!,submit=tools.find(t=>t.name==='submit_consolidation')!;
    for(const c of [candidate,other])await execute(read,{id:c.candidateId,start:0});
    const args={action:'merge',candidateId:candidate.candidateId,reason:'same advice'};
    await assert.rejects(execute(submit,args),/invalid consolidation merge/);
    await assert.rejects(execute(submit,{...args,targetId:other.candidateId}),/invalid consolidation merge/);
    await assert.rejects(execute(submit,{...args,targetId:'invented',experience:candidate.experience}),/invalid consolidation merge/);
    await assert.rejects(execute(submit,{...args,targetId:other.candidateId,experience:{...candidate.experience,role:'manager'}}),/role must equal/);
    await execute(submit,{...args,targetId:other.candidateId,experience:candidate.experience});
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
