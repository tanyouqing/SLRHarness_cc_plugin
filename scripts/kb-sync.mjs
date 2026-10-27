import {enqueue,paperPayload} from './kb-outbox.mjs';
export {enqueue,paperPayload} from './kb-outbox.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {atomic,json,sha,safe,kbPath,enabled,config,locked,warning,runtime,normalizeExperience} from './kb-core.mjs';
import {loadState} from './pipeline.mjs';
import {finalReviewStatus} from './final-review.mjs';
import {stages,writerReady} from './work-stages.mjs';
import {saveImports} from './kb-control.mjs';
import {capture,locateNative} from './kb-trajectory.mjs';

export function success(root) {
  const s=loadState(root),work=stages(root),rt=runtime(root);
  if(!['completed','completed_with_limitations'].includes(s.stage)||s.roundOpen||s.revisionContext?.active||Object.values(s.leases).some(l=>l.active))return false;
  if(work.writers.some(w=>w.active)||Object.values(work.reviews).some(r=>r.active)||work.format?.active)return false;
  if(Object.values(rt.agents).some(a=>a.active)||!writerReady(root))return false;
  return finalReviewStatus(root).complete===true;
}
export function uploadReady(root) {
  try {
    if(!enabled(root)||!success(root))return false;
    const last=json(safe(root,'.slr/final-review.json')).submissions.at(-1);
    return runtime(root).finishRequested?.fingerprint===last?.fingerprint;
  }catch{return false;}
}
export function reconcile(root,{isSuccess=success}={}) {
  if(!enabled(root))return {disabled:true};
  return locked(root,'queue',()=>{
    const rt=runtime(root);
    if(!rt.finishRequested||!isSuccess(root))return {notReady:true,warnings:[]};
    const control=json(safe(root,'.slr/final-review.json')),last=control.submissions.at(-1);
    if(rt.finishRequested.fingerprint!==last.fingerprint)return {staleFinish:true,warnings:[]};
    const s=loadState(root),warnings=[];
    for(const receipt of Object.values(s.managerRequests??{}))try{saveImports(root,receipt.kbImports??[],s);}catch(e){warning(root,'imports',e);}
    for(const p of Object.values(s.papers))if(p.status==='final')try {
      enqueue(root,'submit_paper',paperPayload(root,p),{kind:'paper',localId:p.id,fingerprint:p.fingerprint});
    }catch(e){warning(root,`paper:${p.id}`,e);warnings.push(p.id);}
    // Capture and seal only after the complete investigation has succeeded.
    if(!fs.existsSync(kbPath(root,'sealed.json'))) {
      for(const [id,a] of Object.entries(rt.agents))try {
        const file=a.transcript??locateNative(rt,a.sessionId,id);
        if(!file)throw new Error('native child transcript missing; synchronization incomplete');
        capture(root,{file,agentId:id,sessionId:a.sessionId,role:a.role,task:a.task??null});
      }catch(e){warning(root,`capture:${id}`,e);warnings.push(id);}
      for(const [id,a] of Object.entries(rt.sessions))try{for(const segment of [...(a.segments??[]),a])capture(root,{file:segment.transcript,agentId:'main',sessionId:id,role:'main',start:segment.start});}
      catch(e){warning(root,`capture:${id}`,e);warnings.push(id);}
    }
    try {
      const raw=json(safe(root,`paper/reviews/${last.id}/experiences.json`));
      if(JSON.stringify(raw.experiences)!==JSON.stringify(last.assessment.experiences))throw new Error('final experiences differ from immutable assessment');
      raw.experiences.map(normalizeExperience).forEach((e,i)=>enqueue(root,'submit_experience',{experience:e},{kind:'review',submissionId:last.id,index:i,fingerprint:last.fingerprint}));
    }catch(e){warning(root,'final-experiences',e);warnings.push('final-experiences');}
    const manifestFile=kbPath(root,'trajectories.json'),manifest=fs.existsSync(manifestFile)?json(manifestFile):{files:{}};
    for(const [key,t] of Object.entries(manifest.files))try {
      if(t.error||t.pendingBytes)throw new Error(t.error??'trajectory has an incomplete final line; original retained');
      const content=fs.readFileSync(kbPath(root,t.archive),'utf8');
      if(!content.trim())continue;
      if(sha(content)!==t.hash)throw new Error('trajectory archive hash changed');
      enqueue(root,'submit_trajectory',{content},{kind:'trajectory',archive:t.archive,trajectoryKey:key,hash:t.hash});
    }catch(e){warning(root,`trajectory:${key}`,e);warnings.push(key);}
    if(!warnings.length)atomic(kbPath(root,'sealed.json'),{fingerprint:last.fingerprint,at:Date.now()});
    return {sealed:!warnings.length,warnings};
  });
}
export function items(root) {
  const dir=kbPath(root,'outbox');return fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>json(path.join(dir,f))):[];
}
export function claim(root,now=Date.now()) {
  if(!enabled(root))return null;
  return locked(root,'queue',()=>{
    const all=items(root);
    // One in-flight request per workspace, even with concurrent one-shot processes.
    if(all.some(x=>x.lease&&x.lease.until>now))return null;
    const item=all.filter(x=>['pending','retry','tracking'].includes(x.status)&&x.nextAt<=now&&(!x.lease||x.lease.until<=now)).sort((a,b)=>a.nextAt-b.nextAt||a.createdAt-b.createdAt)[0];
    if(!item)return null;
    if(item.lease&&item.lease.until<=now) {
      item.attempts++;
      if(item.attempts>=3){Object.assign(item,{status:'failed',lease:null,error:'Three interrupted requests; inspect service and resume explicitly'});atomic(kbPath(root,`outbox/${item.id}.json`),item);return null;}
    }
    if(item.status==='tracking'&&item.trackUntil<=now){item.status='waiting';atomic(kbPath(root,`outbox/${item.id}.json`),item);return null;}
    item.totalAttempts=(item.totalAttempts??0)+1;
    item.lease={token:randomUUID(),until:now+120000};atomic(kbPath(root,`outbox/${item.id}.json`),item);return item;
  });
}
function persistClaim(root,item,change) {
  return locked(root,'queue',()=>{
    const file=kbPath(root,`outbox/${item.id}.json`),current=json(file);
    if(current.lease?.token!==item.lease.token)throw new Error('KB queue lease changed');
    const next={...current,...change,lease:null,updatedAt:Date.now()};atomic(file,next);return next;
  });
}
export async function connect() {
  const token=process.env.SURVEY_KB_TOKEN;
  if(!token)throw Object.assign(new Error('SURVEY_KB_TOKEN is missing'),{permanent:true});
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client=new Client({name:'survey-pipeline-sync',version:'0.9.1'});
  const transport=new StreamableHTTPClientTransport(new URL(process.env.SURVEY_KB_URL??'http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
  let timer;
  try {await Promise.race([client.connect(transport),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('KB connection timed out')),20000);})]);}
  catch(e){await client.close().catch(()=>{});throw e;}finally{clearTimeout(timer);}
  return {async call(name,args){
    const result=await client.callTool({name,arguments:args},undefined,{timeout:20000,resetTimeoutOnProgress:false});
    if(result.isError) {
      const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')??'';
      throw Object.assign(new Error('KB tool rejected request; inspect service and input'),{permanent:/Invalid input|Unrecognized key|Too big|Too small|invalid JSON|line \d|event range|source .*required/i.test(text)});
    }
    return result.structuredContent??JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
  },close:()=>client.close()};
}
export async function processOne(root,{transport,now=Date.now(),isReady=uploadReady}={}) {
  if(!enabled(root)||!isReady(root))return null;
  const item=claim(root,now);if(!item)return null;
  let client=transport;
  try {
    client??=await connect();
    if(!isReady(root))return persistClaim(root,item,{error:'Investigation is no longer ready; upload deferred'});
    const value=await client.call(item.jobId?'get_job':item.tool,item.jobId?{job_id:item.jobId}:item.payload);
    let change;
    if(item.jobId) {
      if(value.status==='succeeded')change={status:'succeeded',result:value.result,error:null};
      else if(value.status==='failed')change={status:'failed',error:'KB background job failed; repair dependency and retry original job with KB admin',result:value};
      else if(['queued','running'].includes(value.status))change={status:'tracking',nextAt:now+15000,error:null,attempts:0};
      else throw new Error('invalid KB job response');
    } else {
      if(!['stored','pending','duplicate'].includes(value.status))throw new Error('invalid KB submission response');
      if(value.job_id)change={status:'tracking',jobId:value.job_id,remoteId:value.id??null,result:value,trackUntil:now+1800000,nextAt:now+15000,error:null,attempts:0};
      else if(value.id)change={status:'succeeded',remoteId:value.id,result:value,error:null};
      else throw new Error('KB submission has no entity or job ID');
    }
    return persistClaim(root,item,change);
  } catch(e) {
    const attempt=item.attempts+1,permanent=e.permanent||[400,401,403,413,422,-32602].includes(e.code??e.status??e.statusCode);
    return persistClaim(root,item,{attempts:attempt,status:permanent||attempt>=3?'failed':item.jobId?'tracking':'retry',
      nextAt:now+(attempt===1?2000:5000),error:permanent?'KB configuration/input rejected; inspect credentials, service and payload':'KB connection or response failed; frozen payload retained'});
  } finally {if(client&&!transport)await client.close().catch(()=>{});}
}
export function resume(root) {
  if(!enabled(root))return {disabled:true};
  return locked(root,'queue',()=>{let count=0;
    for(const x of items(root))if(['failed','waiting'].includes(x.status)) {
      // A server failure resumes polling its job; it never resubmits the payload.
      Object.assign(x,{status:x.jobId?'tracking':'pending',attempts:0,nextAt:0,trackUntil:Date.now()+1800000,lease:null});
      atomic(kbPath(root,`outbox/${x.id}.json`),x);count++;
    }return {resumed:count};
  });
}
export function summary(root) {
  const counts={};for(const x of items(root))counts[x.status]=(counts[x.status]??0)+1;
  const file=kbPath(root,'last-sync.json'),last=fs.existsSync(file)?json(file):null;
  return {enabled:enabled(root),readyForUpload:uploadReady(root),counts,records:'.slr/kb/outbox/',warningsPath:'.slr/kb/warnings/',
    lastRun:last?{status:last.status,reason:last.reason,finishedAt:last.finishedAt}:null};
}
export function projectRoots(project) {
  const dir=safe(project,'workspaces');return fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>path.join(dir,e.name)).filter(enabled):[];
}
// One finite batch: drain all due submissions, honor retry/poll delays, then exit.
export async function runOnce(root,{transport,retryFailed=false,maxWaitMs=1800000,clock=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),signal,onProgress=()=>{},isReady=uploadReady,prepare=reconcile}={}) {
  if(!Number.isFinite(maxWaitMs)||maxWaitMs<1)throw new Error('positive finite max wait required');
  if(!enabled(root))return {status:'disabled',...summary(root)};
  if(!isReady(root))return {status:'not_ready',reason:'current successful final review and normal Stop handoff required',...summary(root)};
  const startedAt=clock(),deadline=startedAt+maxWaitMs;
  const prepared=prepare(root);
  if(prepared.notReady||prepared.staleFinish)return {status:'not_ready',...summary(root)};
  // A new invocation can follow a job whose prior polling window expired. Failed
  // submissions/jobs require the explicit resume command; successful items stay intact.
  if(retryFailed)resume(root);
  else locked(root,'queue',()=>{
    for(const x of items(root))if(x.status==='waiting'||x.status==='tracking'&&x.trackUntil<=startedAt&&(!x.lease||x.lease.until<=startedAt)) {
      Object.assign(x,{status:x.jobId?'tracking':'pending',nextAt:0,trackUntil:startedAt+1800000,lease:null});
      atomic(kbPath(root,`outbox/${x.id}.json`),x);
    }
  });
  let reason=null;
  while(true) {
    if(signal?.aborted){reason='interrupted';break;}
    if(!isReady(root)){reason='not_ready';break;}
    const pending=items(root).filter(x=>['pending','retry','tracking'].includes(x.status));
    if(!pending.length)break;
    if(clock()>=deadline){reason='time_limit';break;}
    const result=await processOne(root,{transport,now:clock(),isReady});
    if(result)onProgress({id:result.id,status:result.status,jobId:result.jobId});
    else {
      const now=clock(),next=items(root).filter(x=>['pending','retry','tracking'].includes(x.status));
      if(!next.length)continue;
      const active=next.find(x=>x.lease?.until>now);
      const wake=active?active.lease.until:Math.min(...next.map(x=>x.nextAt));
      await sleep(Math.min(15000,Math.max(1,wake-now),Math.max(1,deadline-now)));
    }
  }
  const state=summary(root),all=items(root),warnings=prepared.warnings??[];
  const status=reason==='not_ready'?'not_ready':reason?'pending':all.some(x=>x.status==='failed')?'failed':
    all.some(x=>x.status!=='succeeded')?'pending':warnings.length?'incomplete':'complete';
  const result={status,reason,warnings,startedAt,finishedAt:clock(),...state};
  atomic(kbPath(root,'last-sync.json'),result);return result;
}
export function parseSyncArgs(argv) {
  const [action,directory,...extra]=argv;
  if(!['status','once','resume'].includes(action))throw new Error('use status, once or resume <workspace>; watch was removed (no resident service)');
  if(!path.isAbsolute(directory??''))throw new Error('absolute workspace required');
  let maxWaitMs=1800000;
  if(extra.length) {
    if(action==='status'||extra.length!==2||extra[0]!=='--max-wait-seconds'||!/^\d+$/.test(extra[1])||Number(extra[1])<1||Number(extra[1])>86400)throw new Error('use --max-wait-seconds 1..86400');
    maxWaitMs=Number(extra[1])*1000;
  }
  return {action,directory,maxWaitMs};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const {action,directory,maxWaitMs}=parseSyncArgs(process.argv.slice(2));
    if(action==='status')console.log(JSON.stringify(summary(directory),null,2));
    else {
      const controller=new AbortController();for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>controller.abort());
      const result=await runOnce(directory,{retryFailed:action==='resume',maxWaitMs,signal:controller.signal,
        onProgress:event=>console.error(JSON.stringify(event))});
      console.log(JSON.stringify(result,null,2));
      if(!['complete','disabled'].includes(result.status))process.exitCode=2;
    }
  }catch(e){console.error(e.message);process.exitCode=1;}
}
