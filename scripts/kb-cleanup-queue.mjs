import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomic,json,kbPath,locked,sha} from './kb-core.mjs';
import {items} from './kb-sync.mjs';

export function cleanQueue(root,plan,apply=false) {
  const jobs=new Set(plan.jobs.map(x=>x.id)),entities=new Set(plan.experiences.map(x=>x.id));
  const trajectories=new Set(plan.trajectories.map(x=>x.id));
  const hashes=new Set(plan.trajectories.map(x=>x.contentHash).filter(Boolean));
  const ingestionHashes=new Set((plan.ingestions??[]).filter(x=>x.kind==='experience').map(x=>x.content_hash));
  const transferIds=new Set((plan.transfers??[]).map(x=>x.id));
  // Same canonical JSON hash as the KB, including Unicode/line-ending normalization.
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(typeof v==='string'?v.normalize('NFC').replace(/\r\n/g,'\n'):v);
  const matchesContent=x=>{
    if(x.tool==='submit_experience')return ingestionHashes.has(sha(canonical(x.payload.experience)));
    if(x.tool!=='submit_trajectory')return false;
    if(x.payload.transfer)return transferIds.has(x.payload.transfer.id);
    try{return hashes.has(sha(canonical(x.payload.content.trimEnd().split('\n').map(JSON.parse))));}catch{return false;}
  };
  const matches=items(root).filter(x=>x.status!=='removed'&&(jobs.has(x.jobId)||jobs.has(x.result?.job_id)||entities.has(x.remoteId)||(x.result?.ids??[]).some(id=>entities.has(id))||
    (x.tool==='submit_trajectory'&&trajectories.has(x.remoteId))||matchesContent(x)));
  if(apply)return locked(root,'queue',()=>{
    for(const x of matches) {
      if(x.lease?.until>Date.now())throw new Error('queue still has an active request; stop sync first');
      atomic(kbPath(root,`outbox/${x.id}.json`),{...x,status:'removed',lease:null,error:null,
        removal:{reason:'已按角色规则清理',snapshotHash:plan.snapshotHash,at:new Date().toISOString()},updatedAt:Date.now()});
    }
    return matches.map(x=>x.id);
  });
  return matches.map(x=>x.id);
}
export function cleanProject(project,plan,apply=false) {
  const dir=path.join(project,'workspaces');
  return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>{
    const root=path.join(dir,e.name);return {workspace:root,removed:cleanQueue(root,plan,apply)};
  }).filter(x=>x.removed.length);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,project,file]=process.argv.slice(2);
  if(!['preview','apply'].includes(action)||!path.isAbsolute(project??'')||!file)throw new Error('use preview|apply <absolute project> <cleanup-plan.json>');
  console.log(JSON.stringify(cleanProject(project,json(file),action==='apply'),null,2));
}
