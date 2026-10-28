import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,atomic,json,kbPath,runtime,sha} from '../scripts/kb-core.mjs';
import {scheduleStop,executeBatch,launchDetached} from '../scripts/kb-stop.mjs';
import {batchFile,freezeStopBatch} from '../scripts/kb-boundary.mjs';
import {runOnce,items,enqueue,success,summary} from '../scripts/kb-sync.mjs';
import {hook} from '../scripts/kb-hook.mjs';
import {complete,manuscript} from '../evals/fixture-lib.mjs';
import {mockCompile,submitAndRecord,assessment} from '../evals/final-review-lib.mjs';

const line=value=>JSON.stringify(value)+'\n';
const assistant=text=>({type:'assistant',message:{role:'assistant',content:[{type:'text',text}]}});
function fixture(t,{ready=false,enabled=true,text='完成调研。'}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slr-stop-')),root=path.join(dir,'workspaces/review'),native=path.join(dir,'session.jsonl');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  if(ready){complete(root);manuscript(root);mockCompile(root);submitAndRecord(root,assessment(70));}
  configure(root,{enabled});
  if(!ready)atomic(path.join(root,'.slr/final-review.json'),{submissions:[{id:'review-1',fingerprint:'fingerprint-1'}]});
  fs.writeFileSync(native,line({type:'user',message:{role:'user',content:'research'}})+line(assistant(text)));
  atomic(kbPath(root,'runtime.json'),{sessions:{session:{transcript:native,start:0}},agents:{}});
  const input={hook_event_name:'Stop',session_id:'session',transcript_path:native,cwd:dir,last_assistant_message:text,background_tasks:[],session_crons:[]};
  const launched=[],options={...(ready?{}:{isSuccess:()=>true}),launch:(...args)=>{launched.push(args);return 123;}};
  return {dir,root,native,input,options,launched};
}
test('only an attached main Stop with explicit empty task registries and successful final review schedules',t=>{
  const f=fixture(t,{ready:true});
  for(const patch of [{hook_event_name:'SessionEnd'},{agent_id:'child'},{session_id:'other'},{transcript_path:path.join(f.dir,'wrong')},
    {background_tasks:[{}]},{background_tasks:undefined},{session_crons:[{}]},{session_crons:undefined}]) {
    assert.equal(scheduleStop(f.root,{...f.input,...patch},f.options).scheduled,false);
  }
  assert.equal(scheduleStop(f.root,f.input,{...f.options,isSuccess:()=>false}).scheduled,false);
  assert.equal(f.launched.length,0);
  const first=scheduleStop(f.root,f.input,f.options);assert.equal(first.scheduled,true);assert.equal(f.launched.length,1);
  const second=scheduleStop(f.root,f.input,f.options);assert.equal(second.scheduled,false);assert.equal(second.batchId,first.batchId);
  assert.equal(f.launched.length,1);assert.equal(runtime(f.root).finishRequested.batchId,first.batchId);
});
test('disabled KB creates no automatic batch or process',t=>{
  const f=fixture(t,{enabled:false});assert.equal(scheduleStop(f.root,f.input,f.options).scheduled,false);
  assert.equal(fs.existsSync(kbPath(f.root,'batches')),false);assert.equal(f.launched.length,0);
});
test('frozen boundary excludes later user turns; lifecycle cannot extend completed archives',async t=>{
  const f=fixture(t,{ready:true}),scheduled=scheduleStop(f.root,f.input,f.options),original=fs.readFileSync(f.native,'utf8');
  fs.appendFileSync(f.native,line({type:'user',message:{content:'unrelated secret'}})+line(assistant('later reply')));
  assert.equal((await freezeStopBatch(f.root,scheduled.batchId)).frozen,true);
  hook({...f.input,hook_event_name:'UserPromptSubmit'});
  hook({...f.input,hook_event_name:'PostToolUse',tool_name:'Read'});
  const entries=Object.values(json(kbPath(f.root,'trajectories.json')).files);
  assert.equal(entries.length,1);assert.equal(entries[0].lines,2);assert.equal(entries[0].lineStart,1);
  assert.equal(fs.readFileSync(kbPath(f.root,entries[0].archive),'utf8'),original);
});
test('delayed final JSONL line is awaited and next conversation is excluded',async t=>{
  const f=fixture(t),final=line(assistant(f.input.last_assistant_message));
  fs.writeFileSync(f.native,line({type:'user',message:{content:'research'}})+final.slice(0,15));
  const s=scheduleStop(f.root,f.input,f.options);let now=0,sleeps=0;
  const frozen=await freezeStopBatch(f.root,s.batchId,{clock:()=>now,sleep:async ms=>{
    now+=ms;sleeps++;fs.appendFileSync(f.native,final.slice(15)+line({type:'user',message:{content:'later'}}));
  }});
  assert.equal(frozen.frozen,true);assert.equal(sleeps,1);
  const record=Object.values(json(kbPath(f.root,'trajectories.json')).files)[0];
  assert.equal(record.lines,2);assert.ok(!fs.readFileSync(kbPath(f.root,record.archive),'utf8').includes('later'));
});
test('missing final line preserves paper/review uploads; recovery retains the delayed main trajectory locally',async t=>{
  const f=fixture(t,{ready:true});fs.writeFileSync(f.native,line({type:'user',message:{content:'research'}}));
  const s=scheduleStop(f.root,f.input,f.options);let now=0;const calls=[];
  const options={clock:()=>now,sleep:async ms=>{now+=ms;},maxWaitMs:500,transport:{call:async(name)=>{calls.push(name);return {status:'stored',id:'stored'};}}};
  const failed=await runOnce(f.root,options);assert.equal(failed.status,'incomplete');
  assert.ok(calls.includes('submit_paper'));assert.ok(calls.includes('submit_experience'));assert.ok(!calls.includes('submit_trajectory'));
  const before=calls.length;
  assert.equal(scheduleStop(f.root,f.input,f.options).scheduled,false);
  fs.appendFileSync(f.native,line(assistant(f.input.last_assistant_message)));
  const recovered=await runOnce(f.root,options);assert.equal(recovered.status,'complete');assert.deepEqual(calls.slice(before),[]);
  assert.equal(json(batchFile(f.root,s.batchId)).frozen,true);
});
test('next user before final message and rewritten native prefix fail closed',async t=>{
  const f=fixture(t);fs.writeFileSync(f.native,line({type:'user',message:{content:'research'}}));
  const s=scheduleStop(f.root,f.input,f.options);
  fs.appendFileSync(f.native,line({type:'user',message:{content:'next'}})+line(assistant(f.input.last_assistant_message)));
  assert.match((await freezeStopBatch(f.root,s.batchId)).warnings[0],/next user/);
  fs.writeFileSync(f.native,line(assistant(f.input.last_assistant_message)));
  assert.match((await freezeStopBatch(f.root,s.batchId)).warnings[0],/prefix changed/);
});
test('subagent partial line and rotated session segments preserve their own sources and line ranges',async t=>{
  const f=fixture(t),child=path.join(f.dir,'child.jsonl'),prior=path.join(f.dir,'prior.jsonl'),segment=line({type:'system'});
  fs.writeFileSync(child,'{"type":"tool"');fs.writeFileSync(prior,segment+line(assistant('prior')));
  const rt=runtime(f.root);rt.agents.worker={role:'worker',sessionId:'session',active:false,transcript:child};
  rt.sessions.session.segments=[{transcript:prior,start:Buffer.byteLength(segment)}];atomic(kbPath(f.root,'runtime.json'),rt);
  const s=scheduleStop(f.root,f.input,f.options);let now=0;
  const result=await freezeStopBatch(f.root,s.batchId,{clock:()=>now,sleep:async ms=>{now+=ms;fs.appendFileSync(child,'}\n');}});
  assert.equal(result.frozen,true);
  const records=Object.values(json(kbPath(f.root,'trajectories.json')).files);assert.equal(records.length,3);
  assert.equal(records.find(r=>r.source===prior).lineStart,2);assert.equal(records.find(r=>r.agentId==='worker').lines,1);
});
test('launch failure is recorded once; retry is explicit, not every Stop',t=>{
  const f=fixture(t);let calls=0;
  const options={...f.options,launch:()=>{calls++;throw new Error('spawn failed');}};
  const s=scheduleStop(f.root,f.input,options);assert.equal(s.scheduled,false);
  assert.equal(json(batchFile(f.root,s.batchId)).status,'launch_failed');
  scheduleStop(f.root,f.input,options);assert.equal(calls,1);
});
test('detached spawn uses fixed arguments, closed stdin, private file logs and no shell',t=>{
  const f=fixture(t),s=scheduleStop(f.root,f.input,f.options);let unref=false;
  const pid=launchDetached(f.root,s.batchId,{spawnProcess:(exe,args,options)=>{
    assert.equal(exe,process.execPath);assert.deepEqual(args.slice(1),['run',f.root,s.batchId]);
    assert.equal(options.detached,true);assert.equal(options.windowsHide,true);assert.equal(options.shell,undefined);
    assert.equal(options.stdio[0],'ignore');assert.equal(typeof options.stdio[1],'number');assert.equal(options.stdio[1],options.stdio[2]);
    return {pid:123,on:()=>{},unref:()=>{unref=true;}};
  }});
  assert.equal(pid,123);assert.equal(unref,true);
});
test('automatic execution starts only once; manual recovery retains original job and no double submission',async t=>{
  const f=fixture(t,{ready:true}),s=scheduleStop(f.root,f.input,f.options);let count=0;
  const synchronize=async()=>{count++;return {status:'failed'};};
  assert.equal((await executeBatch(f.root,s.batchId,{synchronize})).status,'failed');
  assert.equal((await executeBatch(f.root,s.batchId,{synchronize})).status,'already_started');assert.equal(count,1);
  enqueue(f.root,'submit_trajectory',{content:'{}\n'},{});
  const x=items(f.root)[0];atomic(kbPath(f.root,`outbox/${x.id}.json`),{...x,status:'failed',jobId:'original'});
  const calls=[];
  await runOnce(f.root,{retryFailed:true,prepare:()=>({}),transport:{call:async(name,args)=>{calls.push([name,args]);return {status:'succeeded',result:{}};}}});
  assert.deepEqual(calls,[['get_job',{job_id:'original'}]]);
});
test('dead batch process is recoverable; changing the completion handoff stops subsequent requests',async t=>{
  const f=fixture(t),s=scheduleStop(f.root,f.input,f.options);
  atomic(kbPath(f.root,'sync-process.json'),{pid:2147483647,token:'dead',until:Date.now()+120000});
  enqueue(f.root,'submit_paper',{note:'one'},{});enqueue(f.root,'submit_paper',{note:'two'},{});
  let count=0;
  const result=await runOnce(f.root,{isReady:()=>true,prepare:()=>({}),transport:{call:async()=>{
    count++;const rt=runtime(f.root);rt.finishRequested.fingerprint='changed';atomic(kbPath(f.root,'runtime.json'),rt);
    return {status:'stored',id:'one'};
  }}});
  assert.equal(result.status,'not_ready');assert.equal(count,1);assert.equal(items(f.root).filter(x=>x.status==='pending').length,1);
  assert.equal(json(batchFile(f.root,s.batchId)).status,'not_ready');assert.equal(fs.existsSync(kbPath(f.root,'sync-process.json')),false);
});
test('new final review creates a separate batch and preserves the original batch history',t=>{
  const f=fixture(t),a=scheduleStop(f.root,f.input,f.options);
  atomic(path.join(f.root,'.slr/final-review.json'),{submissions:[{id:'review-2',fingerprint:'fingerprint-1'}]});
  const b=scheduleStop(f.root,f.input,f.options);
  assert.notEqual(a.batchId,b.batchId);assert.equal(b.scheduled,true);
  assert.equal(json(batchFile(f.root,a.batchId)).submissionId,'review-1');assert.equal(f.launched.length,2);
});


test('unclassified active observations do not block completion; bound or recognized research Agents do',t=>{
  const f=fixture(t,{ready:true}),rt=runtime(f.root);
  rt.agents.observed={role:'other',sessionId:'session',active:true};atomic(kbPath(f.root,'runtime.json'),rt);
  assert.equal(success(f.root),true);
  rt.agents.known={role:'checker',sessionId:'session',active:true};atomic(kbPath(f.root,'runtime.json'),rt);
  assert.equal(success(f.root),false);
  rt.agents.known.active=false;atomic(kbPath(f.root,'runtime.json'),rt);
  const stateFile=path.join(f.root,'.slr/state.json'),state=json(stateFile);
  state.bindings.observed={role:'manager',topicId:'retrieval'};atomic(stateFile,state);
  assert.equal(success(f.root),false,'other with a genuine binding must not be ignored');
});

test('lifecycle preserves a recognized role and stopped state when later events omit agent_type',t=>{
  const f=fixture(t,{ready:true}),input={...f.input,agent_id:'child',agent_type:'slr-checker'};
  hook({...input,hook_event_name:'SubagentStart'});
  assert.equal(runtime(f.root).agents.child.role,'checker');
  hook({...input,agent_type:undefined,hook_event_name:'SubagentStop'});
  hook({...input,agent_type:undefined,hook_event_name:'PostToolUse',tool_name:'Read'});
  const agent=runtime(f.root).agents.child;assert.equal(agent.role,'checker');assert.equal(agent.active,false);
  hook({...input,hook_event_name:'SubagentStart'});assert.equal(runtime(f.root).agents.child.active,true);
});

test('new batch skips absent unclassified observations but retains Checker, Reviewer and optional real transcripts',async t=>{
  const f=fixture(t,{ready:true}),rt=runtime(f.root);
  rt.agents.internal={role:'other',sessionId:'session',active:true};
  for(const role of ['checker','reviewer','other']) {
    const file=path.join(f.dir,role+'.jsonl');fs.writeFileSync(file,line({type:'assistant',agentId:role,message:{role:'assistant',content:role}}));
    rt.agents[role]={role,sessionId:'session',active:false,transcript:file};
  }
  atomic(kbPath(f.root,'runtime.json'),rt);const scheduled=scheduleStop(f.root,f.input,f.options);
  assert.equal(scheduled.scheduled,true);
  const result=await freezeStopBatch(f.root,scheduled.batchId);assert.equal(result.frozen,true);
  const batch=json(batchFile(f.root,scheduled.batchId));assert.equal(batch.skipped.length,1);assert.equal(batch.errors.length,0);
  assert.deepEqual(batch.sources.map(s=>s.role).sort(),['checker','main','other','reviewer']);
});

test('legacy batch with 18 unknown errors recovers normally without deleting evidence or duplicating submissions',async t=>{
  const f=fixture(t,{ready:true}),scheduled=scheduleStop(f.root,f.input,f.options),file=batchFile(f.root,scheduled.batchId);
  const rt=runtime(f.root),batch=json(file),original=fs.readFileSync(f.native,'utf8');
  enqueue(f.root,'submit_trajectory',{content:original},{kind:'trajectory',hash:sha(original)});
  batch.errors=[];batch.status='incomplete';
  for(let n=0;n<18;n++){const id='unknown-'+n;rt.agents[id]={role:'other',active:true,sessionId:'session'};batch.errors.push({agentId:id,sessionId:'session',reason:'native transcript unavailable'});}
  atomic(file,batch);atomic(kbPath(f.root,'runtime.json'),rt);
  fs.appendFileSync(f.native,line({type:'user',message:{content:'later private conversation'}}));
  const calls=[],transport={call:async(name,args)=>{calls.push([name,args]);return {status:'stored',id:'stored'};}};
  assert.equal((await runOnce(f.root,{transport,retryFailed:true})).status,'complete');
  const saved=json(file);assert.equal(saved.captureErrors.length,18);assert.equal(saved.skipped.length,18);assert.equal(saved.errors.length,0);
  assert.equal(saved.frozen,true);assert.equal(runtime(f.root).agents['unknown-0'].active,true,'no fabricated stop event');
  assert.equal(calls.find(([name])=>name==='submit_trajectory')[1].content,original);
  assert.ok(calls.some(([name])=>name==='submit_paper'));assert.ok(calls.some(([name])=>name==='submit_experience'));
  const count=calls.length;await runOnce(f.root,{transport,retryFailed:true});assert.equal(calls.length,count);
});

test('required missing transcript stays explicit while papers, review and valid trajectories upload',async t=>{
  const f=fixture(t,{ready:true}),rt=runtime(f.root);
  const child=path.join(f.dir,'valid-worker.jsonl');fs.writeFileSync(child,line(assistant('verified worker outcome')));
  rt.agents.valid={role:'worker',active:false,sessionId:'session',transcript:child};
  rt.agents.missing={role:'worker',active:false,sessionId:'session'};atomic(kbPath(f.root,'runtime.json'),rt);
  const scheduled=scheduleStop(f.root,f.input,f.options),calls=[];
  const transport={call:async name=>{calls.push(name);return {status:'stored',id:name};}};
  assert.equal((await runOnce(f.root,{transport})).status,'incomplete');
  assert.ok(['submit_paper','submit_experience','submit_trajectory'].every(name=>calls.includes(name)));
  const batch=json(batchFile(f.root,scheduled.batchId));assert.equal(batch.errors[0].agentId,'missing');assert.equal(batch.frozen,false);
  assert.equal(summary(f.root).automatic.trajectories.frozen,2);
  const count=calls.length;await runOnce(f.root,{transport,retryFailed:true});assert.equal(calls.length,count);
  assert.equal(json(batchFile(f.root,scheduled.batchId)).errors.length,1,'do not invent a later Stop boundary for missing originals');
});

test('partial freeze resumes per source, preserves immutable archives and never resubmits completed content',async t=>{
  const f=fixture(t,{ready:true}),child=path.join(f.dir,'child.jsonl'),rt=runtime(f.root);
  fs.writeFileSync(child,'{"type":"system"');rt.agents.worker={role:'worker',active:false,sessionId:'session',transcript:child};atomic(kbPath(f.root,'runtime.json'),rt);
  const scheduled=scheduleStop(f.root,f.input,f.options);let now=0;const calls=[];
  const options={maxWaitMs:100,clock:()=>now,sleep:async ms=>{now+=ms;},transport:{call:async(name,args)=>{calls.push([name,args]);return {status:'stored',id:'id'};}}};
  assert.equal((await runOnce(f.root,options)).status,'incomplete');
  const count=calls.length,old=Object.values(json(kbPath(f.root,'trajectories.json')).files)[0];
  const originalArchive=fs.readFileSync(kbPath(f.root,old.archive));
  fs.unlinkSync(f.native); // Frozen originals need not remain readable on recovery.
  fs.appendFileSync(child,'}\n'+line({type:'user',message:{content:'later child chat'}}));
  assert.equal((await runOnce(f.root,{...options,retryFailed:true})).status,'complete');
  assert.equal(calls.slice(count).length,1);assert.equal(calls.at(-1)[0],'submit_trajectory');
  assert.equal(calls.at(-1)[1].metadata.agentRole,'worker');assert.deepEqual(JSON.parse(calls.at(-1)[1].content),{originalLine:1,event:{type:'system'}});
  assert.deepEqual(fs.readFileSync(kbPath(f.root,old.archive)),originalArchive);
  assert.equal(json(batchFile(f.root,scheduled.batchId)).frozenSourceKeys.length,2);
});

test('a changed original source isolates its failure rather than blocking unrelated records',async t=>{
  const f=fixture(t,{ready:true});scheduleStop(f.root,f.input,f.options);
  fs.writeFileSync(f.native,line({type:'user',message:{content:'replacement'}}));
  const calls=[];const result=await runOnce(f.root,{transport:{call:async name=>{calls.push(name);return {status:'stored',id:'ok'};}}});
  assert.equal(result.status,'incomplete');assert.ok(result.warnings.some(w=>w.includes('prefix changed')));
  assert.ok(calls.includes('submit_paper'));assert.ok(!calls.includes('submit_trajectory'));
});


test('archive write failure leaves papers/review recoverable and does not falsely seal the batch',async t=>{
  const f=fixture(t,{ready:true}),scheduled=scheduleStop(f.root,f.input,f.options),calls=[];
  const rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(source,target)=>{if(String(target).endsWith('.jsonl'))throw new Error('fixture archive storage unavailable');return rename(source,target);});
  const transport={call:async name=>{calls.push(name);return {status:'stored',id:'ok'};}};
  assert.equal((await runOnce(f.root,{transport})).status,'incomplete');
  assert.ok(calls.includes('submit_paper'));assert.ok(calls.includes('submit_experience'));assert.ok(!calls.includes('submit_trajectory'));
  assert.equal(fs.existsSync(kbPath(f.root,'sealed.json')),false);assert.equal(json(batchFile(f.root,scheduled.batchId)).frozen,false);
  t.mock.restoreAll();const before=calls.length;
  assert.equal((await runOnce(f.root,{transport,retryFailed:true})).status,'complete');
  assert.deepEqual(calls.slice(before),[]);
});

test('legacy other error with a genuine research binding remains a required missing source',async t=>{
  const f=fixture(t,{ready:true}),scheduled=scheduleStop(f.root,f.input,f.options),rt=runtime(f.root);
  rt.agents.actual={role:'other',sessionId:'session',active:false};atomic(kbPath(f.root,'runtime.json'),rt);
  const stateFile=path.join(f.root,'.slr/state.json'),state=json(stateFile);state.bindings.actual={role:'checker',topicId:'retrieval'};atomic(stateFile,state);
  const file=batchFile(f.root,scheduled.batchId),batch=json(file);batch.errors=[{agentId:'actual',sessionId:'session',reason:'native transcript unavailable'}];atomic(file,batch);
  const result=await freezeStopBatch(f.root,scheduled.batchId);assert.equal(result.frozen,false);assert.equal(result.available,1);
  const saved=json(file);assert.equal(saved.errors.length,1);assert.equal(saved.skipped.length,0);
});
