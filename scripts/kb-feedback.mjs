import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorize,atomic,json,kbPath,sha,locked,enabled,decodeResult} from './kb-core.mjs';
const file=(root,key)=>kbPath(root,`feedback/${key}.json`);
export function stageFeedback(input) {
  const a=authorize(input);if(a.method!=='report_strategy_feedback')return null;
  return locked(a.root,'feedback',()=>{
    const f=file(a.root,a.key);
    if(!fs.existsSync(f))atomic(f,{key:a.key,payload:a.args,status:'pending',createdAt:new Date().toISOString(),attempts:0});
    return {root:a.root,key:a.key};
  });
}
export function recordFeedback(input) {
  const a=authorize(input),r=decodeResult(input.tool_response);
  if(!['accepted','duplicate'].includes(r.status)||typeof r.feedback_id!=='string'||typeof r.job_id!=='string')throw new Error('invalid feedback receipt');
  stageFeedback(input);
  locked(a.root,'feedback',()=>{const f=file(a.root,a.key),x=json(f);atomic(f,{...x,status:'accepted',feedbackId:r.feedback_id,jobId:r.job_id,error:null});});
  return {...r,message:'Feedback received for management review; no state change is confirmed.'};
}
export function feedbackItems(root) {
  const dir=kbPath(root,'feedback');return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>json(path.join(dir,n))):[];
}
export async function recoverFeedback(root,{transport,now=Date.now}={}) {
  if(!enabled(root))return {disabled:true};
  let client=transport;
  try {
    for(const item of feedbackItems(root)) {
      if(item.status==='succeeded')continue;
      const lease=sha(`${now()}:${Math.random()}`);
      const claimed=locked(root,'feedback',()=>{
        const x=json(file(root,item.key));if(x.lease?.until>now())return null;
        if(x.status==='succeeded')return null;
        x.lease={id:lease,until:now()+60000};atomic(file(root,x.key),x);return x;
      });
      if(!claimed)continue;
      let change;
      try {
        client??=await (await import('./kb-transport.mjs')).connect();
        const r=await client.call(claimed.jobId?'get_job':'report_strategy_feedback',claimed.jobId?{job_id:claimed.jobId}:claimed.payload);
        if(claimed.jobId)change={status:r.status==='succeeded'?'succeeded':r.status==='failed'?'server_failed':'accepted',result:r};
        else {
          if(!r.job_id||!r.feedback_id)throw new Error('invalid feedback receipt');
          change={status:'accepted',jobId:r.job_id,feedbackId:r.feedback_id};
        }
      }catch{change={error:'Feedback delivery/check failed; frozen input retained for explicit resume',attempts:(claimed.attempts??0)+1};}
      locked(root,'feedback',()=>{
        const x=json(file(root,item.key));if(x.lease?.id!==lease)return;
        // A concurrent host receipt wins over a failed recovery response.
        if(!claimed.jobId&&x.jobId&&!change.jobId)delete change.status;
        atomic(file(root,item.key),{...x,...change,lease:null});
      });
    }
    return {items:feedbackItems(root).map(x=>({key:x.key,status:x.status,feedbackId:x.feedbackId,jobId:x.jobId,error:x.error,result:x.result}))};
  }finally{if(client&&!transport)await client.close().catch(()=>{});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,root]=process.argv.slice(2);
  try {
    if(!path.isAbsolute(root??''))throw new Error('absolute workspace required');
    if(!['status','resume'].includes(action))throw new Error('use status or resume');
    console.log(JSON.stringify(action==='resume'?await recoverFeedback(root):{items:feedbackItems(root).map(x=>({key:x.key,status:x.status,feedbackId:x.feedbackId,jobId:x.jobId,error:x.error,result:x.result}))},null,2));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
