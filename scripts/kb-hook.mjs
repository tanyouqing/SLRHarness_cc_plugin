import {capture,locateNative} from './kb-trajectory.mjs';
export {capture} from './kb-trajectory.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KB_PREFIX,atomic,json,sha,safe,kbPath,enabled,config,locked,warning,runtime,rootsFor,resolveCaller,storeResponse} from './kb-core.mjs';
import {scheduleStop} from './kb-stop.mjs';

const mainFile=input=>safe(path.resolve(input.project_dir??process.env.CLAUDE_PROJECT_DIR??input.cwd??'.'),`.slr-kb-sessions/${sha(String(input.session_id))}.json`);
export function noteSession(input) {
  if(!input.session_id||input.agent_id||!input.transcript_path)return;
  const f=mainFile(input),old=fs.existsSync(f)?json(f):{};
  let start=0;
  if(fs.existsSync(input.transcript_path)) {
    const bytes=fs.readFileSync(input.transcript_path),last=bytes.lastIndexOf(10);
    start=last<0?0:last+1;
    // UserPromptSubmit can run before or after the user event is appended.
    if(input.hook_event_name==='UserPromptSubmit'&&last>=0) {
      const prior=bytes.lastIndexOf(10,last-1),line=bytes.subarray(prior+1,last).toString('utf8');
      try{if(JSON.parse(line).type==='user')start=prior+1;}catch{/* leave complete-line boundary */}
    }
  }
  atomic(f,{...old,sessionId:input.session_id,transcript:path.resolve(input.transcript_path),start,inputAt:Date.now()});
}
export function attach(input,root) {
  const f=mainFile(input),session=fs.existsSync(f)?json(f):null;
  if(!session||session.sessionId!==input.session_id)throw new Error('KB attach requires SessionStart/UserPromptSubmit metadata');
  config(root);
  return locked(root,'runtime',()=>{
    const rt=runtime(root);
    if(!rt.sessions[input.session_id])rt.sessions[input.session_id]={...session,attachedAt:Date.now()};
    atomic(kbPath(root,'runtime.json'),rt);return {attached:true};
  });
}

function attachCommand(input) {
  if(input.agent_id||input.tool_name!=='Bash')return null;
  const text=input.tool_input?.command??'';
  if(/[;&|`$<>\r\n]/.test(text))return null;
  const tokens=[...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m=>m[1]??m[2]??m[3]);
  const expected=path.join(path.dirname(fileURLToPath(import.meta.url)),'kb-control.mjs');
  if(tokens.length!==4||tokens[0]!=='node'||path.resolve(tokens[1])!==expected||tokens[2]!=='attach')return null;
  const root=path.resolve(tokens[3]);if(!rootsFor(input).includes(root))throw new Error('KB attach workspace outside project');return root;
}
export function lifecycle(input) {
  if(['SessionStart','UserPromptSubmit'].includes(input.hook_event_name))noteSession(input);
  const attaching=attachCommand(input);if(attaching)attach(input,attaching);
  let root=resolveCaller(input)?.root;
  if(!root) {
    const candidates=rootsFor(input).filter(r=>{try{return !!runtime(r).sessions[input.session_id];}catch{return false;}});
    if(candidates.length===1)root=candidates[0];
  }
  if(!root||!enabled(root))return;
  const attached=runtime(root).sessions[input.session_id];
  if(!input.agent_id&&attached&&input.transcript_path&&path.resolve(input.transcript_path)!==attached.transcript)locked(root,'runtime',()=>{
    const current=runtime(root),s=current.sessions[input.session_id];
    (s.segments??=[]).push({transcript:s.transcript,start:s.start});s.transcript=path.resolve(input.transcript_path);s.start=0;
    atomic(kbPath(root,'runtime.json'),current);
  });
  // Stop captures the boundary itself. After handoff, later chat must not append
  // to live archives while the detached process waits for the final native line.
  if(input.hook_event_name==='Stop'&&!input.agent_id) {
    const stopped=scheduleStop(root,input);if(stopped.batchId)return;
  }
  let rt=runtime(root),agent=input.agent_id;
  const type=String(input.agent_type??'').split(':').at(-1),roles={'slr-worker':'worker','slr-manager':'manager','slr-scoper':'scoper','slr-paper-writer':'paper','slr-checker':'checker','slr-reviewer':'reviewer'};
  if(agent)locked(root,'runtime',()=>{
    rt=runtime(root);const a=rt.agents[agent]??{};
    rt.agents[agent]={...a,role:roles[type]??'other',sessionId:input.session_id,active:input.hook_event_name!=='SubagentStop',
      ...(input.agent_transcript_path?{transcript:path.resolve(input.agent_transcript_path)}:{}),lastSeen:Date.now()};
    atomic(kbPath(root,'runtime.json'),rt);
  });
  rt=runtime(root);
  const caller=resolveCaller(input);
  const subfile=input.agent_transcript_path??rt.agents[agent]?.transcript??locateNative(rt,input.session_id,agent);
  try {
    if(agent&&subfile) {
      locked(root,'runtime',()=>{
        const fresh=runtime(root),a=fresh.agents[agent],b=caller?.b;
        a.transcript=subfile;a.task=b?.taskId?`${b.topicId}/${b.taskId}`:b?.topicId??b?.submissionId??(a.role==='scoper'?'scope':null);
        const parents=Object.entries(caller?.state.bindings??{}).filter(([,binding])=>binding.role==='manager'&&binding.topicId===b?.topicId);
        a.parentAgentId=a.role==='worker'&&parents.length===1?parents[0][0]:null;
        a.parentSessionId=input.session_id;atomic(kbPath(root,'runtime.json'),fresh);
      });
      if(!rt.finishRequested?.batchId)capture(root,{file:subfile,agentId:agent,sessionId:input.session_id,role:roles[type]??'other',task:runtime(root).agents[agent].task});
    }
    if(!agent&&rt.sessions[input.session_id]) {
      const session=runtime(root).sessions[input.session_id];
      if(!rt.finishRequested?.batchId)capture(root,{file:session.transcript,agentId:'main',sessionId:input.session_id,role:'main',start:session.start});
    }
  }catch(e){warning(root,`capture:${agent??input.session_id}`,e);}
}
export function hook(input) {
  let output={};
  if(input.hook_event_name==='PostToolUse'&&input.tool_name?.startsWith(KB_PREFIX)) {
    let value;
    try{value=storeResponse(input);}catch(e){value={unavailable:true,error:'KB response could not be safely processed; use original workflow'};const c=resolveCaller(input);if(c)warning(c.root,'response',e);}
    output={hookSpecificOutput:{hookEventName:'PostToolUse',updatedMCPToolOutput:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}}};
  }
  try{lifecycle(input);}catch(e){const c=resolveCaller(input);if(c)warning(c.root,'capture-hook',e);}
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let raw='';for await(const chunk of process.stdin)raw+=chunk;
  try{console.log(JSON.stringify(hook(JSON.parse(raw))));}catch{console.log('{}');}
}
