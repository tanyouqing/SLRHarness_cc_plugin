import {freezeAccepted} from './kb-outbox.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadState,withLock,transition,atomicJSON,statePath,hash,nextTasks} from './pipeline.mjs';
import {bounded,safePath,page} from './bounded-output.mjs';
import {researchScale} from './research-profile.mjs';
import {validateImports,saveImports} from './kb-control.mjs';
import {warning as kbWarning,kbPath} from './kb-core.mjs';

const need=(ok,msg)=>{if(!ok)throw new Error(msg);};
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const actions=new Set(['query','plan','reserve','bind-worker','finish-discovery','finish-read','accept-paper','fail','close-task']);
export function managerRequest(root,agentId,relative) {
  const s=loadState(root),b=s.bindings[agentId];
  need(b?.role==='manager','bound Manager required');
  need(relative.startsWith(`topics/${b.topicId}/requests/`) && /^[a-zA-Z0-9_-]+\.json$/.test(path.posix.basename(relative)),'request outside Manager topic');
  const req=read(safePath(root,relative));
  need(/^[a-zA-Z0-9_-]{1,100}$/.test(req.requestId??'') && actions.has(req.action),'invalid Manager request/action');
  need(!req.args?.topicId || req.args.topicId===b.topicId,'request outside assigned topic');
  return {s,b,req};
}
// The PreToolUse guard verifies agentId against the host-supplied runtime identity.
// This is a cooperative plugin boundary, not an OS security boundary.
export function managerControl(root,agentId,relative) {
  try {return withLock(root,()=>{
    const {s,b,req}=managerRequest(root,agentId,relative),a={...(req.args??{}),topicId:b.topicId};
    need(fs.existsSync(path.join(root,'.slr/context-policy.json')),'enable context workflow from main first');
    const key=`${agentId}:${req.requestId}`,digest=hash(JSON.stringify(req));
    const prior=s.managerRequests?.[key];
    if(prior){need(prior.digest===digest,'request ID reused with changed payload');try{saveImports(root,prior.kbImports??[],s);}catch(e){kbWarning(root,'imports',e);}return prior.result;}
    need(s.stage==='researching' && s.topics.find(t=>t.id===b.topicId)?.status!=='completed','Manager topic is not active');
    let t=s.topics.find(t=>t.id===b.topicId),lease=s.leases[a.leaseId];
    if(s.revisionContext?.active)need(s.revisionContext.topicIds.includes(b.topicId),'topic outside revision');
    if(req.action==='query') {
      if(a.collection==='scale') return {ok:true,topicId:b.topicId,researchScale:researchScale(s),next:'Shared workspace target; coordinate topic allocations with main. Counts do not certify coverage.'};
      let imports={};try{const importsFile=kbPath(root,'imports.json');imports=fs.existsSync(importsFile)?read(importsFile):{};}catch(e){kbWarning(root,'import-query',e);}
      const lists={tasks:t.tasks,leases:Object.values(s.leases).filter(l=>l.topicId===b.topicId),papers:Object.values(s.papers).filter(p=>p.topicIds.includes(b.topicId)).map(p=>({...p,kbImports:imports[p.id]??[]}))};
      need(lists[a.collection],'query supports own tasks, leases or papers');
      return page(a.id?lists[a.collection].filter(x=>x.id===a.id):lists[a.collection],a,statePath(root));
    }
    if(['bind-worker','finish-discovery','finish-read','fail'].includes(req.action))need(lease?.active && lease.topicId===b.topicId,'lease outside Manager topic');
    if(['finish-discovery','finish-read','fail'].includes(req.action))need(a.stopped===true && typeof a.runtimeEvidence==='string' && a.runtimeEvidence.trim(),'confirmed stopped runtime evidence required');
    if(req.action==='plan') {
      const plan=read(safePath(root,`topics/${b.topicId}/plan.json`));
      need(plan.topicId===b.topicId,'plan topic mismatch');a.tasks=plan.tasks;
    }
    if(req.action==='reserve') {
      // Each claim follows the shared cursor and available-slot window.
      const dispatch=nextTasks(s)[0];
      if(!dispatch || dispatch.topicId!==b.topicId || a.taskId&&dispatch.taskId!==a.taskId)return {ok:true,waiting:true,requestId:req.requestId,next:'Wait for a task/slot event or the next main scheduling pass; do not busy-poll'};
      a.taskId=dispatch.taskId;a.leaseId=`mgr-${hash(key).slice(0,24)}`;
    }
    if(req.action==='finish-discovery') {
      const base=`topics/${b.topicId}/tasks/${lease.taskId}`;
      need(fs.readFileSync(safePath(root,`${base}/search.md`),'utf8').trim(),'missing search log');
      Object.assign(a,read(safePath(root,`${base}/candidates.json`)));
      // Never accept ownership/lease overrides embedded in candidate files.
      a.topicId=b.topicId;a.leaseId=lease.id;
    }
    if(req.action==='finish-read') {
      const task=t.tasks.find(x=>x.id===lease.taskId),result=read(safePath(root,`topics/${b.topicId}/tasks/${lease.taskId}/result.json`));
      for(const k of ['processedPaperIds','reusedPaperIds','remainingPaperIds','missingEvidence','supplementRequests'])need(Array.isArray(result[k]),`missing result array ${k}`);
      need(result.remainingPaperIds.length===0,'partial reading cannot complete lease');
      need([...result.processedPaperIds,...result.reusedPaperIds].every(id=>task.paperIds.includes(id)),'result contains foreign papers');
      const owned=task.paperIds.filter(id=>s.papers[id].owner.topicId===b.topicId && s.papers[id].owner.taskId===task.id);
      need(owned.every(id=>result.processedPaperIds.includes(id)),'missing owned paper delivery');
      need(result.reusedPaperIds.every(id=>!owned.includes(id)),'owned paper cannot be reused');
    }
    if(req.action==='accept-paper') {
      const p=s.papers[a.paperId];need(p?.owner.topicId===b.topicId,'paper acceptance outside owning topic');
      const acceptance=read(safePath(root,`topics/${b.topicId}/acceptance.json`));
      const item=acceptance.find(x=>x.paperId===a.paperId);need(item?.checked===true,'missing Manager evidence acceptance');
      a.checked=true;a.rationale=item.rationale;
    }
    let kbImports=[],kbImportWarning=null;
    if(req.action==='finish-discovery')try{kbImports=validateImports(root,a.candidates,b.topicId,lease.taskId);}catch(e){kbWarning(root,'import-validation',e);kbImportWarning='KB provenance unavailable or invalid; use ordinary source verification for these candidates';}
    const next=transition(s,req.action,a,root);
    for(const topic of next.topics) for(const task of topic.tasks) fs.mkdirSync(safePath(root,`topics/${topic.id}/tasks/${task.id}`),{recursive:true});
    for(const id of Object.keys(next.papers))fs.mkdirSync(safePath(root,`papers/${id}`),{recursive:true});
    const result=bounded({ok:true,requestId:req.requestId,action:req.action,topicId:b.topicId,taskId:a.taskId??lease?.taskId,leaseId:a.leaseId,paperId:a.paperId,
      researchScale:researchScale(next),
      ...(kbImportWarning?{kbImportWarning}:{}),
      ...(kbImports.length?{kbImports:kbImports.map(r=>({id:r.id,revision:r.revision,cacheKey:r.cacheKey,localId:Object.values(next.papers).find(p=>p.keys.some(k=>r.keys.includes(k)))?.id}))}:{}),
      activeWorkers:Object.values(next.leases).filter(l=>l.active).length,next:'Inspect assigned task files; return only a bounded topic summary to main'},statePath(root));
    (next.managerRequests??={})[key]={digest,result,kbImports};
    atomicJSON(statePath(root),next);
    if(req.action==='accept-paper')freezeAccepted(root,next.papers[a.paperId]);
    try{saveImports(root,kbImports,next);}catch(e){kbWarning(root,'imports',e);}
    return result;
  });} catch(e) {
    if(e.message.startsWith('control operation already active'))return {ok:true,waiting:true,next:'State lock busy; wait for the next scheduling event, do not busy-poll'};
    throw e;
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const [root,id,file]=process.argv.slice(2);need(path.isAbsolute(root??''),'absolute workspace required');console.log(JSON.stringify(managerControl(root,id,file)));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
