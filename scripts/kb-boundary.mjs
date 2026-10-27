import fs from 'node:fs';
import path from 'node:path';
import {atomic,json,sha,kbPath,runtime,config,locked} from './kb-core.mjs';
import {locateNative} from './kb-trajectory.mjs';

export const batchFile=(root,id)=>{
  if(!/^[a-f0-9]{64}$/.test(id??''))throw new Error('invalid KB batch ID');
  return kbPath(root,`batches/${id}.json`);
};
function readNative(file) {
  if(!path.isAbsolute(file??'')||fs.lstatSync(file).isSymbolicLink())throw new Error('native transcript unavailable');
  return fs.readFileSync(file);
}
function events(bytes,start=0) {
  const result=[];let at=start;
  while(at<bytes.length) {
    const nl=bytes.indexOf(10,at);if(nl<0)break;
    const value=JSON.parse(bytes.subarray(at,nl).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('native event must be an object');
    result.push({value,end:nl+1});at=nl+1;
  }
  return result;
}
function matches(event,text) {
  const v=event.value;if(v.type!=='assistant'||v.message?.role!=='assistant')return false;
  const blocks=v.message.content;
  if(typeof blocks==='string')return blocks===text;
  if(!Array.isArray(blocks)||blocks.some(b=>b.type==='tool_use'))return false;
  const parts=blocks.filter(b=>b.type==='text').map(b=>b.text);
  return parts.join('\n')===text||parts.join('')===text;
}

// Snapshot local byte boundaries at Stop. Later chat must not extend this batch.
export function snapshotSources(root,input) {
  const rt=runtime(root),sources=[],errors=[];
  const add=(file,agentId,sessionId,role,start=0,task=null,final=false)=>{
    try {
      const bytes=readNative(file),complete=bytes.lastIndexOf(10)+1;
      if(start>complete||start&&bytes[start-1]!==10)throw new Error('invalid transcript start');
      const source={file:path.resolve(file),agentId,sessionId,role,start,task,size:bytes.length,prefixHash:sha(bytes),end:complete};
      if(final) {
        if(typeof input.last_assistant_message!=='string'||!input.last_assistant_message.trim())throw new Error('Stop final message is missing');
        source.expected=input.last_assistant_message;
        const last=events(bytes,start).filter(e=>e.value.type==='assistant').at(-1);
        source.end=last&&matches(last,source.expected)?last.end:null;
      } else if(complete!==bytes.length)source.end=null;
      source.scanStart=complete;sources.push(source);
    }catch(e){errors.push({agentId,sessionId,reason:e.message});}
  };
  for(const [id,a] of Object.entries(rt.agents))add(a.transcript??locateNative(rt,a.sessionId,id),id,a.sessionId,a.role,0,a.task??null);
  for(const [id,a] of Object.entries(rt.sessions)) {
    for(const segment of a.segments??[])add(segment.transcript,'main',id,'main',segment.start);
    add(a.transcript,'main',id,'main',a.start??0,null,id===input.session_id);
  }
  if(!rt.sessions[input.session_id])errors.push({reason:'Stop session is not attached'});
  return {sources,errors};
}

export function resolveSource(source) {
  const bytes=readNative(source.file);
  if(bytes.length<source.size||sha(bytes.subarray(0,source.size))!==source.prefixHash)throw new Error('native transcript prefix changed after Stop');
  let end=source.end;
  if(end===null) {
    for(const event of events(bytes,source.scanStart)) {
      if(source.expected!==undefined) {
        if(event.value.type==='user')throw new Error('next user turn arrived before the Stop message could be located');
        if(matches(event,source.expected)){end=event.end;break;}
      } else {end=event.end;break;}
    }
  }
  if(end===null)return null;
  const content=bytes.subarray(source.start,end);
  events(content); // Validate every frozen line, without deleting/reordering events.
  return {end,content};
}

export async function freezeStopBatch(root,id,{clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),waitMs=30000}={}) {
  const file=batchFile(root,id),batch=json(file);
  if(batch.frozen)return {frozen:true};
  if(batch.errors.length)return {frozen:false,warnings:batch.errors.map(e=>e.reason)};
  const deadline=clock()+waitMs;let resolved;
  while(true) {
    try{resolved=batch.sources.map(resolveSource);}catch(e){return {frozen:false,warnings:[e.message]};}
    if(resolved.every(Boolean))break;
    if(clock()>=deadline)return {frozen:false,warnings:['Stop transcript is not fully flushed; resume after inspecting the native file']};
    await sleep(Math.min(250,deadline-clock()));
  }
  return locked(root,'capture',()=>{
    const current=json(file);if(current.frozen)return {frozen:true};
    const manifestFile=kbPath(root,'trajectories.json'),manifest=fs.existsSync(manifestFile)?json(manifestFile):{files:{}};
    // Keep prior frozen batches; replace only live capture entries with this exact snapshot.
    for(const [key,value] of Object.entries(manifest.files))if(!value.batchId)delete manifest.files[key];
    batch.sources.forEach((s,i)=>{
      const {content,end}=resolved[i],key=sha(config(root).runId+'\0'+id+'\0'+s.agentId+'\0'+s.sessionId+'\0'+s.file+'\0'+s.start);
      const archive=`trajectories/${key}.jsonl`,out=kbPath(root,archive);
      fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,content,{mode:0o600});
      manifest.files[key]={source:s.file,agentId:s.agentId,sessionId:s.sessionId,role:s.role,task:s.task,start:s.start,offset:end,
        lineStart:readNative(s.file).subarray(0,s.start).toString('utf8').split('\n').length,lines:content.toString('utf8').split('\n').length-1,
        archive,hash:sha(content),pendingBytes:0,batchId:id,
        previous:Object.keys(manifest.files).filter(k=>k!==key&&manifest.files[k].agentId===s.agentId).at(-1)??null,
        previousTaskSegment:s.task?Object.keys(manifest.files).filter(k=>k!==key&&manifest.files[k].task===s.task&&manifest.files[k].role===s.role).at(-1)??null:null};
    });
    atomic(manifestFile,manifest);atomic(file,{...current,frozen:true,frozenAt:clock()});
    return {frozen:true};
  });
}
