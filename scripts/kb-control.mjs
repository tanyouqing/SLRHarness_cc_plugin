import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomic,json,kbPath,safe,config,enabled,runtime,locked,cacheEntry,sameScope,scopeFor,chars,fitView} from './kb-core.mjs';
import {canonicalKeys,loadState} from './pipeline.mjs';
import {stages} from './work-stages.mjs';

export function confirmStopped(root,id,confirmation) {
  if(confirmation!=='--confirmed-stopped')throw new Error('operator must confirm the native agent has stopped');
  return locked(root,'runtime',()=>{
    const s=loadState(root),work=stages(root),rt=runtime(root),a=rt.agents[id];
    if(!a)throw new Error('unknown captured Agent');
    if(Object.values(s.leases).some(l=>l.active&&l.agentId===id)||work.writers.some(w=>w.active?.agentId===id)||Object.values(work.reviews).some(r=>r.active?.agentId===id)||work.format?.active?.agentId===id)throw new Error('active pipeline assignment; use its normal stopped-task recovery first');
    a.active=false;a.stopRecovery={at:new Date().toISOString(),operatorConfirmed:true};atomic(kbPath(root,'runtime.json'),rt);return {stopped:id,next:'resume the completed investigation to trigger its normal Stop handoff'};
  });
}

export function bindScoper(root,agentId) {
  if(!/^[\w-]{1,200}$/.test(agentId??''))throw new Error('invalid Scoper ID');
  return locked(root,'runtime',()=>{
    const s=loadState(root),rt=runtime(root),a=rt.agents[agentId];
    if(!['drafting_scope','awaiting_scope_approval'].includes(s.stage)||!a||a.role!=='scoper')throw new Error('Scoper must have a host-observed initialization in this run');
    if(s.bindings[agentId])throw new Error('Agent ID already bound');
    a.bound=true;atomic(kbPath(root,'runtime.json'),rt);return {bound:true,role:'scoper'};
  });
}
export function cacheRead(root,caller,key,offset=0,limit=24000) {
  const scope=scopeFor({...caller,root}),e=cacheEntry(root,key);
  if(!sameScope(scope,e.scope)||e.method==='search_papers'&&scope.role!=='worker'||e.args.type==='paper'&&scope.role!=='worker')throw new Error('cache belongs to another task/role');
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>config(root).budgets.readChars-300)throw new Error('invalid cache slice; limit at most 23700');
  const text=JSON.stringify(e.result,null,2),all=chars(text),body=all.slice(offset,offset+limit).join('');
  return fitView({cacheKey:key,offset,text:body,nextOffset:offset+chars(body).length,totalChars:all.length},config(root).budgets.readChars);
}
export function validateImports(root,candidates,topicId,taskId) {
  const refs=[];
  for(const card of candidates)if(card.knowledgeBase) {
    if(!enabled(root))throw new Error('KB reference supplied while disabled');
    const {id,revision,cacheKey:key}=card.knowledgeBase,e=cacheEntry(root,key);
    if(e.scope.runId!==config(root).runId||e.scope.role!=='worker'||e.scope.task!==`${topicId}/${taskId}`||e.method!=='read'||e.args.type!=='paper'||e.result.id!==id||e.result.revision!==revision)throw new Error('paper import requires this task\'s full cached KB revision');
    const m=e.result.content?.metadata;
    if(!m||!e.result.content?.note)throw new Error('KB paper missing metadata/note');
    const keys=canonicalKeys(card),sourceKeys=canonicalKeys(m);
    if(!keys.some(k=>sourceKeys.includes(k)))throw new Error('KB paper identity differs from candidate');
    for(const prefix of ['doi:','arxiv:']) {
      const a=keys.find(k=>k.startsWith(prefix)),b=sourceKeys.find(k=>k.startsWith(prefix));
      if(a&&b&&a!==b)throw new Error('KB strong identifier mismatch');
    }
    refs.push({id,revision,cacheKey:key,keys});
  }
  return refs;
}
export function saveImports(root,refs,state) {
  if(!refs.length)return;
  locked(root,'imports',()=>{
    const file=kbPath(root,'imports.json'),all=fs.existsSync(file)?json(file):{};
    for(const r of refs) {
      const matches=Object.values(state.papers).filter(p=>p.keys.some(k=>r.keys.includes(k)));
      if(matches.length!==1)throw new Error('KB import has ambiguous local identity');
      const p=matches[0],records=all[p.id]??=[];
      if(!records.some(x=>x.id===r.id&&x.revision===r.revision))records.push({id:r.id,revision:r.revision,cacheKey:r.cacheKey,importedAt:new Date().toISOString()});
      all[p.id]=records;
      // Original evidence is retained as a separate source; owned notes are never overwritten.
      const e=cacheEntry(root,r.cacheKey),base=`imports/${p.id}/${r.id}-${r.revision}`;
      atomic(kbPath(root,`${base}/metadata.json`),e.result.content.metadata);
      const note=kbPath(root,`${base}/note.md`);fs.mkdirSync(path.dirname(note),{recursive:true});
      if(!fs.existsSync(note))fs.writeFileSync(note,e.result.content.note,{mode:0o600});
    }
    atomic(file,all);
  });
}
export function callerForId(root,id) {
  const state=loadState(root),rt=runtime(root),f=safe(root,'.slr/paper-bindings.json');
  const b=state.bindings[id]??(fs.existsSync(f)?json(f)[id]:null)??(rt.agents[id]?.bound?rt.agents[id]:null);
  if(!b)throw new Error('unbound Agent');return {root,state,rt,b,role:b.role,agentId:id};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,root,...args]=process.argv.slice(2);if(!path.isAbsolute(root??''))throw new Error('absolute workspace required');
    let result;
    if(action==='attach')result={enabled:enabled(root),attached:Object.keys(runtime(root).sessions).length>0};
    else if(action==='bind-scoper')result=bindScoper(root,args[0]);
    else if(action==='confirm-stopped')result=confirmStopped(root,args[0],args[1]);
    else if(action==='cache-read')result=cacheRead(root,callerForId(root,args[0]),args[1],Number(args[2]??0),Number(args[3]??23700));
    else if(action==='status')result={config:config(root),imports:fs.existsSync(kbPath(root,'imports.json'))?Object.keys(json(kbPath(root,'imports.json'))).length:0};
    else throw new Error('use attach, bind-scoper, cache-read, confirm-stopped or status');
    console.log(JSON.stringify(result));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
