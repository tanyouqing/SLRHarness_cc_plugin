import fs from 'node:fs';
import {atomic,json,sha,safe,kbPath,enabled,locked,warning} from './kb-core.mjs';
import {paperFingerprint} from './pipeline.mjs';

export function enqueue(root,tool,payload,source) {
  if(!enabled(root))return null;
  const serialized=JSON.stringify(payload);
  if(Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:payload}}))>16*1024*1024)throw new Error('KB request exceeds 16 MiB; original retained locally');
  const id=sha(tool+'\0'+serialized),file=kbPath(root,`outbox/${id}.json`);
  if(fs.existsSync(file))return id;
  atomic(file,{id,tool,payload,source,status:'pending',attempts:0,nextAt:0,createdAt:Date.now(),jobId:null,result:null});return id;
}
export function paperPayload(root,p) {
  const before=paperFingerprint(root,p.id);
  if(p.status!=='final'||p.fingerprint!==before)throw new Error('paper acceptance fingerprint changed');
  const metadata=json(safe(root,`papers/${p.id}/metadata.json`)),note=fs.readFileSync(safe(root,`papers/${p.id}/note.md`),'utf8');
  const out=Object.fromEntries(['title','authors','year','canonicalUrl','doi','arxivId','venue'].map(k=>[k,metadata[k]??(k==='authors'?[]:null)]));
  if(!out.title?.trim()||!note.trim()||paperFingerprint(root,p.id)!==before)throw new Error('paper changed during KB snapshot');
  return {metadata:out,note};
}
export function freezeAccepted(root,paper) {
  if(!enabled(root))return;
  try {return locked(root,'queue',()=>enqueue(root,'submit_paper',paperPayload(root,paper),{kind:'paper',localId:paper.id,fingerprint:paper.fingerprint}));}
  catch(e){warning(root,'paper:'+paper?.id,e);}
}
