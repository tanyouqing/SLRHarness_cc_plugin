import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomic,json,kbPath,config,runtime,enabled} from './kb-core.mjs';

export async function saveRunSnapshot(root,{runProcess=runHelper}={}) {
  if(!enabled(root))return {status:'failed',reason:'KB disabled or database was restored'};
  const endpoint=new URL(process.env.SURVEY_KB_URL??'http://127.0.0.1:3000/mcp');
  if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))return {status:'failed',reason:'Automatic snapshots require Pipeline and KB on the same Docker host'};
  const c=config(root),finish=runtime(root).finishRequested;
  if(!finish?.batchId)return {status:'failed',reason:'Snapshot requires the normal completed-run batch'};
  const request={runId:c.runId,batchId:finish.batchId,submissionId:finish.submissionId,fingerprint:finish.fingerprint,
    topic:path.basename(root),generation:c.snapshotGeneration??0,uploadStatus:json(kbPath(root,'last-sync.json')).status};
  const file=kbPath(root,'snapshot-request.json');atomic(file,request);
  const result=await runProcess(file);
  atomic(kbPath(root,'snapshot.json'),{...result,runId:c.runId,batchId:finish.batchId,at:new Date().toISOString()});
  return result;
}
function runHelper(requestFile) {
  const helper=fileURLToPath(new URL('../knowledge-base/scripts/snapshot.py',import.meta.url));
  const workspace=path.dirname(path.dirname(path.dirname(requestFile))),pipeline=path.dirname(path.dirname(workspace));
  return new Promise(resolve=>{
    let output='',done=false;
    const child=spawn(process.env.SURVEY_KB_PYTHON??'python3',[helper,'create','--request',requestFile,'--pipeline',pipeline],
      {windowsHide:true,stdio:['ignore','pipe','pipe'],env:process.env});
    // Do not kill a dump midway and strand stopped services. The helper's durable
    // pending_save flag supports explicit recovery after a process/host crash.
    child.stdout.on('data',b=>{if(output.length<1024*1024)output+=b.toString();});
    child.stderr.on('data',()=>{});
    const finish=value=>{if(!done){done=true;resolve(value);}};
    child.on('error',()=>finish({status:'failed',reason:'Cannot launch snapshot helper; check Python and Docker configuration'}));
    child.on('close',()=>{try{finish(JSON.parse(output));}catch{finish({status:'failed',reason:'Snapshot helper returned no valid receipt; inspect snapshot status'});}});
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,root]=process.argv.slice(2);
  try {
    if(!path.isAbsolute(root??''))throw new Error('absolute workspace required');
    if(action==='status')console.log(JSON.stringify(fs.existsSync(kbPath(root,'snapshot.json'))?json(kbPath(root,'snapshot.json')):{status:'not_saved'},null,2));
    else throw new Error('use status; retry a completed run with kb-sync once/resume');
  }catch(e){console.error(e.message);process.exitCode=1;}
}
