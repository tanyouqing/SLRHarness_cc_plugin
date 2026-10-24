import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';
import {seed,planRound,discover,complete} from '../evals/fixture-lib.mjs';
import {mutate,loadState,paperControl} from '../scripts/pipeline.mjs';
const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function setup(t,terminal=false){const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-guard-'));t.after(()=>fs.rmSync(project,{recursive:true,force:true}));const root=path.join(project,'workspaces','fixture-review');if(terminal)complete(root);else {seed(root);planRound(root);}return {root,project,hook:(role,id,tool,args)=>evaluateHook({project_dir:project,cwd:project,agent_type:`slr-harness:slr-${role}`,agent_id:id,tool_name:tool,tool_input:args})};}
test('bound Manager writes only own topic and cannot use git or retrieval',t=>{const {root,hook}=setup(t);mutate(root,'bind',{agentId:'m',role:'manager',topicId:'retrieval'});for(const name of ['plan.json','chapter.md','synthesis.md','acceptance.json'])assert.equal(hook('manager','m','Write',{file_path:path.join(root,'topics/retrieval',name)}).allowed,true);for(const p of ['topics/generation/chapter.md','.slr/state.json','SCOPE.md','papers/x/note.md'])assert.equal(hook('manager','m','Write',{file_path:path.join(root,p)}).allowed,false);assert.equal(hook('manager','m','Bash',{command:'git status'}).allowed,false);assert.equal(hook('manager','m','WebSearch',{query:'test'}).allowed,false);});
test('nested dispatch requires active slot and allows only allocated worker',t=>{const {root,hook}=setup(t);mutate(root,'bind',{agentId:'m',role:'manager',topicId:'retrieval'});assert.equal(hook('manager','m','Agent',{subagent_type:'slr-harness:slr-worker',prompt:'INITIALIZE SLR_LEASE=l'}).allowed,false);mutate(root,'reserve',{topicId:'retrieval',taskId:'first',leaseId:'l'});assert.equal(hook('manager','m','Agent',{subagent_type:'slr-harness:slr-worker',prompt:'INITIALIZE SLR_LEASE=l'}).allowed,true);assert.equal(hook('manager','m','Agent',{subagent_type:'slr-harness:slr-worker',prompt:'INITIALIZE SLR_LEASE=l'}).allowed,false);assert.equal(hook('manager','m','Agent',{subagent_type:'general-purpose'}).allowed,false);assert.equal(hook('manager','m','Bash',{command:`node "${path.join(plugin,'scripts/pipeline.mjs')}" bind-worker "${root}" l worker-id`}).allowed,true);mutate(root,'bind-worker',{leaseId:'l',agentId:'worker-id'});assert.equal(hook('manager','m','Agent',{subagent_type:'slr-harness:slr-worker',resume:'worker-id'}).allowed,true);assert.equal(hook('manager','m','Agent',{subagent_type:'slr-harness:slr-worker',resume:'foreign'}).allowed,false);});
test('Worker writes only assigned pending paper and cannot delegate',t=>{const {root,hook}=setup(t);discover(root,'retrieval');const id=Object.keys(loadState(root).papers)[0];mutate(root,'reserve',{topicId:'retrieval',taskId:'first',leaseId:'read'});mutate(root,'bind-worker',{leaseId:'read',agentId:'w'});for(const n of ['metadata.json','note.md'])assert.equal(hook('worker','w','Write',{file_path:path.join(root,`papers/${id}`,n)}).allowed,true);for(const n of ['paper/main.tex','papers/foreign/note.md','topics/retrieval/chapter.md','../outside.md'])assert.equal(hook('worker','w','Write',{file_path:path.resolve(root,n)}).allowed,false);assert.equal(hook('worker','w','Agent',{subagent_type:'slr-worker'}).allowed,false);assert.equal(hook('worker','w','Write',{file_path:'note.md'}).allowed,false);assert.equal(hook('worker','unbound','Write',{file_path:path.join(root,`papers/${id}/note.md`)}).allowed,false);mutate(root,'fail',{leaseId:'read',reason:'stopped'});assert.equal(hook('worker','w','Write',{file_path:path.join(root,`papers/${id}/note.md`)}).allowed,false);});
test('Checker is read-only; search shell policy blocks execution chains',t=>{const {hook}=setup(t);assert.equal(hook('checker','rv','Read',{file_path:'x'}).allowed,true);for(const tool of ['Write','Bash','Agent','WebFetch','mcp__search'])assert.equal(hook('checker','rv',tool,{file_path:'x',command:'node x'}).allowed,false);assert.equal(hook('scoper','s','Bash',{command:'paper-search sources'}).allowed,true);for(const command of ['paper-search download x','paper-search sources; echo hi','paper-search search "x" -n 100'])assert.equal(hook('scoper','s','Bash',{command}).allowed,false);});
test('Paper writes two exact files after terminal binding, preserving evidence',t=>{const {root,hook}=setup(t,true);paperControl(root,'bind-paper',{agentId:'p',role:'paper'});for(const n of ['main.tex','references.bib'])assert.equal(hook('paper-writer','p','Write',{file_path:path.join(root,'paper',n)}).allowed,true);for(const n of ['paper/neurips_2026.sty','paper/main.pdf','REVIEW_PAPER.md','.slr/state.json'])assert.equal(hook('paper-writer','p','Write',{file_path:path.join(root,n)}).allowed,false);assert.equal(hook('paper-writer','p','Bash',{command:'latexmk main.tex'}).allowed,false);});
test('unrelated main-session calls are unaffected',()=>assert.equal(evaluateHook({tool_name:'Write',tool_input:{file_path:'x'}}).allowed,true));


test('native handback works before READY binding for all six roles',()=>{
  for(const role of ['scoper','manager','worker','checker','reviewer','paper-writer']) {
    const input={agent_type:`slr-harness:slr-${role}`,tool_name:'SubagentHandback',tool_input:{message:'READY'}};
    assert.equal(evaluateHook(input).allowed,true,role);
    for(const message of ['', '  ', null, {}, 42])assert.equal(evaluateHook({...input,tool_input:{message}}).allowed,false,role);
    assert.equal(evaluateHook({...input,tool_name:'SubagentHandbackOther'}).allowed,false,role);
  }
});

test('read-only role can deliver exact JSON without gaining write or messaging rights',()=>{
  const report=JSON.stringify({verdict:'passed',issues:[],limitations:[],fingerprint:'exact'});
  const input={agent_type:'slr-checker',agent_id:'checker',tool_name:'SubagentHandback',tool_input:{message:report}};
  assert.equal(evaluateHook(input).allowed,true);
  assert.equal(input.tool_input.message,report);
  for(const tool_name of ['Write','Bash','Agent','SendMessage'])assert.equal(evaluateHook({...input,tool_name}).allowed,false);
});

test('stopped Worker may report failure but cannot write or retrieve',t=>{
  const {root,hook}=setup(t);mutate(root,'reserve',{topicId:'retrieval',taskId:'first',leaseId:'stopped'});
  mutate(root,'bind-worker',{leaseId:'stopped',agentId:'w'});mutate(root,'fail',{leaseId:'stopped',reason:'Delivery failed'});
  const before=fs.readFileSync(path.join(root,'.slr/state.json'));
  assert.equal(hook('worker','w','SubagentHandback',{message:'BLOCKED: delivery failed'}).allowed,true);
  assert.equal(hook('worker','w','Write',{file_path:path.join(root,'topics/retrieval/tasks/first/result.json')}).allowed,false);
  assert.equal(hook('worker','w','WebSearch',{}).allowed,false);
  assert.deepEqual(fs.readFileSync(path.join(root,'.slr/state.json')),before);
});

test('paused final Reviewer can report transport errors without bypassing retrieval gates',t=>{
  const {root,hook}=setup(t,true);
  fs.writeFileSync(path.join(root,'.slr/paper-bindings.json'),JSON.stringify({r:{role:'reviewer',submissionId:'submission-0001'}}));
  fs.writeFileSync(path.join(root,'.slr/final-review.json'),JSON.stringify({status:'paused',submissions:[{id:'submission-0001'}]}));
  assert.equal(hook('reviewer','r','SubagentHandback',{message:'BLOCKED: permission failure'}).allowed,true);
  for(const tool of ['WebFetch','Write','Agent','SendMessage'])assert.equal(hook('reviewer','r',tool,{}).allowed,false);
});
