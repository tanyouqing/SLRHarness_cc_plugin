import fs from 'node:fs';
import path from 'node:path';
import {resolveBinding} from './workspace-binding.mjs';
import {workspaceRoots} from './workspace-context.mjs';
import {atomicJSON,withLock} from './pipeline.mjs';

const file=root=>path.join(root,'.slr/native-tasks.json');
const read=root=>fs.existsSync(file(root))?JSON.parse(fs.readFileSync(file(root),'utf8')):{tasks:{}};
const id=v=>typeof v==='string'&&/^[\w-]{1,200}$/.test(v);
const role=input=>String(input.agent_type??'').split(':').at(-1);

// Only host lifecycle/tool output establishes task ownership. Agent-provided IDs
// in prompts or result text never create a mapping. This also works with KB off.
export function observeNativeTasks(input) {
  if(input.hook_event_name==='PostToolUse'&&input.tool_name==='Agent'&&role(input)==='slr-manager') {
    const bound=resolveBinding(input),args=input.tool_input??{},response=input.tool_response;
    if(!bound||bound.b.role!=='manager'||!input.session_id||String(args.subagent_type??'').split(':').at(-1)!=='slr-worker')return;
    if(!response||response.isError||response.status!=='async_launched'||!id(response.agentId))return;
    const leaseId=args.resume?Object.values(bound.state.leases).find(l=>l.agentId===args.resume)?.id:/\bSLR_LEASE=([\w-]+)\b/.exec(args.prompt??'')?.[1];
    const lease=bound.state.leases[leaseId];
    if(!lease?.active||lease.topicId!==bound.b.topicId||(!args.resume&&!lease.launchClaimed)||lease.agentId&&lease.agentId!==response.agentId)return;
    const taskId=response.task_id??response.taskId??response.agentId;if(!id(taskId))return;
    withLock(bound.root,()=>{
      const all=read(bound.root),prior=all.tasks[taskId];
      if(prior&&(prior.managerId!==input.agent_id||prior.workerId!==response.agentId||prior.leaseId!==leaseId))throw new Error('native task identity collision');
      all.tasks[taskId]={taskId,workerId:response.agentId,managerId:input.agent_id,sessionId:input.session_id,
        leaseId,topicId:bound.b.topicId,active:true,observedAt:Date.now(),source:'PostToolUse:Agent'};
      atomicJSON(file(bound.root),all);
    });
  }
  if(input.hook_event_name==='SubagentStop'&&input.agent_id)for(const root of workspaceRoots(input)) {
    if(!fs.existsSync(file(root)))continue;
    withLock(root,()=>{
      const all=read(root);let changed=false;
      for(const t of Object.values(all.tasks))if(t.workerId===input.agent_id&&t.sessionId===input.session_id){t.active=false;t.stoppedAt=Date.now();changed=true;}
      if(changed)atomicJSON(file(root),all);
    });
  }
}

export function authorizeNativeTask(input,bound) {
  if(role(input)!=='slr-manager'||!bound||bound.b.role!=='manager'||bound.state.stage!=='researching')throw new Error('only an active bound Manager may manage its observed Worker tasks');
  const args=input.tool_input??{},allowed=input.tool_name==='TaskOutput'?['task_id','block','timeout']:['task_id'];
  if(Object.keys(args).some(k=>!allowed.includes(k))||!id(args.task_id))throw new Error('invalid background Worker task arguments');
  const t=read(bound.root).tasks[args.task_id],lease=t&&bound.state.leases[t.leaseId];
  if(!t||!input.session_id||t.sessionId!==input.session_id||t.managerId!==input.agent_id||t.topicId!==bound.b.topicId||
    !lease||lease.topicId!==bound.b.topicId||lease.agentId&&lease.agentId!==t.workerId)throw new Error('task is not a host-observed Worker owned by this Manager/session');
  if(input.tool_name==='TaskStop') {
    if(!lease.active||!t.active)throw new Error('Worker task is no longer active');
    return args;
  }
  if(args.block!==undefined&&typeof args.block!=='boolean'||args.timeout!==undefined&&(!Number.isInteger(args.timeout)||args.timeout<0))throw new Error('invalid task wait options');
  return {...args,block:args.block??false,timeout:Math.min(args.timeout??30000,30000)};
}
