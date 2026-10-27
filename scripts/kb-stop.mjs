import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomic,json,sha,kbPath,config,enabled,runtime,locked,warning,safe} from './kb-core.mjs';
import {success,runOnce} from './kb-sync.mjs';
import {batchFile,snapshotSources} from './kb-boundary.mjs';

export function launchDetached(root,id,{spawnProcess=spawn}={}) {
  const log=fs.openSync(kbPath(root,`batches/${id}.log`),'a',0o600);
  try {
    // No shell interpolation, inherited pipes, resident service, or model call.
    const child=spawnProcess(process.execPath,[fileURLToPath(import.meta.url),'run',root,id],
      {cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log],env:process.env});
    child.on('error',()=>{
      try{locked(root,'auto-sync',()=>{const file=batchFile(root,id),b=json(file);atomic(file,{...b,status:'launch_failed',error:'Could not start sync process; use manual resume'});});}catch{}
      warning(root,'auto-sync','Could not start sync process; use manual resume');
    });
    child.unref();return child.pid??null;
  }finally{fs.closeSync(log);}
}

export function scheduleStop(root,input,{isSuccess=success,launch=launchDetached}={}) {
  if(input.hook_event_name!=='Stop'||input.agent_id||!enabled(root)||
    !Array.isArray(input.background_tasks)||input.background_tasks.length||
    !Array.isArray(input.session_crons)||input.session_crons.length||!isSuccess(root))return {scheduled:false};
  const rt=runtime(root);
  if(!rt.sessions[input.session_id]||path.resolve(input.transcript_path??'')!==rt.sessions[input.session_id].transcript)return {scheduled:false};
  const last=json(safe(root,'.slr/final-review.json')).submissions.at(-1);
  // Include review identity: revised reviews of the same manuscript get their own batch.
  const id=sha(config(root).runId+'\0'+last.id+'\0'+last.fingerprint),file=batchFile(root,id);
  const created=locked(root,'auto-sync',()=>{
    if(fs.existsSync(file))return false;
    const snapshot=snapshotSources(root,input);
    atomic(file,{id,runId:config(root).runId,submissionId:last.id,fingerprint:last.fingerprint,sessionId:input.session_id,
      createdAt:Date.now(),status:'scheduled',frozen:false,...snapshot});
    return true;
  });
  // Persist handoff before launching. Repeated Stops repair an interrupted handoff,
  // but never silently restart an already recorded automatic attempt.
  locked(root,'runtime',()=>{
    const fresh=runtime(root),batch=json(file);
    fresh.finishRequested={fingerprint:batch.fingerprint,submissionId:batch.submissionId,batchId:id,at:batch.createdAt};
    atomic(kbPath(root,'runtime.json'),fresh);
  });
  if(!created)return {scheduled:false,batchId:id,reason:'already_recorded; use once/resume for recovery'};
  try {
    const pid=launch(root,id);
    locked(root,'auto-sync',()=>{const b=json(file);atomic(file,{...b,pid});});
    return {scheduled:true,batchId:id};
  }catch {
    locked(root,'auto-sync',()=>{const b=json(file);atomic(file,{...b,status:'launch_failed',error:'Could not start sync process; use manual resume'});});
    warning(root,'auto-sync','Could not start sync process; use manual resume');return {scheduled:false,batchId:id};
  }
}

export async function executeBatch(root,id,{synchronize=runOnce}={}) {
  const file=batchFile(root,id);json(file);
  if(runtime(root).finishRequested?.batchId!==id)return {status:'not_ready'};
  const owned=locked(root,'auto-sync',()=>{
    const current=json(file);if(current.status!=='scheduled')return false;
    atomic(file,{...current,status:'running',pid:process.pid,startedAt:Date.now()});return true;
  });
  if(!owned)return {status:'already_started'};
  let result;
  try{result=await synchronize(root);}catch{result={status:'failed',reason:'Sync process failed; inspect local state and resume'};warning(root,'auto-sync',result.reason);}
  locked(root,'auto-sync',()=>{const current=json(file);atomic(file,{...current,status:result.status,finishedAt:Date.now()});});
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,root,id]=process.argv.slice(2);
    if(action!=='run'||!path.isAbsolute(root??''))throw new Error('internal use: run <absolute workspace> <batch ID>');
    console.log(JSON.stringify(await executeBatch(root,id)));
  }catch{console.error('Automatic KB sync could not complete; inspect local state and use once/resume');process.exitCode=1;}
}
