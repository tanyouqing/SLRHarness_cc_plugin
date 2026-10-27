import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {json,kbPath,config} from './kb-core.mjs';
import {items,success,connect,summary} from './kb-sync.mjs';
export async function checkRun(root,{requireComplete=false,requireReuse=false,transport}={}) {
  const c=config(root);if(!c)throw new Error('not a new KB-configured workspace');
  const queue=items(root),cacheDir=kbPath(root,'cache'),cached=fs.existsSync(cacheDir)?fs.readdirSync(cacheDir).filter(f=>f.endsWith('.json')).map(f=>json(path.join(cacheDir,f))):[];
  const checks=[];
  if(!c.enabled) {
    if(queue.length||cached.length)throw new Error('disabled run contains KB calls or submissions');
    return {status:'passed',mode:'disabled',checks:['no KB cache or upload queue'],researchSuccessful:success(root)};
  }
  if(!cached.length)throw new Error('no recorded KB retrieval; verify native MCP hooks and Agent tool access');
  for(const e of cached) {
    if(!['worker','manager','scoper','paper'].includes(e.scope.role))throw new Error('unauthorized cache role');
    if(e.method==='search_papers'&&e.scope.role!=='worker')throw new Error('non-Worker paper search');
    if(e.method==='search_strategies'&&e.args.filters?.role!==e.scope.role)throw new Error('cross-role strategy search');
  }
  checks.push('retrieval recorded with expected roles');
  const importsFile=kbPath(root,'imports.json'),imports=fs.existsSync(importsFile)?json(importsFile):{};
  if(requireReuse&&!Object.keys(imports).length)throw new Error('no KB paper imported; second investigation must demonstrate reuse');
  if(Object.keys(imports).length)checks.push('paper imports preserve KB IDs and revisions');
  if(requireComplete) {
    if(!success(root))throw new Error('research is not currently accepted and complete');
    if(!fs.existsSync(kbPath(root,'sealed.json')))throw new Error('trajectory collection not sealed; inspect capture warnings and Stop hook');
    if(!queue.length||queue.some(x=>x.status!=='succeeded'))throw new Error('synchronization unfinished; run kb-sync status');
    if(!queue.some(x=>x.tool==='submit_trajectory'))throw new Error('no native trajectory uploaded');
    const current=json(path.join(root,'.slr/final-review.json')).submissions.at(-1);
    if(queue.some(x=>x.tool==='submit_experience'&&x.source.submissionId!==current.id))throw new Error('non-final review experience uploaded');
    checks.push('current research success, final review selection, completed sync');
    let client=transport;
    try {
      client??=await connect();
      for(const entry of queue.filter(x=>x.tool==='submit_trajectory')) {
        const traceId=entry.remoteId??entry.result?.trajectory_id;
        if(!traceId)throw new Error('missing stored trajectory ID');
        await client.call('read',{type:'trajectory',id:traceId});
        for(const id of entry.result?.ids??[]) {
          const record=await client.call('read',{type:'experience',id});
          if(!record.sources?.some(s=>(s.id??s.trajectory_id)===traceId))throw new Error('distilled strategy source does not reference uploaded trajectory');
        }
      }
      checks.push('trajectory and distilled strategy sources read back (empty candidate sets allowed)');
    }finally{if(client&&!transport)await client.close();}
  }
  return {status:'passed',mode:'enabled',checks,summary:summary(root),nativeOutputAndTimeout:'verify separately in Claude Code; cache presence alone does not prove replacement'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const root=process.argv[2];if(!path.isAbsolute(root??''))throw new Error('absolute workspace required');console.log(JSON.stringify(await checkRun(root,{requireComplete:process.argv.includes('--complete'),requireReuse:process.argv.includes('--require-reuse')}),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
