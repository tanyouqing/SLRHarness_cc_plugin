import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicJSON,hash,withLock} from './pipeline.mjs';
import {paperConfig,templateFor} from './paper-config.mjs';
import {paperStatus} from './paper-build.mjs';
import {stages,writerReady,writerEvidence,writerSources,writerOutputHash} from './work-stages.mjs';
import {bounded,safePath} from './bounded-output.mjs';

const need=(v,m)=>{if(!v)throw new Error(m);};
const nonempty=v=>typeof v==='string'&&!!v.trim();
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const stageFile=root=>path.join(root,'.slr/work-stages.json');
const latest=root=>stages(root).format?.runs?.at(-1);
const fingerprint=root=>{const p=paperStatus(path.join(root,'paper'));need(p.current,'current compiled PDF required');return hash(`${p.sourceHash}:${p.pdfHash}`);};
export function formatAccess(root,agentId) {
  const s=stages(root),a=s.format?.active,r=s.format?.runs?.at(-1);
  if(a?.kind!=='check' || a.agentId!==agentId || r?.protocol!=='inline-1' || r.evidenceHash!==writerEvidence(root))return null;
  // Source changes are expected while the same Paper Agent directly fixes formatting.
  return {...a,canEdit:r.repairs<3};
}
export function formatStatus(root) {
  if(!paperConfig(root))return {status:'legacy',current:true,canReview:true};
  const r=latest(root);let current=false;
  try {current=r?.protocol==='inline-1' && !!r.result && r.result.fingerprint===fingerprint(root)
    && r.evidenceHash===writerEvidence(root) && !stages(root).format.active && !r.awaitingCompile;}
  catch{/* missing/stale inputs never pass */}
  return {status:current?r.result.status:r?.status??'not_started',current,
    canReview:current&&['passed','official_unverified'].includes(r.result.status),
    runId:r?.id,repairs:r?.repairs??0,officialVerified:current&&r.result.status==='passed'};
}
export function formatControl(root,action,args={}) {
  if(action==='status')return formatStatus(root);
  return withLock(root,()=>{
    const config=paperConfig(root);need(config,'legacy workspaces keep their existing delivery path');const template=templateFor(config);
    const all=stages(root);all.format??={runs:[],active:null};const f=all.format;
    const save=result=>{atomicJSON(stageFile(root),all);return bounded(result,stageFile(root));};
    let r=f.runs.at(-1);
    if(action==='start') {
      need(!all.writers.at(-1)?.active&&!f.active&&!Object.values(all.reviews??{}).some(r=>r.active),'another writer, reviewer or format phase is active');
      need(writerReady(root),'complete current writing stages before format check');
      need(read(path.join(root,'.slr/paper-bindings.json'))[args.agentId]?.role==='paper','bound Paper Agent required');
      need(!f.runs.some(x=>x.invocations.some(a=>a.agentId===args.agentId))&&!all.writers.some(w=>w.phases.some(p=>p.agentId===args.agentId)),'fresh format Agent ID required');
      need(!args.kind || args.kind==='check','use a single check-and-fix invocation');
      const evidenceHash=writerEvidence(root),fp=fingerprint(root);
      if(args.refreshOfficial)need(r?.status==='official_unverified'&&nonempty(args.reason),'official refresh requires explicit retry reason');
      if(args.refreshOfficial || !r || r.protocol!=='inline-1' || r.evidenceHash!==evidenceHash || (!r.awaitingCompile && r.result?.fingerprint!==fp && r.status!=='interrupted')) {
        r={id:`format-${f.runs.length+1}`,protocol:'inline-1',evidenceHash,repairs:0,status:'pending',invocations:[],result:null};f.runs.push(r);
      } else if(formatStatus(root).canReview)return {ok:true,...formatStatus(root),next:'Reviewer'};
      need(r.status!=='paused','format sequence is paused; preserve the draft and resolve the blocker');
      const a={kind:'check',agentId:args.agentId,fingerprint:fp,inputHash:writerOutputHash(root),pdfHash:paperStatus(path.join(root,'paper')).pdfHash};
      f.active=a;r.invocations.push(a);
      return save({ok:true,runId:r.id,...a,canEdit:r.repairs<3,officialURLs:template.requirementsPages,outputs:r.repairs<3?writerSources:[]});
    }
    const a=f.active;need(a?.kind==='check'&&a.agentId===args.agentId,'format assignment mismatch');
    need(args.stopped===true&&nonempty(args.runtimeEvidence),'confirm format Agent stopped');
    need(r.evidenceHash===writerEvidence(root),'format inputs changed');
    const invocation=r.invocations.find(i=>i.agentId===a.agentId),changed=writerOutputHash(root)!==a.inputHash;
    invocation.runtimeEvidence=args.runtimeEvidence;invocation.outputHash=writerOutputHash(root);invocation.completedAt=new Date().toISOString();
    if(action==='abandon') {
      need(nonempty(args.reason),'record interruption reason');invocation.interruption=args.reason.slice(0,1000);
      if(changed)all.writers.at(-1).outputHash=writerOutputHash(root);
      r.status='interrupted';r.awaitingCompile=true;r.result=null;f.active=null;
      return save({ok:true,status:r.status,next:'Preserve partial sources, compile and continue check'});
    }
    need(action==='finish','use start|finish|abandon|status');
    need(['verified','unavailable'].includes(args.officialStatus),'record only official verification availability');
    need(!args.reason || args.reason.length<=1000,'keep failure reason bounded');
    r.officialStatus=args.officialStatus;
    if(changed) {
      need(r.repairs<3,'three completed format repairs exhausted');
      need(fs.existsSync(safePath(root,writerSources[2]))&&fs.readFileSync(safePath(root,writerSources[2]),'utf8').length<=8000,'bounded writing handoff required');
      all.writers.at(-1).outputHash=writerOutputHash(root);r.repairs++;r.awaitingCompile=true;r.status='awaiting_compile';r.result=null;
      f.active=null;return save({ok:true,status:r.status,repairs:r.repairs,next:'Compile changed sources, then check the new PDF'});
    }
    need(fingerprint(root)===a.fingerprint && args.checkedPdfHash===a.pdfHash,'check the current PDF, not a previous version');
    need(args.pdfChecked===true,'actual PDF inspection required');
    need(args.clean===true || args.clean===false,'record completion or unresolved format problems');
    if(!args.clean)need(nonempty(args.reason),'record brief unresolved blocker');
    r.status=args.clean?(args.officialStatus==='verified'?'passed':'official_unverified'):'paused';
    r.awaitingCompile=false;r.result={status:r.status,fingerprint:a.fingerprint,pdfHash:a.pdfHash,reason:args.reason??null};f.active=null;
    return save({ok:true,status:r.status,repairs:r.repairs,next:args.clean?'Reviewer':'Preserve draft; resolve formatting blocker'});
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const [action,root,input]=process.argv.slice(2);need(path.isAbsolute(root??''),'absolute workspace required');console.log(JSON.stringify(formatControl(root,action,input?read(input):{})));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
