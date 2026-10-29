import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,config,enabled,atomic,kbPath,json,runtime} from '../scripts/kb-core.mjs';
import {runOnce,enqueue} from '../scripts/kb-sync.mjs';
import {saveRunSnapshot} from '../scripts/kb-snapshot.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kb-snapshot-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));configure(root);
  let now=0;const options={transport:{call:async()=>({status:'stored',id:'remote-record'})},isReady:()=>true,prepare:()=>({warnings:[]}),clock:()=>now,sleep:async ms=>{now+=ms;}};
  return {root,options};
}
test('whole-run snapshot starts after final remote processing, and resume never reuploads saved data',async t=>{
  const {root,options}=fixture(t);let requests=0,snaps=0;
  enqueue(root,'submit_trajectory',{content:'{}'},{});
  options.transport.call=async name=>{requests++;return name==='get_job'?{status:'succeeded',result:{ids:[]}}:{status:'stored',id:'trace',job_id:'job'};};
  const snapshot=async()=>{snaps++;assert.equal(requests,2);return {status:'saved',result:{id:'snapshot'}};};
  const result=await runOnce(root,{...options,snapshot});assert.equal(result.status,'complete');assert.equal(result.snapshot.status,'saved');
  await runOnce(root,{...options,snapshot});assert.equal(requests,2);assert.equal(snaps,2); // host helper deduplicates the batch
});
test('snapshot failure reports pending separately; resume repeats only snapshot',async t=>{
  const {root,options}=fixture(t);enqueue(root,'submit_paper',{note:'accepted'},{});
  let requests=0;options.transport.call=async()=>{requests++;return {status:'stored',id:'record'};};
  const first=await runOnce(root,{...options,snapshot:async()=>({status:'failed',reason:'disk'})});
  assert.equal(first.status,'pending');assert.equal(first.reason,'snapshot_pending');assert.equal(first.uploadStatus,'complete');
  const second=await runOnce(root,{...options,snapshot:async()=>({status:'saved'})});assert.equal(second.status,'complete');assert.equal(requests,1);
});
test('other-run queue defers snapshot within finite budget; failed uploads never request one',async t=>{
  const {root,options}=fixture(t);let calls=0;
  const result=await runOnce(root,{...options,maxWaitMs:20000,snapshot:async()=>{calls++;return {status:'waiting'};}});
  assert.equal(result.status,'pending');assert.equal(calls,3);
  enqueue(root,'submit_paper',{note:'failure'},{});
  options.transport.call=async()=>{throw Object.assign(new Error('unauthorized'),{permanent:true});};
  assert.equal((await runOnce(root,{...options,snapshot:async()=>assert.fail('unfinished run')})).status,'failed');
});
test('snapshot request is tied to successful review batch and persists host receipt',async t=>{
  const {root}=fixture(t);
  atomic(kbPath(root,'runtime.json'),{...runtime(root),finishRequested:{batchId:'batch',submissionId:'review',fingerprint:'fingerprint'}});
  atomic(kbPath(root,'last-sync.json'),{status:'complete'});
  const receipt=await saveRunSnapshot(root,{runProcess:async file=>{const req=json(file);assert.equal(req.runId,config(root).runId);assert.equal(req.batchId,'batch');assert.equal(req.uploadStatus,'complete');return {status:'saved',result:{id:'snapshot'}};}});
  assert.equal(receipt.status,'saved');assert.equal(json(kbPath(root,'snapshot.json')).result.id,'snapshot');
});
test('restore generation blocks every previous workspace and pending restore blocks all KB access',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kb-generation-')),previous=process.env.SURVEY_KB_SNAPSHOT_DIR;
  process.env.SURVEY_KB_SNAPSHOT_DIR=dir;
  t.after(()=>{if(previous===undefined)delete process.env.SURVEY_KB_SNAPSHOT_DIR;else process.env.SURVEY_KB_SNAPSHOT_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});});
  const {root}=fixture(t);assert.equal(config(root).snapshotGeneration,0);assert.equal(enabled(root),true);
  atomic(path.join(dir,'control.json'),{generation:1,pending_restore:{target:'snapshot'}});
  assert.equal(enabled(root),false);assert.equal(enqueue(root,'submit_paper',{},{}),null);
  const fresh=path.join(dir,'new-run');configure(fresh);assert.equal(config(fresh).snapshotGeneration,1);assert.equal(enabled(fresh),false);
  atomic(path.join(dir,'control.json'),{generation:1});assert.equal(enabled(root),false);assert.equal(enabled(fresh),true);
});
