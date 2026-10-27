// Finite launcher: wait for Claude to exit, then synchronize only completed runs
// handed off during this invocation. It never starts a daemon or a scheduled job.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {config,runtime,warning} from './kb-core.mjs';
import {projectRoots,uploadReady,runOnce} from './kb-sync.mjs';

export function completedRuns(project) {
  const entries=new Map();
  for(const root of projectRoots(project))try {
    const finish=runtime(root).finishRequested;
    if(finish)entries.set(root,JSON.stringify({runId:config(root).runId,finish}));
  }catch(e){warning(root,'launcher',e);}
  return entries;
}
function launchClaude(project,args) {
  const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  return new Promise((resolve,reject)=>{
    const child=spawn('claude',['--plugin-dir',plugin,...args],{cwd:project,stdio:'inherit'});
    // Ctrl-C reaches both foreground processes. Let Claude decide whether the
    // session actually exits; an interrupted/nonzero exit never triggers upload.
    const interrupted=()=>{};process.on('SIGINT',interrupted);
    child.once('error',e=>{process.off('SIGINT',interrupted);reject(e);});
    child.once('exit',(code,signal)=>{process.off('SIGINT',interrupted);resolve({code:code??1,signal});});
  });
}
export async function runPipeline(project,{args=[],launch=launchClaude,synchronize=runOnce,log=()=>{}}={}) {
  if(!path.isAbsolute(project??'')||!fs.statSync(project).isDirectory())throw new Error('absolute existing project directory required');
  const before=completedRuns(project),child=await launch(project,args),sync=[];
  if(child.code!==0)return {claudeExitCode:child.code,sync,reason:'Claude did not exit normally; use manual once after verified completion'};
  for(const [root,marker] of completedRuns(project)) {
    if(before.get(root)===marker||!uploadReady(root))continue;
    try {
      log({event:'sync-start',workspace:root});
      const result=await synchronize(root,{onProgress:log});sync.push({workspace:root,...result});log({event:'sync-finished',workspace:root,status:result.status});
    }catch(e){warning(root,'one-shot-sync',e);sync.push({workspace:root,status:'failed',reason:'local sync error; research delivery preserved'});}
  }
  // The caller gets independent sync statuses; a KB error does not turn an
  // accepted manuscript into a failed Claude run.
  return {claudeExitCode:child.code,sync};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [project,...tail]=process.argv.slice(2);
    if(tail.length&&tail[0]!=='--')throw new Error('use kb-run.mjs <project> [-- <Claude arguments>]');
    const result=await runPipeline(project,{args:tail.slice(1),log:event=>console.error(JSON.stringify(event))});
    console.log(JSON.stringify(result,null,2));process.exitCode=result.claudeExitCode;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
