import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,config,atomic,kbPath,storeResponse,authorize,json} from '../scripts/kb-core.mjs';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';
import {stageFeedback,recordFeedback,feedbackItems,recoverFeedback} from '../scripts/kb-feedback.mjs';
import {refreshStrategyEntry} from '../scripts/kb-cache-refresh.mjs';
const id='00000000-0000-4000-8000-000000000001';
const content={role:'worker',sourceType:'review',strategy:'advice',executionSummary:'observed'};
function fixture(t) {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'kb-feedback-')),root=path.join(project,'workspaces','run');
  t.after(()=>fs.rmSync(project,{force:true,recursive:true}));
  atomic(path.join(root,'.slr/state.json'),{stage:'researching',topics:[{id:'topic',status:'researching'}],papers:{},bindings:{w:{role:'worker',topicId:'topic',taskId:'task',leaseId:'lease'}},leases:{lease:{active:true,agentId:'w',phase:'discover'}}});
  configure(root,{});
  const input=(method,args)=>({project_dir:project,cwd:project,agent_id:'w',agent_type:'slr-worker',session_id:'s',tool_name:'mcp__survey-kb__'+method,tool_input:args});
  const query=input('search_strategies',{query:'advice'});
  const view=storeResponse({...query,tool_response:{results:[{id,revision:1,role:'worker',snippet:'advice',status:'active'}]}});
  const payload={strategy_id:id,revision:1,suggested_status:'need_revised',reason:'conflicting action',context:{situation:'condition',action:'applied suggestion',outcome:'required check failed',evidence:['concrete output']}};
  return {root,project,input,payload,view,entry:json(kbPath(root,`cache/${view.cacheKey}.json`))};
}
test('feedback requires actual own-task retrieval; fills trusted identity and rejects impersonation',t=>{
  const f=fixture(t),input=f.input('report_strategy_feedback',f.payload),a=authorize(input);
  assert.equal(a.args.context.role,'worker');assert.equal(a.args.context.task,'topic/task');assert.equal(a.args.context.runId,config(f.root).runId);
  assert.equal(evaluateHook(input).allowed,true);
  for(const patch of [{revision:2},{strategy_id:'00000000-0000-4000-8000-000000000002'},{suggested_status:'active'},{context:{...f.payload.context,role:'manager'}}])assert.equal(evaluateHook(f.input('report_strategy_feedback',{...f.payload,...patch})).allowed,false);
  for(const role of ['reviewer','checker','main'])assert.equal(evaluateHook({...input,agent_type:`slr-${role}`}).allowed,false);
  assert.equal(evaluateHook({...input,agent_id:undefined,agent_type:undefined}).allowed,false);
  assert.equal(evaluateHook({...input,tool_name:'mcp__arxiv__report_strategy_feedback'}).updatedInput,undefined);
});
test('feedback is frozen before sending; response loss resumes same input without success gate',async t=>{
  const f=fixture(t),input=f.input('report_strategy_feedback',f.payload);
  stageFeedback(input);stageFeedback(input);assert.equal(feedbackItems(f.root).length,1);
  let first=true,calls=0;const remote=new Map();
  const transport={async call(name,payload){calls++;assert.equal(name,'report_strategy_feedback');const key=JSON.stringify(payload);if(!remote.has(key))remote.set(key,{status:'accepted',job_id:id,feedback_id:id});if(first){first=false;throw new Error('lost response');}return remote.get(key);}};
  await recoverFeedback(f.root,{transport});assert.equal(feedbackItems(f.root)[0].status,'pending');
  await recoverFeedback(f.root,{transport});assert.equal(feedbackItems(f.root)[0].status,'accepted');assert.equal(remote.size,1);assert.equal(calls,2);
  await recoverFeedback(f.root,{transport:{async call(name,args){assert.equal(name,'get_job');assert.equal(args.job_id,id);return {status:'succeeded',result:{outcome:'retain'}};}}});
  assert.equal(feedbackItems(f.root)[0].status,'succeeded');
});
test('host receipt records accepted only; server failures never resubmit; expired leases recover',async t=>{
  const f=fixture(t),input=f.input('report_strategy_feedback',f.payload);stageFeedback(input);
  const r=recordFeedback({...input,tool_response:{status:'accepted',feedback_id:id,job_id:id}});assert.match(r.message,/no state change/);
  const x=feedbackItems(f.root)[0],file=kbPath(f.root,`feedback/${x.key}.json`);atomic(file,{...x,lease:{id:'dead',until:1}});
  await recoverFeedback(f.root,{transport:{async call(name){assert.equal(name,'get_job');return {status:'failed',error:'model failed'};}}});
  assert.equal(feedbackItems(f.root)[0].status,'server_failed');
  await recoverFeedback(f.root,{transport:{call:async name=>{assert.equal(name,'get_job');return {status:'queued'};}}});
});
test('strategy cache never injects disabled, need_revised or unavailable records; newer versions preserve old feedback references',async t=>{
  const f=fixture(t);let status='disabled';
  const transport={async call(name,args){assert.equal(name,'read');assert.equal(args.revision,undefined);return {id,kind:'experience',strategy_status:status,revision:2,current_revision:2,status_version:3,content,sources:[]};}};
  for(status of ['disabled','need_revised'])assert.deepEqual((await refreshStrategyEntry(f.root,f.entry,{transport})).result.results,[]);
  status='active';const fresh=await refreshStrategyEntry(f.root,f.entry,{transport});assert.equal(fresh.result.results[0].revision,2);
  assert.ok(authorize(f.input('report_strategy_feedback',f.payload)));
  assert.ok(authorize(f.input('report_strategy_feedback',{...f.payload,revision:2})));
  const failed=await refreshStrategyEntry(f.root,f.entry,{transport:{call:async()=>{throw new Error('offline');}}});assert.equal(failed.result.unavailable,true);assert.deepEqual(failed.result.results,[]);
  assert.equal(evaluateHook({...f.input('read',{}),tool_name:'Read',tool_input:{file_path:f.view.cachePath}}).allowed,false);
});
test('paper cache does not require strategy checks; full strategy reads also revalidate',async t=>{
  const f=fixture(t),transport={call:()=>assert.fail('paper should not query strategy')};
  const paper={method:'read',args:{type:'paper'},result:{id}};assert.equal(await refreshStrategyEntry(f.root,paper,{transport}),paper);
  const entry={...f.entry,method:'read',args:{type:'experience',id,revision:1},result:{id,revision:1,content}};
  const next=await refreshStrategyEntry(f.root,entry,{transport:{call:async()=>({id,revision:2,current_revision:2,strategy_status:'active',content,sources:[]})}});assert.equal(next.args.revision,2);
  const inactive=await refreshStrategyEntry(f.root,entry,{transport:{call:async()=>({id,revision:2,current_revision:2,strategy_status:'disabled',content})}});assert.equal(inactive.result.unavailable,true);
});
