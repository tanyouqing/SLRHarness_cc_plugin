import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,atomic,kbPath,sha} from '../scripts/kb-core.mjs';
import {enqueue,items,resume,claim,runOnce,processOne,summary} from '../scripts/kb-sync.mjs';
import {cleanQueue} from '../scripts/kb-cleanup-queue.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'slr-cleanup-'));configure(root);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('cleanup preview is read-only; removed records are terminal and reconciliation cannot enqueue duplicates',async t=>{
  const root=fixture(t),payload={content:'{}'},id=enqueue(root,'submit_trajectory',payload,{});
  const item=items(root)[0];atomic(kbPath(root,`outbox/${id}.json`),{...item,status:'tracking',jobId:'deleted-job',remoteId:'trace'});
  const plan={snapshotHash:'snapshot',jobs:[{id:'deleted-job'}],experiences:[],trajectories:[{id:'trace'}]};
  assert.deepEqual(cleanQueue(root,plan),[id]);assert.equal(items(root)[0].status,'tracking');
  cleanQueue(root,plan,true);assert.equal(items(root)[0].status,'removed');assert.deepEqual(cleanQueue(root,plan,true),[]);
  assert.equal(resume(root).resumed,0);assert.equal(claim(root),null);assert.equal(enqueue(root,'submit_trajectory',payload,{}),id);assert.equal(items(root)[0].status,'removed');
  const result=await runOnce(root,{isReady:()=>true,prepare:()=>({warnings:[]}),transport:{call:()=>assert.fail('must not send')}});
  assert.equal(result.status,'complete_with_exclusions');assert.equal(summary(root).trajectories.removed,1);assert.equal(summary(root).trajectories.succeeded,0);
  assert.equal(summary(root).administrativeCleanup.count,1);
});
test('stored-without-distillation receipt is retained and never polled or counted as distilled',async t=>{
  const root=fixture(t);enqueue(root,'submit_trajectory',{content:'{}'},{});
  await processOne(root,{isReady:()=>true,transport:{call:async()=>({status:'stored',id:'trace',job_id:null,distillation:'skipped',reason:'unknown identity'})}});
  assert.equal(items(root)[0].status,'retained');assert.equal(resume(root).resumed,0);assert.equal(summary(root).trajectories.retained,1);
});
test('cleanup refuses an in-flight local request',t=>{
  const root=fixture(t),id=enqueue(root,'submit_trajectory',{content:'{}'},{}),item=items(root)[0];
  atomic(kbPath(root,`outbox/${id}.json`),{...item,jobId:'job',lease:{token:'token',until:Date.now()+60000}});
  assert.throws(()=>cleanQueue(root,{jobs:[{id:'job'}],experiences:[],trajectories:[]},true),/active request/);
});

test('lost upload receipt is matched by normalized content hash before resume can resubmit',t=>{
  const root=fixture(t);enqueue(root,'submit_trajectory',{content:'{}\n'},{});
  const plan={jobs:[],experiences:[],trajectories:[{id:'remote',contentHash:sha('[{}]')}],ingestions:[]};
  assert.equal(cleanQueue(root,plan,true).length,1);assert.equal(items(root)[0].status,'removed');
});
