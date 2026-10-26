import {rubricFor} from './review-rubrics.mjs';
import {paperConfig} from './paper-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadState,atomicJSON,hash,withLock,reviewFingerprint} from './pipeline.mjs';
import {bounded,page,safePath} from './bounded-output.mjs';
import {enabled,saveRecovery} from './context-control.mjs';
const need=(v,m)=>{if(!v)throw new Error(m);};
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const file=root=>path.join(root,'.slr/work-stages.json');
export const stages=root=>fs.existsSync(file(root))?json(file(root)):{version:1,writers:[],reviews:{}};
const binding=(root,id)=>json(path.join(root,'.slr/paper-bindings.json'))[id];
const digestFiles=(root,names)=>hash(names.map(n=>`${n}\0${fs.existsSync(safePath(root,n))?hash(fs.readFileSync(safePath(root,n))):'absent'}`).join('\n'));
export const writerSources=Object.freeze(['paper/main.tex','paper/references.bib','paper/writing-handoff.md']);
export const writerOutputHash=root=>digestFiles(root,writerSources);
export function writerEvidence(root) {
  const s=loadState(root);need(['completed','completed_with_limitations'].includes(s.stage),'completed research required');
  const files=['SCOPE_ORIGINAL.md','SCOPE.md',...s.topics.flatMap(t=>[`topics/${t.id}/chapter.md`,`topics/${t.id}/synthesis.md`])];
  for(const t of s.topics)need(t.status==='completed' && t.reviewHash===reviewFingerprint(root,t.id),'stale accepted topic evidence');
  const config=paperConfig(root);
  return hash(digestFiles(root,files)+JSON.stringify(Object.values(s.papers).map(p=>[p.id,p.fingerprint]))+(config?JSON.stringify(config):''));
}
export function writerReady(root) {
  if(!enabled(root))return true;
  try {
    const w=stages(root).writers.at(-1);
    return !!w && !w.active && w.phases.every(p=>p.status==='complete') && w.evidenceHash===writerEvidence(root) && w.outputHash===writerOutputHash(root);
  } catch {return false;}
}
function snapshot(root,submissionId) {
  need(/^submission-\d+$/.test(submissionId??''),'invalid submission ID');
  const base=`paper/reviews/${submissionId}`,manifest=json(safePath(root,`${base}/manifest.json`));
  for(const [name,digest] of Object.entries(manifest.manifest))need(hash(fs.readFileSync(safePath(root,`${base}/snapshot/${name}`)))===digest,'frozen snapshot changed');
  return {base,manifest};
}
export function reviewReady(root,submissionId,reviewerId) {
  if(!enabled(root))return true;
  const {manifest}=snapshot(root,submissionId),r=stages(root).reviews[submissionId];
  return !!r && r.fingerprint===manifest.fingerprint && r.units.every(u=>u.status==='complete') && r.units.at(-1).agentId===reviewerId &&
    r.units.every(u=>fs.existsSync(safePath(root,u.artifact)) && hash(fs.readFileSync(safePath(root,u.artifact)))===u.outputHash);
}
export function stageAccess(root,role,agentId) {
  const all=stages(root);
  if(role==='paper') {
    const w=all.writers.at(-1);return !!w?.active && w.active.agentId===agentId && w.evidenceHash===writerEvidence(root);
  }
  const r=Object.values(all.reviews).find(r=>r.active?.agentId===agentId);
  if(!r)return null;
  const control=json(path.join(root,'.slr/final-review.json'));
  if(control.status!=='awaiting_review'||control.submissions.at(-1)?.id!==r.submissionId)return null;
  return r.units.find(u=>u.id===r.active.unitId)?.artifact??null;
}
export function stageControl(root,action,args={}) {
  if(action==='status') {
    const all=stages(root),w=all.writers.at(-1),r=all.reviews[args.submissionId];
    return bounded({writer:w?{generation:w.id,active:w.active,complete:w.phases.filter(p=>p.status==='complete').length,next:w.phases.find(p=>p.status!=='complete')?.id,ready:writerReady(root)}:null,
      review:r?{active:r.active,next:r.units.find(u=>u.status!=='complete')?.id,completed:r.units.filter(u=>u.status==='complete').length,total:r.units.length}:null},file(root));
  }
  if(action==='query') {
    const all=stages(root);return page(args.submissionId?all.reviews[args.submissionId]?.units??[]:all.writers.at(-1)?.phases??[],args,file(root));
  }
  return withLock(root,()=>{
    need(enabled(root),'enable context workflow first');
    const all=stages(root),s=loadState(root),save=result=>{atomicJSON(file(root),all);saveRecovery(root);return bounded(result,file(root));};
    if(action==='writer-start') {
      need(binding(root,args.agentId)?.role==='paper','bound Paper Agent required');
      const evidenceHash=writerEvidence(root);let w=all.writers.at(-1);
      need(!all.format?.active,'format check is active');
      need(!Object.values(all.reviews).some(r=>r.active),'Reviewer is active; stop it before writing');
      need(!w?.active,'another writer is active; verify stop before abandoning');
      if(!w || w.evidenceHash!==evidenceHash || args.newRevision===true) {
        if(w && w.evidenceHash===evidenceHash)need(typeof args.reason==='string'&&args.reason.trim(),'explicit manuscript revision reason required');
        const defaults=['outline',...s.topics.map(t=>`topic-${t.id}`),'introduction','background','taxonomy','comparison','challenges','conclusion','abstract','polish'];
        let selected=defaults;
        if(args.phaseIds) {
          need(w?.evidenceHash===evidenceHash && w.phases.every(p=>p.status==='complete') && args.newRevision===true,'focused repair requires complete writing with unchanged evidence');
          need(Array.isArray(args.phaseIds)&&args.phaseIds.length&&args.phaseIds.every(id=>defaults.includes(id)),'invalid focused writing phases');
          selected=[...new Set([...args.phaseIds.filter(id=>id!=='polish'),'polish'])];
        }
        w={id:`writing-${all.writers.length+1}`,evidenceHash,phases:selected.map(id=>({id,status:'pending'})),outputHash:writerOutputHash(root),active:null};
        all.writers.push(w);
      }
      need(w.outputHash===writerOutputHash(root),'sources changed outside the last writer phase; inspect before starting a revision');
      need(!all.writers.some(x=>x.phases.some(p=>p.agentId===args.agentId)),'each writer phase needs a fresh Agent ID');
      const phase=w.phases.find(p=>p.status!=='complete');need(phase,'writing already complete');
      w.active={phaseId:phase.id,agentId:args.agentId};phase.agentId=args.agentId;
      return save({ok:true,generation:w.id,phase:phase.id,agentId:args.agentId,inputHash:evidenceHash,outputs:writerSources});
    }
    if(action==='writer-finish'||action==='writer-abandon') {
      const w=all.writers.at(-1);need(w?.active?.agentId===args.agentId,'writer assignment mismatch');
      need(args.stopped===true && typeof args.runtimeEvidence==='string'&&args.runtimeEvidence.trim(),'confirm writer stopped');
      const phase=w.phases.find(p=>p.id===w.active.phaseId);
      if(action==='writer-finish') {
        need(w.evidenceHash===writerEvidence(root),'evidence changed during writing');
        for(const name of writerSources)need(fs.existsSync(safePath(root,name)),'missing writing artifact');
        const handoff=fs.readFileSync(safePath(root,writerSources[2]),'utf8');
        need(handoff.trim()&&handoff.length<=8000,'writing handoff must be nonempty and at most 8000 characters');
        need(args.phase===phase.id && args.inputHash===w.evidenceHash,'phase/evidence mismatch');
        phase.status='complete';phase.outputHash=writerOutputHash(root);
      } else {
        need(typeof args.reason==='string'&&args.reason.trim(),'abandon reason required');
        (phase.interruptions??=[]).push({agentId:args.agentId,reason:args.reason});
      }
      // Partial source files are retained and become the explicit next phase baseline.
      w.outputHash=writerOutputHash(root);w.active=null;return save({ok:true,phase:phase.id,status:phase.status});
    }
    if(action==='review-start') {
      need(!all.format?.active && !all.writers.at(-1)?.active,'writing/format phase is active');
      const {base,manifest}=snapshot(root,args.submissionId),b=binding(root,args.agentId);
      need(b?.role==='reviewer'&&b.submissionId===args.submissionId,'bound Reviewer required');
      const control=json(path.join(root,'.slr/final-review.json'));need(control.status==='awaiting_review'&&control.submissions.at(-1)?.id===args.submissionId,'pending current submission required');
      const rubricVersion=control.submissions.at(-1).rubricVersion,rubric=rubricFor(rubricVersion);
      let r=all.reviews[args.submissionId];
      if(!r) {
        const units=[];
        for(const name of ['SCOPE.md','paper/main.tex','paper/references.bib']) {
          const text=fs.readFileSync(safePath(root,`${base}/snapshot/${name}`),'utf8');
          for(let offset=0;offset<text.length;offset+=24000)units.push({id:name==='SCOPE.md'?`scope-${units.length+1}`:`part-${units.length+1}`,file:`${base}/snapshot/${name}`,offset,limit:Math.min(24000,text.length-offset)});
        }
        units.push({id:'reference-comparison'},{id:'pdf-layout'},{id:'score'});
        r={submissionId:args.submissionId,fingerprint:manifest.fingerprint,active:null,units:units.map(u=>({...u,status:'pending',artifact:`${base}/drafts/${u.id}.json`}))};all.reviews[args.submissionId]=r;
      }
      need(r.fingerprint===manifest.fingerprint && !r.active,'stale review or another review unit active');
      need(!r.units.some(u=>u.agentId===args.agentId),'each review unit needs a fresh Agent ID');
      const unit=r.units.find(u=>u.status!=='complete');need(unit,'review units already complete');
      unit.agentId=args.agentId;r.active={unitId:unit.id,agentId:args.agentId};
      return save({ok:true,fingerprint:r.fingerprint,...unit,inputPolicy:rubric.inputPolicy,rubricVersion,rubricPath:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..',rubric.path),scopePath:`${base}/snapshot/SCOPE.md`,manuscript:[`${base}/snapshot/paper/main.tex`,`${base}/snapshot/paper/references.bib`,`${base}/snapshot/paper/main.pdf`],references:`${base}/references`,priorIssues:`${base}/prior-issues.json`});
    }
    if(action==='review-finish'||action==='review-abandon') {
      const r=all.reviews[args.submissionId];need(r?.active?.agentId===args.agentId,'review unit assignment mismatch');
      need(args.stopped===true && typeof args.runtimeEvidence==='string'&&args.runtimeEvidence.trim(),'confirm Reviewer stopped');
      const {manifest}=snapshot(root,args.submissionId);need(manifest.fingerprint===r.fingerprint,'stale review input');
      const unit=r.units.find(u=>u.id===r.active.unitId);
      if(action==='review-finish') {
        const report=json(safePath(root,unit.artifact));
        need(report.fingerprint===r.fingerprint && report.unitId===unit.id,'review artifact fingerprint/unit mismatch');
        if(unit.id!=='score') {
          need(Array.isArray(report.locations)&&report.locations.length && typeof report.findings==='string'&&report.findings.trim(),'review requires locations and findings');
          need(JSON.stringify(report).length<=8000,'review unit findings exceed 8000 characters; split the unit');
        }
        else need(report.submissionId===r.submissionId && report.reviewerId===args.agentId && report.report,'score envelope missing');
        unit.outputHash=hash(fs.readFileSync(safePath(root,unit.artifact)));unit.status='complete';
      } else {need(args.reason?.trim(),'abandon reason required');(unit.interruptions??=[]).push({agentId:args.agentId,reason:args.reason});}
      r.active=null;return save({ok:true,unit:unit.id,status:unit.status});
    }
    if(action==='review-split') {
      const r=all.reviews[args.submissionId];need(r&&!r.active,'finish or abandon active review unit first');
      const index=r.units.findIndex(u=>u.id===args.unitId),unit=r.units[index];
      need(unit?.status==='pending' && /^(reference-comparison|pdf-layout)/.test(unit.id),'only pending reference/layout units may be split');
      need(Array.isArray(args.parts)&&args.parts.length>=2&&args.parts.length<=50&&args.parts.every(x=>typeof x==='string'&&x.trim()&&x.length<=1000),'provide 2–50 bounded coverage instructions');
      r.units.splice(index,1,...args.parts.map((instruction,i)=>({...unit,id:`${unit.id}-${i+1}`,instruction,agentId:null,
        artifact:`paper/reviews/${r.submissionId}/drafts/${unit.id}-${i+1}.json`})));
      return save({ok:true,split:unit.id,parts:args.parts.length});
    }
    throw new Error('unknown work-stage action');
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const [action,root,input]=process.argv.slice(2);need(path.isAbsolute(root??''),'absolute workspace required');console.log(JSON.stringify(stageControl(root,action,input?json(input):{})));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
