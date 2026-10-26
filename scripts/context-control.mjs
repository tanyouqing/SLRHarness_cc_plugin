import {paperConfig} from './paper-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadState,hash,atomicJSON,withLock,statePath} from './pipeline.mjs';
import {paperStatus} from './paper-build.mjs';
import {bounded,researchSummary,researchQuery,readSlice,page,safePath} from './bounded-output.mjs';
const need=(v,m)=>{if(!v)throw new Error(m);};
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
export const enabled=root=>fs.existsSync(path.join(root,'.slr/context-policy.json'));
export function recoverySummary(root) {
  const s=loadState(root),f=path.join(root,'.slr/final-review.json'),c=fs.existsSync(f)?json(f):null;
  return bounded({...researchSummary(s,'recovery',root),stateVersion:hash(fs.readFileSync(statePath(root))),scopeHash:s.approval?.scopeHash,
    finalReview:c?{status:c.status,submissionId:c.submissions?.at(-1)?.id,total:c.submissions?.at(-1)?.assessment?.total}:null,
    paperConfig:paperConfig(root),formatCheck:'node scripts/format-check.mjs status <workspace>',
    workStages:'.slr/work-stages.json',checkpoints:'.slr/checkpoints/',
    next:'Query active leases and relevant tasks. Verify live runtime status before redispatch; IDs from another session are historical, not proof of resumability.'},statePath(root));
}
export function saveRecovery(root) {
  if(!enabled(root))return null;
  const summary=recoverySummary(root);atomicJSON(path.join(root,'.slr/recovery.json'),summary);return summary;
}
// Called after authoritative state writes; immutable event files deduplicate by fingerprint.
export function checkpoint(root,kind,fingerprint,details={}) {
  if(!enabled(root))return null;
  const key=hash(`${kind}:${fingerprint}`),file=path.join(root,'.slr/checkpoints',`${key}.json`);
  const event={kind,fingerprint,at:new Date().toISOString(),...details};
  if(!fs.existsSync(file))atomicJSON(file,event);
  saveRecovery(root);return {checkpoint:file,compactHint:'Checkpoint saved. You may run /compact; this plugin does not trigger it or pause work.'};
}
export function contextControl(root,action,args={}) {
  if(action==='summary')return recoverySummary(root);
  if(action==='read')return readSlice(root,args);
  if(action==='query')return researchQuery(loadState(root),args,root);
  if(action==='bibliography') {
    const s=loadState(root),items=Object.values(s.papers).filter(p=>p.status==='final').map(p=>({id:p.id,...json(safePath(root,`papers/${p.id}/metadata.json`))}));
    return page(items,args,path.join(root,'papers'));
  }
  return withLock(root,()=>{
    const s=loadState(root);need(s.schemaVersion===2,'legacy research remains read-only');
    if(action==='enable') {
      if(enabled(root))return recoverySummary(root);
      need(!Object.values(s.leases).some(l=>l.active),'resolve active leases before enabling new scheduling');
      atomicJSON(path.join(root,'.slr/context-policy.json'),{version:1,responseChars:8000,readChars:24000,pdfPages:5});
      return saveRecovery(root);
    }
    need(enabled(root),'enable context workflow first');
    if(action==='checkpoint-scope') {
      need(s.approval?.scopeHash,'scope approval required');
      const bytes=fs.readFileSync(path.join(root,'SCOPE_ORIGINAL.md'));
      need(hash(bytes)===s.approval.scopeHash,'approved scope changed');
      const committed=execFileSync('git',['-C',root,'show','HEAD:SCOPE_ORIGINAL.md'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      need(hash(committed)===hash(bytes),'commit approved scope before checkpoint');
      return checkpoint(root,'scope',s.approval.scopeHash);
    }
    if(action==='checkpoint-paper') {
      const status=paperStatus(path.join(root,'paper'));
      need(status.current && args.sourceHash===status.sourceHash && args.pdfHash===status.pdfHash,'current compiled paper fingerprint required');
      need(args.pdfChecked===true && typeof args.inspection==='string' && args.inspection.trim(),'PDF inspection evidence required');
      return checkpoint(root,'paper',hash(`${status.sourceHash}:${status.pdfHash}`),{sourceHash:status.sourceHash,pdfHash:status.pdfHash,inspection:args.inspection});
    }
    if(action==='save')return saveRecovery(root);
    throw new Error('unknown context action');
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const [action,root,input]=process.argv.slice(2);need(path.isAbsolute(root??''),'absolute workspace required');console.log(JSON.stringify(contextControl(root,action,input?json(input):{})));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
