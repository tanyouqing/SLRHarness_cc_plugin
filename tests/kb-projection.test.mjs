import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {project,splitParts,requestBytes,frozenProjection,distillRoles} from '../scripts/kb-projection.mjs';
import {configure,sha,atomic,json,kbPath} from '../scripts/kb-core.mjs';
import {enqueue,processOne,items,runOnce,parseSyncArgs} from '../scripts/kb-sync.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'projection-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));configure(root);return root;}
test('projection preserves decisions, errors and unknown events; bounds tool bodies and references exact repetitions',()=>{
  const body='😀'.repeat(14000),events=[{type:'progress',data:'noise'},
    {type:'assistant',message:{content:[{type:'text',text:'decision'},{type:'tool_use',name:'search',input:{query:'evidence'}}]}},
    {type:'user',message:{content:[{type:'tool_result',is_error:true,content:body}]}},
    {type:'user',message:{content:[{type:'tool_result',content:body}]}},{type:'new-runtime-event',data:{important:true}}];
  const output=project(events.map(x=>JSON.stringify(x)).join('\n'),10).trim().split('\n').map(JSON.parse);
  assert.deepEqual(output.map(x=>x.originalLine),[11,12,13,14]);
  assert.equal(output[0].event.message.content[0].text,'decision');
  const tool=output[1].event.message.content[0];assert.equal(tool.is_error,true);assert.equal(Array.from(tool.content.head).length,6000);assert.equal(tool.content.originalCharacters,14000);
  assert.equal(output[2].event.message.content[0].content.exactRepeat.originalLine,12);
  assert.equal(output[3].unrecognizedEvent,true);assert.equal(output[3].event.data.important,true);
});
test('projection is frozen and rejects changed originals; all four execution roles only',t=>{
  const root=fixture(t),text='{"type":"system","text":"outcome"}\n',record={role:'worker',agentId:'a',sessionId:'s'};
  const first=frozenProjection(root,'key',record,text);
  assert.deepEqual(frozenProjection(root,'key',{...record,role:'paper'},text),first);
  assert.throws(()=>frozenProjection(root,'key',record,text+'{}\n'),/hash mismatch/);
  assert.deepEqual([...distillRoles],['worker','manager','scoper','paper']);
});
test('multipart respects UTF-8 and escaped JSON request budgets without losing bytes',()=>{
  const content=('😀中\u0001\\"').repeat(300),parts=splitParts(content,{},300,1800);
  assert.equal(parts.join(''),content);assert.ok(parts.length>1);
  for(const [i,p] of parts.entries()){assert.ok(Buffer.byteLength(p)<=300);assert.equal(Buffer.from(p).toString(),p);assert.ok(requestBytes({content:p,metadata:{},transfer:{id:'0'.repeat(64),index:i,count:parts.length,contentHash:'0'.repeat(64)}})<=1800);}
});
test('multipart lost response retries same part then persists final job and only polls it',async t=>{
  const root=fixture(t),requests=[0,1].map(index=>({content:'{}',transfer:{id:'t',index,count:2,contentHash:'h'}}));
  atomic(kbPath(root,'projections/parts.json'),requests);
  enqueue(root,'submit_trajectory',requests[0],{partsFile:'projections/parts.json',partCount:2,transferId:'t'});
  let now=Date.now(),lost=true;const seen=[],transport={call:async(name,args)=>{
    seen.push([name,args]);if(name==='get_job')return {status:'succeeded',result:{ids:[]}};
    if(lost){lost=false;throw new Error('response lost after stored part');}
    return args.transfer.index===0?{status:'accepted',transfer_id:'t',part_count:2}:{status:'stored',id:'trace',job_id:'job'};
  }};
  await processOne(root,{transport,isReady:()=>true,now});now+=2000;
  await processOne(root,{transport,isReady:()=>true,now});assert.equal(items(root)[0].partIndex,1);
  await processOne(root,{transport,isReady:()=>true,now});assert.equal(items(root)[0].jobId,'job');now+=30000;
  await processOne(root,{transport,isReady:()=>true,now});assert.equal(items(root)[0].status,'succeeded');
  assert.deepEqual(seen[0],seen[1]);assert.deepEqual(seen.at(-1),['get_job',{job_id:'job'}]);
});
test('tracking survives 30 minutes, default budget is six hours and explicit budget remains bounded',async t=>{
  const root=fixture(t);assert.equal(parseSyncArgs(['once',root]).maxWaitMs,21600000);
  const id=enqueue(root,'submit_trajectory',{content:'{}'},{}),file=kbPath(root,`outbox/${id}.json`);
  atomic(file,{...json(file),status:'tracking',jobId:'existing',trackUntil:1});let now=0,calls=0;
  const result=await runOnce(root,{isReady:()=>true,prepare:()=>({warnings:[]}),clock:()=>now,sleep:async ms=>{now+=ms;},maxWaitMs:21600000,
    transport:{call:async(name,args)=>{assert.equal(name,'get_job');assert.equal(args.job_id,'existing');calls++;return now>=1900000?{status:'succeeded',result:{ids:[]}}:{status:'queued'};}}});
  assert.equal(result.status,'complete');assert.ok(now>1800000);assert.ok(calls>60);
});
test('six-hour deadline retains remote job; next invocation resumes polling without submission',async t=>{
  const root=fixture(t),id=enqueue(root,'submit_trajectory',{content:'{}'},{}),file=kbPath(root,`outbox/${id}.json`);
  atomic(file,{...json(file),status:'tracking',jobId:'existing'});let now=0;
  const options={isReady:()=>true,prepare:()=>({warnings:[]}),clock:()=>now,sleep:async ms=>{now+=ms;}};
  const result=await runOnce(root,{...options,transport:{call:async()=>({status:'running'})}});
  assert.equal(now,21600000);assert.equal(result.reason,'time_limit');assert.equal(items(root)[0].jobId,'existing');
  const resumed=await runOnce(root,{...options,transport:{call:async name=>{assert.equal(name,'get_job');return {status:'succeeded',result:{ids:[]}};}}});
  assert.equal(resumed.status,'complete');
});
