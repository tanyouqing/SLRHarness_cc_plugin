import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {seed,planRound} from '../evals/fixture-lib.mjs';
import {mutate,loadState} from '../scripts/pipeline.mjs';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';
import {configure,atomic,json,kbPath,authorize,storeResponse,runtime,lookupCache} from '../scripts/kb-core.mjs';
import {cacheQuery,callerForId,cacheRead} from '../scripts/kb-control.mjs';
import {noteSession,attach,hook} from '../scripts/kb-hook.mjs';
import {contextHook} from '../scripts/context-hook.mjs';
import {observeNativeTasks} from '../scripts/native-tasks.mjs';

const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function setup(t,{kb=true}={}) {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'guard-compat-')),root=path.join(project,'workspaces/review');
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));seed(root);planRound(root);configure(root,{enabled:kb});
  mutate(root,'bind',{agentId:'manager',role:'manager',topicId:'retrieval'});
  mutate(root,'bind',{agentId:'other-manager',role:'manager',topicId:'generation'});
  mutate(root,'reserve',{topicId:'retrieval',taskId:'first',leaseId:'lease'});
  const input=(tool,args={},role='manager',agent='manager')=>({project_dir:project,cwd:project,session_id:'session',agent_type:`slr-${role}`,agent_id:agent,tool_name:tool,tool_input:args});
  const worker=()=>mutate(root,'bind-worker',{leaseId:'lease',agentId:'worker'});
  return {project,root,input,worker};
}
test('Manager binding and recovery work from project, workspace and nested cwd without widening ownership',t=>{
  const f=setup(t),target=path.join(f.root,'topics/retrieval/chapter.md'),nested=path.dirname(target);
  atomic(path.join(f.root,'.slr/context-policy.json'),{version:1});
  for(const dir of [f.project,f.root,nested]) {
    const input={...f.input('Write',{file_path:target}),project_dir:dir,cwd:dir};
    assert.equal(evaluateHook(input).allowed,true,dir);
    assert.equal(evaluateHook({...input,tool_input:{file_path:path.join(f.root,'topics/generation/chapter.md')}}).allowed,false);
    const result=contextHook({project_dir:dir,cwd:dir,hook_event_name:'SessionStart'});
    assert.equal(JSON.parse(result.hookSpecificOutput.additionalContext).slrRecovery[0].workspace,f.root);
  }
});
test('session attachment resolves the same metadata from project and nested workspace cwd',t=>{
  const f=setup(t),native=path.join(f.project,'native.jsonl');fs.writeFileSync(native,'{}\n');
  noteSession({cwd:f.project,project_dir:f.project,session_id:'session',transcript_path:native,hook_event_name:'SessionStart'});
  attach({cwd:path.join(f.root,'topics/retrieval'),project_dir:f.root,session_id:'session'},f.root);
  assert.equal(runtime(f.root).sessions.session.transcript,native);
});
test('ambiguous runtime IDs across candidate workspaces fail closed',t=>{
  const f=setup(t),other=path.join(f.project,'workspaces/second');seed(other);planRound(other);
  mutate(other,'bind',{agentId:'manager',role:'manager',topicId:'retrieval'});
  assert.equal(evaluateHook(f.input('Write',{file_path:path.join(f.root,'topics/retrieval/chapter.md')})).allowed,false);
});
test('explicit scope/metadata globs and ordinary Grep stay usable with KB cache present',t=>{
  const f=setup(t);atomic(kbPath(f.root,'cache/private.json'),{secret:'private'});
  const main=(tool,args)=>({cwd:f.project,project_dir:f.project,tool_name:tool,tool_input:args});
  for(const pattern of ['workspaces/*/SCOPE.md','workspaces/*/SCOPE_ORIGINAL.md','workspaces/*/papers/*/metadata.json','workspaces/*/topics/**/chapter.md']) {
    assert.equal(evaluateHook(main('Glob',{pattern})).allowed,true,pattern);
    assert.equal(evaluateHook(main('Grep',{pattern:'RAG',glob:pattern})).allowed,true,pattern);
  }
  assert.equal(evaluateHook(main('Grep',{pattern:'RAG',path:path.join(f.root,'SCOPE.md')})).allowed,true);
  assert.equal(evaluateHook(main('Grep',{pattern:'RAG',path:path.join(f.root,'papers')})).allowed,true);
  assert.equal(evaluateHook(main('Glob',{path:f.root,pattern:'paper/**/*.tex'})).allowed,true);
});
test('broad searches, regex used as file glob, traversal and raw KB reads remain blocked',t=>{
  const f=setup(t);atomic(kbPath(f.root,'cache/private.json'),{secret:'private'});
  const input=(tool,args)=>({cwd:f.project,project_dir:f.project,tool_name:tool,tool_input:args});
  for(const args of [{pattern:'**/*'},{pattern:'workspaces/*/.slr/kb/**'},{pattern:'workspaces/*/{SCOPE.md,.slr/kb/**}'},{pattern:'workspaces/*/papers/../.slr/kb/**'}])assert.equal(evaluateHook(input('Glob',args)).allowed,false);
  assert.equal(evaluateHook(input('Grep',{pattern:'papers/.*'})).allowed,false);
  assert.equal(evaluateHook(input('Grep',{pattern:'x',glob:'*.md'})).allowed,false);
  for(const glob of ['workspaces/*','**/.slr','workspaces'])assert.equal(evaluateHook(input('Grep',{pattern:'private',glob})).allowed,false,glob);
  assert.equal(evaluateHook(input('Read',{file_path:path.relative(f.project,kbPath(f.root,'cache/private.json'))})).allowed,false);
  assert.equal(evaluateHook(input('Glob',{pattern:kbPath(f.root,'cache/*')})).allowed,false);
});
test('relative reads use hook cwd for size limits; symlink aliases cannot expose KB data',t=>{
  const f=setup(t);fs.writeFileSync(path.join(f.root,'large.md'),'x'.repeat(25000));
  const input={...f.input('Read',{file_path:'large.md'}),cwd:f.root};
  assert.equal(evaluateHook(input).allowed,false);assert.equal(evaluateHook({...input,tool_input:{file_path:'large.md',limit:1}}).allowed,false);
  atomic(kbPath(f.root,'cache/private.json'),{secret:'private'});
  const alias=path.join(f.project,'alias');fs.symlinkSync(kbPath(f.root),alias,process.platform==='win32'?'junction':'dir');
  assert.equal(evaluateHook(f.input('Read',{file_path:path.join(alias,'cache/private.json')})).allowed,false);
  assert.equal(evaluateHook(f.input('Grep',{path:alias,pattern:'private'})).allowed,false);
});
test('strategy stage is optional/free text while role and real assignment remain enforced',t=>{
  const f=setup(t);f.worker();const make=args=>f.input('mcp__survey-kb__search_strategies',args,'worker','worker');
  const noStage=authorize(make({query:'compare'}));assert.equal(noStage.args.filters.stage,undefined);assert.equal(noStage.scope.stage,'paper_discovery');
  const custom=authorize(make({query:'compare',filters:{stage:'cross_paper_evidence_review'}}));
  assert.equal(custom.args.filters.stage,'cross_paper_evidence_review');assert.equal(custom.scope.stage,'paper_discovery');
  assert.equal(evaluateHook(make({query:'compare',filters:{role:'manager'}})).allowed,false);
  assert.notEqual(noStage.key,custom.key);
  mutate(f.root,'fail',{leaseId:'lease',reason:'fixture stopped'});
  assert.equal(evaluateHook(make({query:'compare'})).allowed,false);
});
test('cache hit and miss are normal local results; repeated MCP calls no longer fail permission checks',t=>{
  const f=setup(t);f.worker();const input=f.input('mcp__survey-kb__search_strategies',{query:'compare'},'worker','worker');
  assert.deepEqual(lookupCache(input),{hit:false});
  const view=storeResponse({...input,tool_response:{results:[{id:'strategy',revision:1,role:'worker',snippet:'check evidence'}]}});
  assert.equal(evaluateHook(input).allowed,true);
  const cached=cacheQuery(f.root,callerForId(f.root,'worker'),'search_strategies',{query:'compare'});
  assert.equal(cached.hit,true);assert.equal(cached.cacheKey,view.cacheKey);assert.equal(cached.results[0].snippet,'check evidence');
  const cli=path.join(plugin,'scripts/kb-control.mjs');
  const result=JSON.parse(execFileSync(process.execPath,[cli,'cache-query',f.root,'worker','search_strategies','{"query":"compare"}'],{encoding:'utf8'}));
  assert.equal(result.hit,true);
  const command=`node "${cli}" cache-query "${f.root}" "worker" search_strategies '{"query":"compare"}'`;
  assert.equal(evaluateHook(f.input('Bash',{command},'worker','worker')).allowed,true);
  assert.equal(evaluateHook(f.input('Bash',{command})).allowed,false);
  assert.equal(evaluateHook(f.input('Bash',{command:command+'; echo unsafe'},'worker','worker')).allowed,false);
  assert.deepEqual(cacheQuery(f.root,callerForId(f.root,'manager'),'search_strategies',{query:'compare'}),{hit:false});
});
test('cached result cannot cross real discovery/reading stages or a paused run',t=>{
  const f=setup(t);f.worker();const input=f.input('mcp__survey-kb__search_strategies',{query:'compare'},'worker','worker');
  const view=storeResponse({...input,tool_response:{results:[]}});
  const state=loadState(f.root);state.leases.lease.phase='read';atomic(path.join(f.root,'.slr/state.json'),state);
  assert.deepEqual(lookupCache(input),{hit:false});
  assert.throws(()=>cacheRead(f.root,callerForId(f.root,'worker'),view.cacheKey),/another/);
  atomic(path.join(f.root,'.slr/final-review.json'),{status:'paused'});
  assert.throws(()=>lookupCache(input),/paused/);
});
function background(f,{taskId='task-native',workerId='worker',managerId='manager'}={}) {
  const launch=f.input('Agent',{subagent_type:'slr-worker',prompt:'INITIALIZE SLR_LEASE=lease'},'manager',managerId);
  assert.equal(evaluateHook(launch).allowed,true);
  observeNativeTasks({...launch,hook_event_name:'PostToolUse',tool_response:{status:'async_launched',agentId:workerId,task_id:taskId}});
  return launch;
}
test('Manager can inspect/stop only host-observed own Worker tasks, including before READY binding',t=>{
  const f=setup(t,{kb:false});background(f);
  assert.equal(evaluateHook(f.input('TaskOutput',{task_id:'task-native'})).allowed,true);
  assert.equal(evaluateHook(f.input('TaskOutput',{task_id:'task-native',block:true,timeout:600000})).updatedInput.timeout,30000);
  assert.equal(evaluateHook(f.input('TaskStop',{task_id:'task-native'})).allowed,true);
  f.worker();
  for(const tool of ['TaskOutput','TaskStop']) {
    assert.equal(evaluateHook(f.input(tool,{task_id:'task-native'},'manager','other-manager')).allowed,false);
    assert.equal(evaluateHook({...f.input(tool,{task_id:'task-native'}),session_id:'other-session'}).allowed,false);
    assert.equal(evaluateHook(f.input(tool,{task_id:'arbitrary-shell-task'})).allowed,false);
    assert.equal(evaluateHook(f.input(tool,{task_id:'task-native'},'worker','worker')).allowed,false);
  }
  observeNativeTasks({...f.input('unused',{},'worker','worker'),hook_event_name:'SubagentStop'});
  assert.equal(evaluateHook(f.input('TaskStop',{task_id:'task-native'})).allowed,false);
  assert.equal(evaluateHook(f.input('TaskOutput',{task_id:'task-native'})).allowed,true);
  assert.equal(fs.existsSync(kbPath(f.root,'outbox')),false);
});
test('task ownership is not inferred from prompt text, synchronous output or another topic',t=>{
  const f=setup(t);const launch=f.input('Agent',{subagent_type:'slr-worker',prompt:'INITIALIZE SLR_LEASE=lease'});
  for(const response of [{status:'async_launched',content:'agentId=worker task_id=evil'},{status:'completed',agentId:'worker'}]) {
    hook({...launch,hook_event_name:'PostToolUse',tool_response:response});
    assert.equal(evaluateHook(f.input('TaskStop',{task_id:'worker'})).allowed,false);
  }
  assert.equal(evaluateHook(launch).allowed,true);
  observeNativeTasks({...launch,agent_id:'other-manager',hook_event_name:'PostToolUse',tool_response:{status:'async_launched',agentId:'worker'}});
  assert.equal(evaluateHook(f.input('TaskStop',{task_id:'worker'})).allowed,false);
  observeNativeTasks({...launch,hook_event_name:'PostToolUse',tool_response:{status:'async_launched',agentId:'worker'}});
  assert.equal(evaluateHook(f.input('TaskOutput',{task_id:'worker'})).allowed,true);
  assert.equal(evaluateHook(f.input('TaskStop',{task_id:'worker'})).allowed,true);
  assert.equal(evaluateHook(f.input('TaskOutput',{task_id:'worker',timeout:-1})).allowed,false);
  assert.equal(evaluateHook(f.input('TaskStop',{task_id:'worker',shell_id:'other'})).allowed,false);
});
test('retrieval services allow new methods without per-method registration while explicit mutations and role violations stay blocked',t=>{
  const f=setup(t);f.worker();
  for(const name of ['mcp__tavily__tavily_search','mcp__tavily__tavily_extract','mcp__arxiv__search_papers','mcp__scholar__search',
    'mcp__tavily__advanced_search_v3','mcp__tavily__crawl','mcp__tavily__map','mcp__arxiv__download_paper',
    'mcp__scholar__lookupByDOI','mcp__scholar__get_citations','mcp__scholar__batch_related_works']) {
    assert.equal(evaluateHook(f.input(name,{query:'RAG'},'worker','worker')).allowed,true,name);
    assert.equal(evaluateHook(f.input(name,{query:'RAG'},'scoper','scoper')).allowed,true,name);
    assert.equal(evaluateHook(f.input(name,{query:'RAG'})).allowed,false,name);
  }
  for(const name of ['mcp__other__search','mcp__tavily__delete','mcp__tavily__deleteIndex','mcp__scholar__upload_paper',
    'mcp__arxiv__execute_command','mcp__scholar__search_and_delete','mcp__survey-kb-extra__search_papers'])assert.equal(evaluateHook(f.input(name,{},'worker','worker')).allowed,false,name);
});
