// Optional launcher. Stop hooks own synchronization; exiting must not retry it.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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
export async function runPipeline(project,{args=[],launch=launchClaude}={}) {
  if(!path.isAbsolute(project??'')||!fs.statSync(project).isDirectory())throw new Error('absolute existing project directory required');
  const child=await launch(project,args);
  return {claudeExitCode:child.code,sync:[],reason:'Stop hook owns synchronization; no exit-time upload'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [project,...tail]=process.argv.slice(2);
    if(tail.length&&tail[0]!=='--')throw new Error('use kb-run.mjs <project> [-- <Claude arguments>]');
    const result=await runPipeline(project,{args:tail.slice(1),log:event=>console.error(JSON.stringify(event))});
    console.log(JSON.stringify(result,null,2));process.exitCode=result.claudeExitCode;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
