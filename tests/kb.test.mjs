import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,config,atomic,json,kbPath,sha,authorize,displayResult,storeResponse,chars,normalizeExperience,locked,runtime} from '../scripts/kb-core.mjs';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';
import {capture,hook,noteSession,attach} from '../scripts/kb-hook.mjs';
import {validateImports,saveImports,cacheRead,callerForId,bindScoper} from '../scripts/kb-control.mjs';
import {enqueue,items,claim,processOne,resume,reconcile,paperPayload,success} from '../scripts/kb-sync.mjs';
import {complete,manuscript} from '../evals/fixture-lib.mjs';
import {mockCompile,submitAndRecord,assessment} from '../evals/final-review-lib.mjs';
import {loadState} from '../scripts/pipeline.mjs';
import {validateProbe} from '../scripts/kb-native-probe.mjs';
import {checkRun} from '../scripts/kb-cloud-check.mjs';
import {freezeAccepted} from '../scripts/kb-outbox.mjs';
import {writerEvidence} from '../scripts/work-stages.mjs';

function setup(t,on=true) {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-kb-')),root=path.join(project,'workspaces','run');
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  atomic(path.join(root,'.slr/state.json'),{stage:'researching',topics:[{id:'topic',status:'researching'}],papers:{},
    bindings:{w:{role:'worker',topicId:'topic',taskId:'task',leaseId:'lease'},m:{role:'manager',topicId:'topic'}},leases:{lease:{active:true,agentId:'w',phase:'discover'}}});
  configure(root,{enabled:on});
  const input=(method,args={},id='w',role='worker')=>({project_dir:project,cwd:project,agent_id:id,agent_type:`slr-${role}`,session_id:'s',tool_name:`mcp__survey-kb__${method}`,tool_input:args});
  return {root,project,input};
}
const rid='11111111-1111-4111-8111-111111111111';
const metadata={title:'Example',authors:['Author'],year:2025,venue:null,canonicalUrl:'https://example.org/paper',doi:'10.1/test',arxivId:null};
function paperCache(f) {
  const query=f.input('search_papers',{query:'Example'});
  storeResponse({...query,tool_response:{results:[{id:rid,revision:2,metadata,snippet:'Evidence',score:1}]}});
  return storeResponse({...f.input('read',{type:'paper',id:rid,revision:2}),tool_response:{id:rid,revision:2,content:{metadata,note:'# Original evidence\nEvidence location: section 2.'}}});
}
test('KB switch is immutable, default-on, disabled makes no queue/network calls',async t=>{
  const f=setup(t,false);assert.equal(config(f.root).enabled,false);assert.throws(()=>configure(f.root),/immutable/);
  assert.equal(evaluateHook(f.input('search_papers',{query:'x'})).allowed,false);
  assert.equal(enqueue(f.root,'submit_trajectory',{content:'{}\n'},{}),null);
  assert.equal(await processOne(f.root,{isReady:()=>true,transport:{call:()=>assert.fail('network')}}),null);
  assert.equal(items(f.root).length,0);
});
test('KB roles, exact server, active bindings, type and own strategy role are enforced',t=>{
  const f=setup(t);assert.equal(evaluateHook(f.input('search_papers',{query:'x'})).allowed,true);
  const strategy=evaluateHook(f.input('search_strategies',{query:'x'}));assert.equal(strategy.updatedInput.filters.role,'worker');assert.equal(strategy.updatedInput.limit,3);
  assert.equal(evaluateHook(f.input('search_strategies',{query:'x',filters:{role:'manager'}})).allowed,false);
  assert.equal(evaluateHook(f.input('search_papers',{query:'x'},'m','manager')).allowed,false);
  assert.equal(evaluateHook(f.input('search_strategies',{query:'x'},'m','manager')).allowed,true);
  for(const r of ['checker','reviewer','scoper','paper-writer'])assert.equal(evaluateHook(f.input('search_strategies',{query:'x'},'w',r)).allowed,false);
  assert.equal(evaluateHook({...f.input('search_papers'),agent_id:undefined,agent_type:undefined}).allowed,false);
  for(const m of ['submit_paper','submit_experience','submit_trajectory','get_job'])assert.equal(evaluateHook(f.input(m)).allowed,false);
  assert.equal(evaluateHook(f.input('read',{type:'trajectory',id:rid})).allowed,false);
  assert.equal(evaluateHook({...f.input('search_papers'),tool_name:'mcp__academic__search_papers'}).allowed,false);
  assert.equal(evaluateHook({...f.input('search_papers'),tool_name:'mcp__arxiv__search_papers'}).allowed,true);
  const s=json(path.join(f.root,'.slr/state.json'));s.leases.lease.active=false;atomic(path.join(f.root,'.slr/state.json'),s);
  assert.equal(evaluateHook(f.input('search_papers')).allowed,false);
});
test('Scoper requires host-observed binding and Paper current writing unit',t=>{
  const f=setup(t),state=json(path.join(f.root,'.slr/state.json'));state.stage='drafting_scope';atomic(path.join(f.root,'.slr/state.json'),state);
  assert.throws(()=>bindScoper(f.root,'s1'));
  atomic(kbPath(f.root,'runtime.json'),{sessions:{},agents:{s1:{role:'scoper',sessionId:'s'}}});bindScoper(f.root,'s1');
  assert.equal(evaluateHook(f.input('search_strategies',{query:'x'},'s1','scoper')).allowed,true);
  atomic(path.join(f.root,'.slr/paper-bindings.json'),{p:{role:'paper'}});
  atomic(path.join(f.root,'.slr/work-stages.json'),{writers:[{id:'writing-1',active:{agentId:'p',phaseId:'outline'}}],reviews:{}});
  assert.equal(authorize(f.input('search_strategies',{query:'x'},'p','paper-writer')).role,'paper');
  assert.equal(evaluateHook(f.input('search_strategies',{query:'x'},'p','paper-writer')).allowed,false); // absent evidence hash is stale
  assert.equal(evaluateHook(f.input('search_strategies',{query:'x'},'p2','paper-writer')).allowed,false);
});
test('Unicode response budgets retain limitations, raw content and explicit continuation',t=>{
  const f=setup(t),b=config(f.root).budgets;
  const rows=Array.from({length:5},(_,i)=>({id:String(i),revision:1,role:'worker',snippet:'😀'.repeat(3000),applicability:'Only under controlled settings'}));
  const view=displayResult({results:rows},'search_strategies',b);assert.ok(chars(JSON.stringify(view)).length<=4500);assert.ok(view.results.length<=3);
  assert.equal(chars(view.results[0].snippet).length,1200);assert.equal(view.results[0].applicability,rows[0].applicability);
  const read=displayResult({content:{note:'长'.repeat(40000)}},'read',b);assert.ok(read.truncated);assert.ok(chars(JSON.stringify(read)).length<=24000);
  const escaped=displayResult({content:{note:'"\\\n'.repeat(10000)}},'read',b);assert.ok(chars(JSON.stringify(escaped,null,2)).length<=24000);assert.ok(escaped.nextOffset>0);
  const response=hook({...f.input('search_strategies',{query:'x'}),hook_event_name:'PostToolUse',tool_response:{structuredContent:{results:rows.slice(0,3)}}});
  const value=response.hookSpecificOutput.updatedMCPToolOutput.structuredContent;
  assert.equal(json(kbPath(f.root,`cache/${value.cacheKey}.json`)).result.results[0].snippet,rows[0].snippet);
  assert.equal(evaluateHook(f.input('search_strategies',{query:'x'})).allowed,true);
});
test('failed or wrong-role MCP responses never become empty cached searches',t=>{
  const f=setup(t),i={...f.input('search_strategies',{query:'x'}),hook_event_name:'PostToolUse'};
  for(const tool_response of [{isError:true,content:[]},{results:[{role:'paper'}]}]) {
    assert.equal(hook({...i,tool_response}).hookSpecificOutput.updatedMCPToolOutput.structuredContent.unavailable,true);
  }
  assert.equal(fs.existsSync(kbPath(f.root,'cache')),false);
});
test('paper read requires retrieved revision; import maps original without overwriting notes',t=>{
  const f=setup(t);assert.throws(()=>authorize(f.input('read',{type:'paper',id:rid,revision:2})),/retrieved/);
  const view=paperCache(f),card={...metadata,knowledgeBase:{id:rid,revision:2,cacheKey:view.cacheKey}};
  const refs=validateImports(f.root,[card],'topic','task');assert.equal(refs.length,1);
  assert.throws(()=>validateImports(f.root,[card],'topic','other'),/task/);
  assert.throws(()=>validateImports(f.root,[{...card,doi:'10.1/wrong'}],'topic','task'),/identifier/);
  const state={papers:{'p-test':{id:'p-test',keys:refs[0].keys}}};
  const local=path.join(f.root,'papers/p-test/note.md');fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,'keep accepted');
  saveImports(f.root,refs,state);saveImports(f.root,refs,state);
  assert.equal(fs.readFileSync(local,'utf8'),'keep accepted');assert.equal(json(kbPath(f.root,'imports.json'))['p-test'].length,1);
  assert.match(cacheRead(f.root,callerForId(f.root,'w'),view.cacheKey,0,1000).text,/Original evidence/);
  assert.throws(()=>cacheRead(f.root,callerForId(f.root,'m'),view.cacheKey,0,1000),/another/);
});
test('optional experience values normalize at outbound boundary without changing review',()=>{
  const input={sourceType:'review',role:'paper',executionSummary:'Observed mismatch',strategy:'Check comparisons',stage:null,task:' ',applicability:''};
  const output=normalizeExperience(input);assert.equal(Object.keys(output).length,4);assert.equal(input.stage,null);
  assert.throws(()=>normalizeExperience({...input,role:'reviewer'}));
});
test('trajectory increment, partial line, recovery, rotation and changed prefix preserve original',t=>{
  const f=setup(t),file=path.join(f.project,'native.jsonl');fs.writeFileSync(file,'{"n":0}\n{"n":1}\n{"n":');
  const args={file,agentId:'w',sessionId:'s',role:'worker',start:8};
  let a=capture(f.root,args);assert.equal(a.lines,1);assert.ok(a.pendingBytes>0);
  fs.appendFileSync(file,'2}\n');a=capture(f.root,args);assert.equal(a.lines,2);
  assert.equal(capture(f.root,args).lines,2);assert.equal(fs.readFileSync(kbPath(f.root,a.archive),'utf8'),'{"n":1}\n{"n":2}\n');
  const next=file+'.next';fs.writeFileSync(next,'{"n":3}\n');assert.ok(capture(f.root,{...args,file:next,start:0}).previous);
  fs.writeFileSync(file,'{"n":8}\n');assert.throws(()=>capture(f.root,args),/prefix changed/);
  assert.match(fs.readFileSync(kbPath(f.root,a.archive),'utf8'),/"n":1/);
});
test('session attachment scopes main transcript and unrelated agents do not acquire bindings',t=>{
  const f=setup(t),file=path.join(f.project,'session.jsonl');fs.writeFileSync(file,'{"type":"assistant","old":true}\n');
  const input={cwd:f.project,project_dir:f.project,session_id:'session',transcript_path:file,hook_event_name:'UserPromptSubmit'};
  noteSession(input);attach(input,f.root);fs.appendFileSync(file,'{"type":"user","new":true}\n');hook({...input,hook_event_name:'PostToolUse',tool_name:'Read'});
  const entry=Object.values(json(kbPath(f.root,'trajectories.json')).files)[0];assert.equal(entry.lines,1);assert.ok(!fs.readFileSync(kbPath(f.root,entry.archive),'utf8').includes('old'));
});
test('durable queue reuses frozen payload after lost response and polls original job',async t=>{
  const f=setup(t),payload={content:'{}\n'},id=enqueue(f.root,'submit_trajectory',payload,{});
  assert.equal(enqueue(f.root,'submit_trajectory',payload,{}),id);
  let n=0;const calls=[],transport={call:async(name,args)=>{calls.push([name,args]);if(n++===0)throw new Error('lost response');if(name==='get_job')return {status:'succeeded',result:{ids:['strategy']}};return {status:'stored',id:'trace',job_id:'job'};}};
  let now=Date.now();await processOne(f.root,{isReady:()=>true,transport,now});assert.equal(items(f.root)[0].status,'retry');
  now+=2000;await processOne(f.root,{isReady:()=>true,transport,now});assert.equal(items(f.root)[0].jobId,'job');
  now+=15000;await processOne(f.root,{isReady:()=>true,transport,now});assert.equal(items(f.root)[0].status,'succeeded');
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[2][0],'get_job');
});
test('retry cap, permanent rejection, polling expiry and lease recovery are bounded',async t=>{
  const f=setup(t),id=enqueue(f.root,'submit_paper',{note:'n'},{});let now=Date.now();
  for(let i=0;i<3;i++){await processOne(f.root,{isReady:()=>true,transport:{call:async()=>{throw new Error('offline');}},now});now+=5000;}
  assert.equal(items(f.root)[0].status,'failed');assert.equal(items(f.root)[0].attempts,3);resume(f.root);
  const claimed=claim(f.root,now);assert.ok(claimed);assert.equal(claim(f.root,now+1),null);assert.ok(claim(f.root,now+120001));
  const file=kbPath(f.root,`outbox/${id}.json`),x=json(file);x.lease=null;x.status='tracking';x.jobId='job';x.trackUntil=now-1;atomic(file,x);
  assert.equal(claim(f.root,now),null);assert.equal(items(f.root)[0].status,'waiting');resume(f.root);
  await processOne(f.root,{isReady:()=>true,transport:{call:async(name)=>{assert.equal(name,'get_job');return {status:'failed'};}},now:Date.now()});assert.equal(items(f.root)[0].jobId,'job');
  resume(f.root);await processOne(f.root,{isReady:()=>true,transport:{call:async()=>{throw Object.assign(new Error('unauthorized'),{status:401});}},now:Date.now()});assert.equal(items(f.root)[0].status,'failed');
  const crashed=setup(t);enqueue(crashed.root,'submit_trajectory',{content:'{}\n'},{});
  for(let i=0;i<3;i++)assert.ok(claim(crashed.root,now+i*120001));
  assert.equal(claim(crashed.root,now+3*120001),null);assert.equal(items(crashed.root)[0].status,'failed');assert.equal(items(crashed.root)[0].totalAttempts,3);
});
test('reconcile submits only final normalized review; paper snapshot checks acceptance',t=>{
  const f=setup(t),rt=runtime(f.root);rt.finishRequested={fingerprint:'final'};atomic(kbPath(f.root,'runtime.json'),rt);
  const e={sourceType:'review',role:'worker',executionSummary:'comparison',strategy:'verify',stage:null};
  atomic(path.join(f.root,'.slr/final-review.json'),{submissions:[{id:'old',fingerprint:'old',assessment:{experiences:[{...e,strategy:'old'}]}},{id:'final',fingerprint:'final',assessment:{experiences:[e]}}]});
  atomic(path.join(f.root,'paper/reviews/final/experiences.json'),{experiences:[e]});
  reconcile(f.root,{isSuccess:()=>false});assert.equal(items(f.root).length,0);
  reconcile(f.root,{isSuccess:()=>true});assert.equal(items(f.root).length,1);assert.equal(items(f.root)[0].payload.experience.stage,undefined);
  reconcile(f.root,{isSuccess:()=>true});assert.equal(items(f.root).length,1);
});
test('actual completion predicate checks fresh evidence, compiled PDF and independent review',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'slr-kb-complete-')),root=path.join(base,'fixture-review');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  complete(root);configure(root);manuscript(root);mockCompile(root);
  assert.equal(success(root),false);submitAndRecord(root,assessment(70));assert.equal(success(root),true);
  const p=Object.values(loadState(root).papers)[0],payload=paperPayload(root,p);assert.equal(payload.metadata.paperId,undefined);
  fs.appendFileSync(path.join(root,`papers/${p.id}/note.md`),'changed');assert.throws(()=>paperPayload(root,p),/fingerprint/);assert.equal(success(root),false);
});
test('storage failure preserves primary state and corrupt final experience is not uploaded',t=>{
  const f=setup(t),statePath=path.join(f.root,'.slr/state.json'),before=fs.readFileSync(statePath);
  fs.mkdirSync(kbPath(f.root),{recursive:true});
  fs.writeFileSync(kbPath(f.root,'outbox'),'not a directory');
  assert.throws(()=>enqueue(f.root,'submit_paper',{note:'n'},{}));assert.deepEqual(fs.readFileSync(statePath),before);
  fs.unlinkSync(kbPath(f.root,'outbox'));
  atomic(kbPath(f.root,'runtime.json'),{sessions:{},agents:{},finishRequested:{fingerprint:'f'}});
  atomic(path.join(f.root,'.slr/final-review.json'),{submissions:[{id:'final',fingerprint:'f',assessment:{experiences:[]}}]});
  atomic(path.join(f.root,'paper/reviews/final/experiences.json'),{experiences:[{sourceType:'review'}]});
  const result=reconcile(f.root,{isSuccess:()=>true});assert.equal(result.sealed,false);assert.equal(items(f.root).length,0);assert.deepEqual(fs.readFileSync(statePath),before);
});
test('stale process lock is reclaimed and unsafe raw cache access is denied',t=>{
  const f=setup(t),dir=kbPath(f.root,'locks/test');fs.mkdirSync(dir,{recursive:true});atomic(path.join(dir,'owner.json'),{pid:2147483647});
  assert.equal(locked(f.root,'test',()=>42),42);
  const view=paperCache(f);
  const base=f.input('search_papers');
  assert.equal(evaluateHook({...base,tool_name:'Read',tool_input:{file_path:kbPath(f.root,`cache/${view.cacheKey}.json`)}}).allowed,false);
  assert.equal(evaluateHook({...base,tool_name:'Read',tool_input:{file_path:view.cachePath}}).allowed,true);
  assert.equal(evaluateHook({...base,agent_type:'slr-checker',tool_name:'Read',tool_input:{file_path:view.cachePath}}).allowed,false);
});

test('native capability validation fails closed for missing replacement or unsupported timeout',()=>{
  const events=[{event:'PreToolUse',tool:'mcp__survey-kb-probe__slow',id:'t',at:1000},{event:'PostToolUseFailure',tool:'mcp__survey-kb-probe__slow',id:'t',at:21000,error:'request timed out'},{event:'PostToolUse',tool:'mcp__survey-kb-probe__echo'}];
  assert.equal(validateProbe(events,'marker','marker').timeoutMs,20000);
  assert.throws(()=>validateProbe(events,'original','marker'),/replacement/);
  assert.throws(()=>validateProbe(events.map(e=>e.event==='PostToolUseFailure'?{...e,at:61000}:e),'marker','marker'),/timeout/);
});

test('cloud check distinguishes disabled runs and requires actual reuse evidence',async t=>{
  const f=setup(t,false);assert.equal((await checkRun(f.root)).mode,'disabled');
  const enabledFixture=setup(t);paperCache(enabledFixture);
  assert.equal((await checkRun(enabledFixture.root)).status,'passed');
  await assert.rejects(checkRun(enabledFixture.root,{requireReuse:true}),/reuse/);
});

test('completed cloud acceptance reads trajectory and verifies strategy source with a mock client',async t=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-kb-verify-')),root=path.join(project,'run');t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  complete(root);configure(root);manuscript(root);mockCompile(root);submitAndRecord(root,assessment(70));
  const final=json(path.join(root,'.slr/final-review.json')).submissions.at(-1);
  atomic(kbPath(root,'runtime.json'),{sessions:{},agents:{},finishRequested:{fingerprint:final.fingerprint}});
  const file=path.join(project,'native.jsonl');fs.writeFileSync(file,'{"type":"assistant"}\n');capture(root,{file,agentId:'worker1',sessionId:'s',role:'worker'});
  atomic(kbPath(root,`cache/${sha('fixture')}.json`),{scope:{role:'worker'},method:'search_papers',args:{},result:{results:[]}});
  reconcile(root);
  for(const item of items(root))atomic(kbPath(root,`outbox/${item.id}.json`),{...item,status:'succeeded',remoteId:'trace',result:item.tool==='submit_trajectory'?{ids:['strategy']}:{} });
  const calls=[],transport={call:async(method,args)=>{calls.push([method,args]);return {sources:[{type:'trajectory',id:'trace'}]};}};
  assert.equal((await checkRun(root,{requireComplete:true,transport})).status,'passed');assert.equal(calls.length,2);assert.ok(calls.every(([name])=>name==='read'));
  await assert.rejects(checkRun(root,{requireComplete:true,transport:{call:async()=>({sources:[{id:'wrong'}]})}}),/source/);
});

test('accepted content freezes separately from later edits; Paper retrieval needs current evidence',t=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-kb-paper-')),root=path.join(project,'workspaces','fixture-review');t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  complete(root);configure(root);
  const p=Object.values(loadState(root).papers)[0];freezeAccepted(root,p);assert.equal(items(root).length,1);
  const original=items(root)[0].payload.note;
  atomic(path.join(root,'.slr/paper-bindings.json'),{p:{role:'paper'}});
  atomic(path.join(root,'.slr/work-stages.json'),{writers:[{id:'w',evidenceHash:writerEvidence(root),active:{agentId:'p',phaseId:'outline'}}],reviews:{}});
  const input={project_dir:project,agent_id:'p',agent_type:'slr-paper-writer',tool_name:'mcp__survey-kb__search_strategies',tool_input:{query:'outline'}};
  assert.equal(evaluateHook(input).allowed,true);
  const cached=storeResponse({...input,tool_response:{results:[]}});
  const cachedRead={...input,tool_name:'Read',tool_input:{file_path:cached.cachePath}};
  assert.equal(evaluateHook(cachedRead).allowed,true);
  fs.appendFileSync(path.join(root,`papers/${p.id}/note.md`),'changed');freezeAccepted(root,p);
  assert.equal(items(root).length,1);assert.equal(items(root)[0].payload.note,original);
  assert.equal(evaluateHook(input).allowed,false);
  assert.equal(evaluateHook(cachedRead).allowed,false);
});
