import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,atomic,json,kbPath,runtime} from '../scripts/kb-core.mjs';
import {enqueue,items,processOne,runOnce,uploadReady,parseSyncArgs} from '../scripts/kb-sync.mjs';
import {freezeAccepted} from '../scripts/kb-outbox.mjs';
import {runPipeline} from '../scripts/kb-run.mjs';
import {complete,manuscript} from '../evals/fixture-lib.mjs';
import {mockCompile,submitAndRecord,assessment} from '../evals/final-review-lib.mjs';
import {loadState} from '../scripts/pipeline.mjs';

function directory(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slr-once-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;
}
function queue(t) {
  const root=directory(t);configure(root);let now=1000;
  return {root,options:{isReady:()=>true,prepare:()=>({warnings:[]}),clock:()=>now,sleep:async ms=>{assert.ok(ms>0&&ms<=15000);now+=ms;}}};
}
function ready(root) {
  complete(root);configure(root);manuscript(root);mockCompile(root);submitAndRecord(root,assessment(70));
  const last=json(path.join(root,'.slr/final-review.json')).submissions.at(-1);
  atomic(kbPath(root,'runtime.json'),{sessions:{},agents:{},finishRequested:{fingerprint:last.fingerprint,at:Date.now()}});
}

test('all uploads require whole-research success and current Stop handoff, including frozen papers',async t=>{
  const root=path.join(directory(t),'review');complete(root);configure(root);
  const paper=Object.values(loadState(root).papers)[0];freezeAccepted(root,paper);assert.equal(items(root).length,1);
  const transport={call:async()=>assert.fail('network before final success')};
  assert.equal(await processOne(root,{transport}),null);assert.equal((await runOnce(root,{transport})).status,'not_ready');
  manuscript(root);mockCompile(root);submitAndRecord(root,assessment(70));
  assert.equal(uploadReady(root),false);assert.equal(await processOne(root,{transport}),null);
  const last=json(path.join(root,'.slr/final-review.json')).submissions.at(-1);
  atomic(kbPath(root,'runtime.json'),{sessions:{},agents:{},finishRequested:{fingerprint:'old'}});
  assert.equal(uploadReady(root),false);
  atomic(kbPath(root,'runtime.json'),{sessions:{},agents:{},finishRequested:{fingerprint:last.fingerprint}});
  assert.equal(uploadReady(root),true);
  fs.appendFileSync(path.join(root,`papers/${paper.id}/note.md`),'stale');
  assert.equal(uploadReady(root),false);assert.equal((await runOnce(root,{transport,retryFailed:true})).status,'not_ready');
});

test('one invocation drains papers, final experience and trajectories with original-job polling',async t=>{
  const {root,options}=queue(t),calls=[],polls={};
  for(const tool of ['submit_paper','submit_experience','submit_trajectory'])enqueue(root,tool,{value:tool},{});
  const transport={call:async(name,args)=>{
    calls.push([name,args]);if(name==='get_job')return {status:(polls[args.job_id]=(polls[args.job_id]??0)+1)>1?'succeeded':'running',result:{ids:[]}};
    return name==='submit_experience'?{status:'duplicate',id:'experience'}:{status:'stored',id:name,job_id:`job-${name}`};
  }};
  assert.equal((await runOnce(root,{...options,transport})).status,'complete');
  assert.equal(calls.filter(([n])=>n!=='get_job').length,3);assert.equal(calls.filter(([n])=>n==='get_job').length,4);
  assert.ok(items(root).every(x=>x.status==='succeeded'));const count=calls.length;
  assert.equal((await runOnce(root,{...options,transport})).status,'complete');assert.equal(calls.length,count);
});

test('lost responses reuse frozen content; retries stop and resume explicitly without resending success',async t=>{
  const {root,options}=queue(t),calls=[];
  enqueue(root,'submit_paper',{note:'frozen'},{});enqueue(root,'submit_experience',{strategy:'independent'},{});
  const transport={call:async(name,args)=>{calls.push([name,args]);if(name==='submit_paper')throw new Error('lost response');return {status:'stored',id:'experience'};}};
  assert.equal((await runOnce(root,{...options,transport})).status,'failed');
  const paperCalls=calls.filter(([n])=>n==='submit_paper');assert.equal(paperCalls.length,3);assert.deepEqual(paperCalls[0],paperCalls[2]);
  const count=calls.length;await runOnce(root,{...options,transport});assert.equal(calls.length,count);
  const retry=[];assert.equal((await runOnce(root,{...options,retryFailed:true,transport:{call:async(name,args)=>{retry.push([name,args]);return {status:'duplicate',id:'paper'};}}})).status,'complete');
  assert.deepEqual(retry,[paperCalls[0]]);
});

test('global waiting limit exits and another invocation tracks the original job',async t=>{
  const {root,options}=queue(t),calls=[];enqueue(root,'submit_trajectory',{content:'{}\n'},{});
  const transport={call:async(name,args)=>{calls.push([name,args]);return name==='get_job'?{status:'succeeded',result:{ids:[]}}:{status:'stored',id:'trace',job_id:'original'};}};
  const first=await runOnce(root,{...options,transport,maxWaitMs:1000});assert.equal(first.status,'pending');assert.equal(first.reason,'time_limit');
  assert.equal(items(root)[0].jobId,'original');
  assert.equal((await runOnce(root,{...options,transport})).status,'complete');
  assert.deepEqual(calls.map(([n])=>n),['submit_trajectory','get_job']);assert.equal(calls[1][1].job_id,'original');
});

test('expired tracking resumes polling; failed server jobs never restart through reupload',async t=>{
  const {root,options}=queue(t);const id=enqueue(root,'submit_trajectory',{content:'{}\n'},{}),file=kbPath(root,`outbox/${id}.json`);
  atomic(file,{...json(file),status:'tracking',jobId:'original',trackUntil:0});
  const names=[],transport={call:async(name)=>{names.push(name);return {status:'failed'};}};
  assert.equal((await runOnce(root,{...options,transport})).status,'failed');
  await runOnce(root,{...options,transport,retryFailed:true});assert.deepEqual(names,['get_job','get_job']);
  assert.equal(items(root)[0].jobId,'original');
});

test('concurrent one-shot invocations honor the lease and do not double-submit',async t=>{
  const {root,options}=queue(t);enqueue(root,'submit_paper',{note:'single'},{});
  let release,entered;const started=new Promise(r=>entered=r);let calls=0;
  const first=runOnce(root,{...options,transport:{call:async()=>{calls++;entered();return new Promise(r=>release=r);}}});
  await started;
  const second=await runOnce(root,{...options,maxWaitMs:100,transport:{call:async()=>assert.fail('duplicate request')}});
  assert.equal(second.status,'pending');release({status:'stored',id:'paper'});
  assert.equal((await first).status,'complete');assert.equal(calls,1);
});

test('interruption preserves pending jobs and revoked success stops later requests',async t=>{
  const {root,options}=queue(t);enqueue(root,'submit_paper',{note:'one'},{});enqueue(root,'submit_paper',{note:'two'},{});
  let valid=true,calls=0;
  const first=await runOnce(root,{...options,isReady:()=>valid,transport:{call:async()=>{calls++;valid=false;return {status:'stored',id:'first'};}}});
  assert.equal(first.status,'not_ready');assert.equal(calls,1);assert.equal(items(root).filter(x=>x.status==='pending').length,1);
  const controller=new AbortController();valid=true;
  const second=await runOnce(root,{...options,signal:controller.signal,sleep:async ms=>{await options.sleep(ms);controller.abort();},transport:{call:async()=>({status:'stored',id:'second',job_id:'j'})}});
  assert.equal(second.reason,'interrupted');assert.equal(items(root).find(x=>x.jobId)?.jobId,'j');
});

test('optional launcher never uploads or retries on session exit; Stop owns synchronization',async t=>{
  const project=directory(t),old=path.join(project,'workspaces/old'),fresh=path.join(project,'workspaces/new');ready(old);
  let exited=false;const synced=[];
  const result=await runPipeline(project,{launch:async()=>{ready(fresh);exited=true;return {code:0};},synchronize:async root=>{assert.ok(exited);synced.push(root);throw new Error('KB unavailable');}});
  assert.deepEqual(synced,[]);assert.equal(result.claudeExitCode,0);assert.deepEqual(result.sync,[]);
  const interrupted=await runPipeline(project,{launch:async()=>{const rt=runtime(fresh);rt.finishRequested.at++;atomic(kbPath(fresh,'runtime.json'),rt);return {code:1};},synchronize:async()=>assert.fail('upload after interruption')});
  assert.equal(interrupted.sync.length,0);
});

test('disabled mode creates no batch report or request, and removed watch is rejected',async t=>{
  const root=directory(t);configure(root,{enabled:false});
  assert.equal((await runOnce(root,{transport:{call:async()=>assert.fail('network')}})).status,'disabled');
  assert.equal(fs.existsSync(kbPath(root,'last-sync.json')),false);
  assert.throws(()=>parseSyncArgs(['watch',root]),/removed/);
  assert.equal(parseSyncArgs(['once',root,'--max-wait-seconds','120']).maxWaitMs,120000);
  assert.throws(()=>parseSyncArgs(['once',root,'--max-wait-seconds','Infinity']));
});

test('capture warnings report incomplete sync while auth failures stay bounded and successful records persist',async t=>{
  const {root,options}=queue(t);enqueue(root,'submit_paper',{note:'accepted'},{});let calls=0;
  const transport={call:async()=>{calls++;throw Object.assign(new Error('unauthorized'),{status:401});}};
  assert.equal((await runOnce(root,{...options,transport})).status,'failed');assert.equal(calls,1);
  const good={call:async()=>{calls++;return {status:'stored',id:'paper'};}};
  const result=await runOnce(root,{...options,retryFailed:true,transport:good,prepare:()=>({warnings:['missing trajectory']})});
  assert.equal(result.status,'incomplete');assert.deepEqual(result.warnings,['missing trajectory']);
  assert.equal(items(root)[0].status,'succeeded');
  assert.equal((await runOnce(root,{...options,transport:good})).status,'complete');assert.equal(calls,2);
});
