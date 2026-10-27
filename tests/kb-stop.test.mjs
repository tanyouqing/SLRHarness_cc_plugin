import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,atomic,json,kbPath,runtime,sha} from '../scripts/kb-core.mjs';
import {scheduleStop,executeBatch,launchDetached} from '../scripts/kb-stop.mjs';
import {batchFile,freezeStopBatch} from '../scripts/kb-boundary.mjs';
import {runOnce,items,enqueue} from '../scripts/kb-sync.mjs';
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
test('missing final line times out without network; manual once can recover after flush',async t=>{
  const f=fixture(t,{ready:true});fs.writeFileSync(f.native,line({type:'user',message:{content:'research'}}));
  const s=scheduleStop(f.root,f.input,f.options);let now=0,calls=0;
  const options={clock:()=>now,sleep:async ms=>{now+=ms;},maxWaitMs:500,transport:{call:async()=>{calls++;return {status:'stored',id:'stored'};}}};
  const failed=await runOnce(f.root,options);assert.equal(failed.status,'incomplete');assert.equal(calls,0);
  assert.equal(scheduleStop(f.root,f.input,f.options).scheduled,false);
  fs.appendFileSync(f.native,line(assistant(f.input.last_assistant_message)));
  const recovered=await runOnce(f.root,options);assert.equal(recovered.status,'complete');assert.ok(calls>0);
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
