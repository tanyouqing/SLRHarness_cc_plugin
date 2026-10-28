import fs from 'node:fs';
import path from 'node:path';
import {sha,atomic,json,kbPath,config} from './kb-core.mjs';

export const projectionVersion='slr-projection-1';
export const distillRoles=new Set(['worker','manager','scoper','paper']);
const noise=new Set(['progress','file-history-snapshot','queue-operation']);
const known=new Set(['user','assistant','system','result','tool','tool_result','tool_use']);
export function project(content,lineStart=1) {
  const seen=new Map(),events=[];
  function reduce(value,line,tool=false) {
    if(typeof value==='string') {
      const chars=Array.from(value);
      if(chars.length>=2000) {
        const digest=sha(value),previous=seen.get(digest);
        if(previous)return {exactRepeat:{hash:digest,originalLine:previous},originalCharacters:chars.length};
        seen.set(digest,line);
        if(tool&&chars.length>12000)return {head:chars.slice(0,6000).join(''),tail:chars.slice(-6000).join(''),
          omitted:{start:6000,end:chars.length-6000},originalCharacters:chars.length,hash:digest};
      }
      return value;
    }
    if(Array.isArray(value))return value.map(x=>reduce(x,line,tool));
    if(value&&typeof value==='object') {
      const isTool=tool||['tool_use','tool_result','tool'].includes(value.type);
      const out={};
      for(const [k,v] of Object.entries(value)) {
        if(['usage','costUSD','durationMs','durationApiMs'].includes(k))continue;
        // Tool argument objects are bounded as a whole, not just individual leaves.
        if(isTool&&['input','output','content'].includes(k)&&v&&typeof v==='object'&&Array.from(JSON.stringify(v)).length>12000)
          out[k]=reduce(JSON.stringify(v),line,true);
        else out[k]=reduce(v,line,isTool);
      }
      return out;
    }
    return value;
  }
  const lines=content.replace(/\r\n/g,'\n').split('\n');if(lines.at(-1)==='')lines.pop();
  lines.forEach((line,i)=>{
    const event=JSON.parse(line);if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('invalid trajectory event');
    if(noise.has(event.type))return;
    events.push({originalLine:i+lineStart,...(!known.has(event.type)?{unrecognizedEvent:true}:{}),event:reduce(event,i+lineStart)});
  });
  return events.map(e=>JSON.stringify(e)).join('\n')+(events.length?'\n':'');
}
export function requestBytes(payload) {
  return Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:'x'.repeat(64),method:'tools/call',params:{name:'submit_trajectory',arguments:payload}}));
}
export function splitParts(content,metadata,maxBytes=4*1024*1024,requestLimit=16*1024*1024) {
  const parts=[];let start=0,bytes=0;
  for(let i=0;i<content.length;) {
    const cp=content.codePointAt(i),width=cp>0xffff?2:1,n=Buffer.byteLength(String.fromCodePoint(cp));
    if(bytes+n>maxBytes){parts.push(content.slice(start,i));start=i;bytes=0;}
    bytes+=n;i+=width;
  }
  if(start<content.length)parts.push(content.slice(start));
  // Escaping control characters can expand a request beyond the raw-byte limit.
  let changed=true;
  while(changed) {
    changed=false;
    for(let i=0;i<parts.length;i++)if(requestBytes({content:parts[i],metadata,transfer:{id:'0'.repeat(64),index:i,count:parts.length,contentHash:'0'.repeat(64)}})>requestLimit) {
      const chars=Array.from(parts[i]);if(chars.length<2)throw new Error('trajectory metadata exceeds request limit');
      const middle=Math.floor(chars.length/2);parts.splice(i,1,chars.slice(0,middle).join(''),chars.slice(middle).join(''));changed=true;break;
    }
  }
  if(parts.length>10000)throw new Error('trajectory requires too many parts');
  return parts;
}
export function frozenProjection(root,key,t,content) {
  const file=kbPath(root,`projections/${key}.json`);
  if(fs.existsSync(file)) {
    const saved=json(file);
    if(saved.originalHash!==sha(content)||sha(saved.content)!==saved.contentHash)throw new Error('frozen projection hash mismatch');
    return saved;
  }
  const projected=project(content,t.lineStart??1),metadata={runId:config(root).runId,agentId:t.agentId??'unknown',agentRole:t.role??'other',
    sessionId:t.sessionId??'unknown',...(typeof t.task==='string'&&t.task?{task:t.task}:{}),...(t.stage?{stage:t.stage}:{}),
    originalHash:sha(content),projectionVersion,lineMapping:'embedded-originalLine'};
  const saved={originalHash:sha(content),content:projected,contentHash:sha(projected),metadata};
  fs.mkdirSync(path.dirname(file),{recursive:true});atomic(file,saved);return saved;
}
