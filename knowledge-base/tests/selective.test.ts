import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {assessTrajectory,consolidate,loadPrompts,checkConsolidation,type Draft} from '../src/agents.js';
import {currentPolicy,legacyPolicy,policyOf} from '../src/policy.js';
import {triageOverview,checkTriage} from '../src/triage.js';
import {distillationProgress} from '../src/consolidation-state.js';

const id='00000000-0000-4000-8000-000000000001';
const draft:Draft={candidateId:'a',version:'1',experience:{role:'paper',sourceType:'trajectory',strategy:'reduce read range',executionSummary:'read failed then succeeded'},sources:[{id,type:'trajectory'}]};
async function execute(tool:any,args:any) {
  return tool.execute('test',validateToolArguments({...tool,parameters:JSON.parse(JSON.stringify(tool.parameters))},{type:'toolCall',id:'test',name:tool.name,arguments:args}));
}
test('missing policy pins legacy, unknown version fails, progress exposes triage without relabeling failures',()=>{
  assert.equal(policyOf({}),legacyPolicy);assert.equal(policyOf({policyVersion:currentPolicy}),currentPolicy);
  assert.throws(()=>policyOf({policyVersion:'future'}));
  const p=distillationProgress({payload:{policyVersion:currentPolicy},status:'succeeded',checkpoint:{phase:'skipped',triage:{kind:'routine_success',reason:'ordinary completion',evidence:[]}}});
  assert.equal(p.policy_version,currentPolicy);assert.equal(p.skip_reason,'ordinary completion');assert.equal(p.wait_reason,null);
  assert.equal(distillationProgress({status:'failed',checkpoint:{phase:'triage'}}).skip_reason,null);
});
test('legacy background, extraction and manager prompts remain isolated from new outcome/strict rules',async()=>{
  const old=await loadPrompts('distiller',legacyPolicy),next=await loadPrompts('distiller',currentPolicy);
  assert.match(old,/equivalent or complementary/);assert.doesNotMatch(old,/mode=triage/);
  assert.match(next,/Complementary steps.*NOT duplicates/);assert.match(next,/routine_success/);
  const manager=await loadPrompts('manager',currentPolicy);
  assert.match(manager,/Independent useful recommendations use new/);
  assert.doesNotMatch(await loadPrompts('manager',legacyPolicy),/Strict experience equivalence/);
});
test('bounded overview scans all events, preserves source positions and treats quoted errors as hints',()=>{
  const content=Array.from({length:300},(_,i)=>JSON.stringify({message:i===250?'error recovered':'normal',body:'x'.repeat(2000)})).join('\n');
  const result=triageOverview(content);
  assert.equal(result.lineCount,300);assert.deepEqual(result.hintLines,[251]);assert.ok(result.excerpts.some(e=>e.line===300));
  assert.ok(result.excerpts.every(e=>e.text.length<=1000&&e.truncated));assert.match(result.coverage,/does not prove/);
});
test('actual triage tool validates evidence, optional fields, pagination and policy selection',async()=>{
  const trajectory={id,content:JSON.stringify({message:'x'.repeat(13000)})+'\n'+JSON.stringify({result:'completed'}),origins:[{agentRole:'paper'}]};
  const result=await assessTrajectory(trajectory,async(_r,prompt:any,tools,policy)=>{
    assert.equal(policy,currentPolicy);assert.equal(prompt.mode,'triage');assert.equal(prompt.requiredRole,'paper');
    const read=tools.find(t=>t.name==='read_trajectory')!,submit=tools.find(t=>t.name==='submit_triage')!;
    assert.deepEqual([...submit.parameters.required].sort(),['evidence','kind','reason']);
    const window=JSON.parse((await execute(read,{line:1})).content[0].text);assert.equal(window.next_start,12000);
    await execute(read,{line:1,start:12000});await assert.rejects(execute(read,{line:3}));
    await assert.rejects(execute(submit,{kind:'failure',reason:'guessed',evidence:[]}),/requires evidence/);
    await assert.rejects(execute(submit,{kind:'routine_success',reason:'guessed',evidence:[{start:1,end:3,observation:'outside'}]}),/outside/);
    await execute(submit,{kind:'routine_success',reason:'ordinary completion',evidence:[{start:2,end:2,observation:'task result'}]});
  });assert.equal(result.kind,'routine_success');
  assert.throws(()=>checkTriage({kind:'unique_success',reason:'good',evidence:[{start:1,end:1,observation:'read'}]},1),/specific value/);
});
test('strict merge actual schema requires per-target duplicate rationale, preserving ordinary keep/drop',async()=>{
  const other={...draft,candidateId:'b'};
  await consolidate(draft,[other],'paper',async(_r,prompt:any,tools,policy)=>{
    assert.equal(policy,currentPolicy);assert.doesNotMatch(prompt.instruction,/Aim for 0/);
    const read=tools.find(t=>t.name==='read_candidate')!,submit=tools.find(t=>t.name==='submit_consolidation')!;
    for(const c of [draft,other])await execute(read,{id:c.candidateId,start:0});
    const args={action:'merge',candidateId:'a',candidateVersion:'1',targets:[{candidateId:'b',version:'1'}],experience:draft.experience,reason:'same problem and action'};
    await assert.rejects(execute(submit,args),/duplicate basis/);
    await assert.rejects(execute(submit,{...args,duplicateBasis:[{candidateId:'invented',problem:'same',coreAction:'same',conditions:'same'}]}),/duplicate basis/);
    await execute(submit,{...args,duplicateBasis:[{candidateId:'b',problem:'read exceeds limit',coreAction:'reduce read range',conditions:'same read limit'}]});
  },true,currentPolicy);
  assert.equal(checkConsolidation({action:'keep',candidateId:'a',candidateVersion:'1',reason:'checking citations is independent'},draft,[other],'paper',true,currentPolicy).action,'keep');
});
test('multi-target strict merge cannot omit or duplicate a target rationale or fabricate sources',()=>{
  const targets=['b','c'].map(candidateId=>({...draft,candidateId}));
  const basis={candidateId:'b',problem:'read limit',coreAction:'smaller range',conditions:'same'};
  const decision={action:'merge',candidateId:'a',candidateVersion:'1',targets:targets.map(t=>({candidateId:t.candidateId,version:t.version})),experience:draft.experience,reason:'same',duplicateBasis:[basis,basis]};
  assert.throws(()=>checkConsolidation(decision,draft,targets,'paper',true,currentPolicy),/duplicate basis/);
  decision.duplicateBasis[1]={...basis,candidateId:'c'};
  assert.equal(checkConsolidation(decision,draft,targets,'paper',true,currentPolicy).targets?.length,2);
  assert.throws(()=>checkConsolidation({...decision,sources:[]},draft,targets,'paper',true,currentPolicy));
});
