import fs from 'node:fs';
import path from 'node:path';
import {atomic,json,sha,kbPath,enabled,config,locked} from './kb-core.mjs';
// Recovery discovery is restricted to the attached native session's subagents tree.
// A filename alone is insufficient: require a matching native agentId event.
export function locateNative(rt,sessionId,agentId) {
  if(!agentId||!/^[\w-]+$/.test(agentId))return null;
  const main=rt.sessions[sessionId]?.transcript;if(!main)return null;
  const base=path.join(path.dirname(main),path.basename(main,'.jsonl'),'subagents');
  const found=[];
  function scan(dir,depth=0) {
    if(depth>3||!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink())return;
    for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
      if(e.isSymbolicLink())continue;
      const f=path.join(dir,e.name);
      if(e.isDirectory())scan(f,depth+1);
      else if(e.name===`agent-${agentId}.jsonl`||e.name===`${agentId}.jsonl`) {
        const fd=fs.openSync(f,'r'),buffer=Buffer.alloc(65536);let n;
        try{n=fs.readSync(fd,buffer,0,buffer.length,0);}finally{fs.closeSync(fd);}
        const lines=buffer.subarray(0,n).toString('utf8').split('\n');lines.pop();
        if(lines.some(line=>{try{return JSON.parse(line).agentId===agentId;}catch{return false;}}))found.push(f);
      }
    }
  }
  scan(base);return found.length===1?found[0]:null;
}
export function capture(root,{file,agentId,sessionId,role,start=0,task=null}) {
  if(!enabled(root)||fs.existsSync(kbPath(root,'sealed.json')))return;
  if(!path.isAbsolute(file??'')||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())throw new Error('native transcript path unavailable');
  return locked(root,'capture',()=>{
    const manifestFile=kbPath(root,'trajectories.json'),m=fs.existsSync(manifestFile)?json(manifestFile):{files:{}};
    const key=sha(config(root).runId+'\0'+agentId+'\0'+sessionId+'\0'+path.resolve(file));
    const bytes=fs.readFileSync(file);let t=m.files[key];
    if(!t) {
      if(start>bytes.length||start&&bytes[start-1]!==10)throw new Error('invalid native transcript start boundary');
      t={source:path.resolve(file),agentId,sessionId,role,task,start,offset:start,lineStart:bytes.subarray(0,start).toString('utf8').split('\n').length,
        lines:0,archive:`trajectories/${key}.jsonl`,prefixHash:sha(bytes.subarray(0,start)),hash:sha(''),previous:Object.keys(m.files).filter(k=>m.files[k].agentId===agentId).at(-1)??null,
        previousTaskSegment:task?Object.keys(m.files).filter(k=>m.files[k].task===task&&m.files[k].role===role).at(-1)??null:null};
    }
    if(bytes.length<t.offset||sha(bytes.subarray(0,t.offset))!==t.prefixHash) {
      t.error='native transcript prefix changed; archive preserved for inspection';m.files[key]=t;atomic(manifestFile,m);throw new Error(t.error);
    }
    const end=bytes.lastIndexOf(10)+1;
    t.pendingBytes=bytes.length-end;
    if(end>t.offset) {
      const chunk=bytes.subarray(t.offset,end),lines=chunk.toString('utf8').split('\n').slice(0,-1);
      for(const line of lines) {const value=JSON.parse(line);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('native transcript line must be an object');}
      const archive=kbPath(root,t.archive);fs.mkdirSync(path.dirname(archive),{recursive:true});
      // Rebuild from verified source range, so a crash between archive and manifest writes does not duplicate lines.
      const temp=archive+'.tmp';fs.writeFileSync(temp,bytes.subarray(t.start,end),{mode:0o600});fs.renameSync(temp,archive);
      t.lines+=lines.length;t.offset=end;t.prefixHash=sha(bytes.subarray(0,end));t.hash=sha(bytes.subarray(t.start,end));
    }
    m.files[key]=t;atomic(manifestFile,m);return t;
  });
}
