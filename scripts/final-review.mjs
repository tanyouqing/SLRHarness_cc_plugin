import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadState, statePath, atomicJSON, hash, withLock, openRevisionState, reviewFingerprint, paperFingerprint} from './pipeline.mjs';
import {paperStatus} from './paper-build.mjs';

export const RUBRIC_VERSION='survey-1';
export const RUBRIC={
  coverage:['scope','research-lines','search-transparency'],
  taxonomy:['basis','boundaries','alignment'],
  evidence:['identity','claim-support','numbers-conditions','attribution','epistemic-status'],
  synthesis:['question-driven','method-relations','comparability','cross-topic'],
  critique:['limitations','conflicts-gaps','directions'],
  presentation:['clarity','layout']
};
export const ITEM_IDS=Object.entries(RUBRIC).flatMap(([group,items])=>items.map(id=>`${group}.${id}`));
const terminal=s=>['completed','completed_with_limitations'].includes(s.stage);
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const nonempty=v=>typeof v==='string' && !!v.trim();
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const controlPath=root=>path.join(root,'.slr/final-review.json');
const reportDir=(root,id)=>path.join(root,'paper/reviews',id);
const now=()=>new Date().toISOString();
function readControl(root) {
  return fs.existsSync(controlPath(root))?json(controlPath(root)):{schemaVersion:1,rubricVersion:RUBRIC_VERSION,status:'not_started',submissions:[],revisions:[],batchStart:0,pause:null};
}
const latest=c=>c.submissions.at(-1);
const activeRevision=c=>c.revisions.find(r=>r.id===c.activeRevisionId);

function addFile(root,files,relative,optional=false) {
  const file=path.join(root,relative);
  if(optional && !fs.existsSync(file))return;
  let p=file;
  while(p!==root) { requireValue(!fs.lstatSync(p).isSymbolicLink(),'snapshot refuses symbolic links'); p=path.dirname(p); }
  requireValue(fs.statSync(file).isFile(),'snapshot input must be a file');
  files[relative]=fs.readFileSync(file);
}
function addTree(root,files,relative) {
  const dir=path.join(root,relative); if(!fs.existsSync(dir))return;
  requireValue(!fs.lstatSync(dir).isSymbolicLink(),'snapshot refuses symbolic links');
  for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
    requireValue(!e.isSymbolicLink(),'snapshot refuses symbolic links');
    const child=`${relative}/${e.name}`;
    if(e.isDirectory())addTree(root,files,child);
    else if(/\.(md|json)$/.test(e.name))addFile(root,files,child);
  }
}
function copyFrozenTree(source,target,top=true) {
  fs.mkdirSync(target,{recursive:true});
  for(const e of fs.readdirSync(source,{withFileTypes:true})) {
    if(top && ['assessment.json','assessment.md','comparison.md','scoper.md','manager.md','worker.md'].includes(e.name))continue;
    requireValue(!e.isSymbolicLink(),'snapshot refuses symbolic links');
    const from=path.join(source,e.name),to=path.join(target,e.name);
    if(e.isDirectory())copyFrozenTree(from,to,false);
    else if(fs.existsSync(to))requireValue(hash(fs.readFileSync(from))===hash(fs.readFileSync(to)),'interrupted comparison snapshot differs');
    else fs.copyFileSync(from,to);
  }
}
function verifySnapshot(root,sub) {
  const dir=reportDir(root,sub.id),saved=json(path.join(dir,'manifest.json'));
  requireValue(saved.fingerprint===sub.fingerprint && hash(JSON.stringify({rubricVersion:RUBRIC_VERSION,manifest:saved.manifest}))===sub.fingerprint,'snapshot manifest changed');
  for(const [name,digest] of Object.entries(saved.manifest)) {
    requireValue(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'),'invalid snapshot path');
    requireValue(hash(fs.readFileSync(path.join(dir,'snapshot',name)))===digest,'frozen snapshot changed');
  }
}
export function reviewInputs(root) {
  const s=loadState(root);
  requireValue(s.schemaVersion===2 && terminal(s),'final review requires completed v2 research');
  requireValue(paperStatus(path.join(root,'paper')).current,'current compiled PDF required');
  for(const t of s.topics)requireValue(t.status==='completed' && t.reviewHash===reviewFingerprint(root,t.id),'chapter evidence acceptance is stale');
  for(const p of Object.values(s.papers))requireValue(p.status==='final' && p.fingerprint===paperFingerprint(root,p.id),'paper evidence acceptance is stale');
  const files={};
  for(const f of ['SCOPE_ORIGINAL.md','SCOPE.md','paper/main.tex','paper/references.bib','paper/neurips_2026.sty','paper/main.pdf'])addFile(root,files,f);
  for(const f of ['scoping.md','REPORT.md'])addFile(root,files,f,true);
  for(const dir of ['scope','topics','papers'])addTree(root,files,dir);
  // Runtime IDs and review counters do not change scientific inputs.
  files['registry.json']=Buffer.from(JSON.stringify({scope:s.approval,topics:s.topics.map(t=>({id:t.id,title:t.title,boundary:t.boundary,tasks:t.tasks.map(x=>({id:x.id,question:x.question,boundary:x.boundary,paperIds:x.paperIds}))})),papers:s.papers}));
  const manifest=Object.fromEntries(Object.keys(files).sort().map(f=>[f,hash(files[f])]));
  const evidenceHash=hash(JSON.stringify(Object.entries(manifest).filter(([f])=>!f.startsWith('paper/'))));
  return {files,manifest,evidenceHash,fingerprint:hash(JSON.stringify({rubricVersion:RUBRIC_VERSION,manifest}))};
}

export function validateAssessment(report,topicIds=[]) {
  requireValue(report?.rubricVersion===RUBRIC_VERSION,'rubric version mismatch');
  requireValue(Array.isArray(report.items) && report.items.length===20,'exactly twenty rubric items required');
  requireValue(new Set(report.items.map(i=>i.id)).size===20,'duplicate rubric item');
  for(const i of report.items)requireValue(ITEM_IDS.includes(i.id) && Number.isInteger(i.score) && i.score>=0 && i.score<=5
    && nonempty(i.location) && nonempty(i.evidence) && nonempty(i.reason),'invalid rubric item or missing scoring evidence');
  const total=report.items.reduce((n,i)=>n+i.score,0);
  requireValue(report.total===total && report.passed===(total>=70),'incorrect total or threshold verdict');
  const comparison=report.comparison;
  requireValue(comparison && ['complete','unavailable'].includes(comparison.status) && nonempty(comparison.searchLog)
    && nonempty(comparison.alignment) && Array.isArray(comparison.references) && Array.isArray(comparison.differences),'invalid comparison');
  const references=new Map();
  for(const ref of comparison.references) {
    requireValue(nonempty(ref.id) && !references.has(ref.id) && nonempty(ref.title) && Array.isArray(ref.authors) && ref.authors.length
      && ref.authors.every(nonempty) && Number.isInteger(ref.year) && /^https?:\/\//.test(ref.url??'')
      && nonempty(ref.version) && ['fulltext_read','unavailable'].includes(ref.fulltext)
      && ['same','overlapping','adjacent'].includes(ref.match) && nonempty(ref.reason) && nonempty(ref.verification),'invalid comparison reference');
    references.set(ref.id,ref);
  }
  if(comparison.status==='complete')requireValue([...references.values()].some(r=>r.fulltext==='fulltext_read'),'comparison requires at least one fulltext reference');
  else requireValue(nonempty(comparison.unavailableReason),'unavailable comparison requires explanation');
  const differences=new Map();
  for(const d of comparison.differences) {
    const ref=references.get(d.referenceId);
    requireValue(nonempty(d.id) && !differences.has(d.id) && ref?.fulltext==='fulltext_read'
      && ['gap','reasonable_difference','manuscript_strength','insufficient_evidence'].includes(d.kind)
      && ['coverage','organization','synthesis','evidence','critique'].includes(d.dimension)
      && nonempty(d.manuscriptLocation) && nonempty(d.referenceLocation) && nonempty(d.observation) && nonempty(d.conditions),'invalid comparison difference');
    requireValue(!(ref.match==='adjacent' && d.dimension==='coverage' && d.kind==='gap'),'adjacent reference cannot establish coverage omissions');
    differences.set(d.id,d);
  }
  requireValue(report.suggestions && ['scoper','manager','worker'].every(role=>Array.isArray(report.suggestions[role])),'three role suggestion lists required');
  for(const role of ['scoper','manager','worker'])for(const a of report.suggestions[role]) {
    requireValue(a.role===role && differences.has(a.differenceId) && ['supported','hypothesis'].includes(a.attribution)
      && ['attributionEvidence','action','conditions','expectedImprovement','acceptance'].every(k=>nonempty(a[k])),'invalid role suggestion');
  }
  requireValue(Array.isArray(report.issues) && new Set(report.issues.map(i=>i.id)).size===report.issues.length,'invalid/duplicate issues');
  for(const i of report.issues)requireValue(nonempty(i.id) && ['location','evidence','action','acceptance'].every(k=>nonempty(i[k]))
    && ['minor','major','critical'].includes(i.severity) && ['topic','global','evidence','scope'].includes(i.kind)
    && Array.isArray(i.topicIds) && i.topicIds.every(id=>topicIds.includes(id))
    && (!['topic','evidence'].includes(i.kind) || i.topicIds.length>0),'invalid repair issue');
  if(!report.passed)requireValue(report.issues.length>0,'failed review requires actionable issues');
  requireValue(Array.isArray(report.priorIssueChecks),'prior issue checks required');
  for(const p of report.priorIssueChecks)requireValue(nonempty(p.issueId) && ['resolved','partial','unresolved'].includes(p.status) && nonempty(p.evidence),'invalid prior issue check');
  return {total,passed:total>=70};
}

function renderReports(root,sub,report) {
  const dir=reportDir(root,sub.id);
  const save=(name,body)=>fs.writeFileSync(path.join(dir,name),`${body}\n`);
  save('assessment.md',`# Manuscript assessment: ${report.total}/100 — ${report.passed?'passed':'revision required'}\n\nRubric: ${report.rubricVersion}. Submission: ${sub.id}.\n\n`+
    report.items.map(i=>`## ${i.id}: ${i.score}/5\n\nLocation: ${i.location}\n\nEvidence: ${i.evidence}\n\nReason: ${i.reason}`).join('\n\n')+
    '\n\n## Repair issues\n\n'+report.issues.map(i=>`### ${i.id} (${i.severity}; ${i.kind})\n\n${i.location}\n\n${i.evidence}\n\nAction: ${i.action}\n\nAcceptance: ${i.acceptance}\n\nTopics: ${i.topicIds.join(', ')}`).join('\n\n')+
    '\n\n## Previous issue verification\n\n'+report.priorIssueChecks.map(p=>`${p.issueId}: ${p.status}. ${p.evidence}`).join('\n\n'));
  save('comparison.md',`# Reference survey comparison\n\nStatus: ${report.comparison.status}\n\nSearch: ${report.comparison.searchLog}\n\nAlignment: ${report.comparison.alignment}\n\n${report.comparison.unavailableReason??''}\n\n`+
    report.comparison.references.map(r=>`## ${r.id}: ${r.title}\n\n${r.authors.join(', ')} (${r.year}). ${r.url}\n\nVersion: ${r.version}; access: ${r.fulltext}; match: ${r.match}\n\n${r.reason}\n\nVerification: ${r.verification}`).join('\n\n')+
    '\n\n## Differences\n\n'+report.comparison.differences.map(d=>`### ${d.id}: ${d.kind} / ${d.dimension}\n\nManuscript: ${d.manuscriptLocation}\n\nReference: ${d.referenceId}, ${d.referenceLocation}\n\n${d.observation}\n\nConditions: ${d.conditions}`).join('\n\n'));
  for(const role of ['scoper','manager','worker'])save(`${role}.md`,`# ${role} candidate experience\n\nThese are candidate suggestions, not established general rules.\n\n`+
    (report.suggestions[role].map((a,index)=>`## ${index+1}. ${a.action}\n\nDifference: ${a.differenceId} (see comparison.md for both source locations)\n\nAttribution: ${a.attribution}. ${a.attributionEvidence}\n\nConditions: ${a.conditions}\n\nExpected improvement: ${a.expectedImprovement}\n\nAcceptance: ${a.acceptance}\n\nApplication result: not established; see later assessment prior-issue checks for task-specific verification.`).join('\n\n')||'No evidence-backed recommendation for this role.'));
}

export function finalReviewStatus(root) {
  const c=readControl(root),sub=latest(c);let current=false,error=null;
  try { if(sub)verifySnapshot(root,sub);current=!!sub && reviewInputs(root).fingerprint===sub.fingerprint; } catch(e) {error=e.message;}
  return {...c,current,complete:c.status==='passed' && current,error};
}

// All mutations use the same lock as research operations; delegated roles cannot run this CLI.
export function finalReviewControl(root,action,args={}) {
  if(action==='status')return finalReviewStatus(root);
  return withLock(root,()=>{
    const state=loadState(root),c=readControl(root);
    requireValue(state.schemaVersion===2,'legacy workspace: final review and research revision are disabled');
    requireValue(c.rubricVersion===RUBRIC_VERSION,'fixed rubric version is unavailable');
    const save=()=>{c.updatedAt=now();atomicJSON(controlPath(root),c);return c;};
    if(action==='submit') {
      requireValue(c.status!=='paused','resume the paused review first');
      const input=reviewInputs(root),old=latest(c),revision=activeRevision(c);
      if(old)verifySnapshot(root,old);
      if(old?.fingerprint===input.fingerprint && !revision)return c;
      if(old?.fingerprint===input.fingerprint && old.revisionId===revision?.id)return c;
      requireValue(c.status!=='revision_required','begin an authorized revision before resubmission');
      if(revision)requireValue(state.revisionContext?.id===revision.id && !state.revisionContext.active,'finish revision research first');
      const id=`submission-${String(c.submissions.length+1).padStart(4,'0')}`,dir=reportDir(root,id);
      // An interrupted copy can only resume with identical inputs; never overwrite a snapshot.
      const manifestFile=path.join(dir,'manifest.json');
      if(fs.existsSync(manifestFile))requireValue(json(manifestFile).fingerprint===input.fingerprint,'interrupted snapshot has different inputs; preserve and inspect it');
      else {fs.mkdirSync(dir,{recursive:true});atomicJSON(manifestFile,{fingerprint:input.fingerprint,manifest:input.manifest});}
      for(const [name,bytes] of Object.entries(input.files)) {
        const f=path.join(dir,'snapshot',name);fs.mkdirSync(path.dirname(f),{recursive:true});
        if(fs.existsSync(f))requireValue(hash(fs.readFileSync(f))===hash(bytes),'snapshot content changed');else fs.writeFileSync(f,bytes);
      }
      const stateSnapshot=path.join(dir,'research-state.json');if(!fs.existsSync(stateSnapshot))atomicJSON(stateSnapshot,state);
      if(old?.assessment && !revision) c.batchStart=c.revisions.filter(r=>r.assessed).length;
      c.submissions.push({id,fingerprint:input.fingerprint,evidenceHash:input.evidenceHash,evidenceRef:args.evidenceRef??`sha256:${input.evidenceHash}`,
        rubricVersion:RUBRIC_VERSION,revisionId:revision?.id??null,createdAt:now(),assessment:null});
      c.status='awaiting_review';c.pause=null;return save();
    }
    const sub=latest(c);requireValue(sub,'submit a manuscript first');
    if(action==='bind') {
      requireValue(c.status==='awaiting_review' && nonempty(args.agentId),'reviewer binding requires pending submission');
      const f=path.join(root,'.slr/paper-bindings.json'),bindings=fs.existsSync(f)?json(f):{};
      requireValue(!bindings[args.agentId] && !state.bindings[args.agentId],'agent already bound');
      bindings[args.agentId]={role:'reviewer',submissionId:sub.id};atomicJSON(f,bindings);return c;
    }
    if(action==='record') {
      verifySnapshot(root,sub);
      requireValue(c.status==='awaiting_review' || sub.assessment,'no pending assessment');
      requireValue(args.submissionId===sub.id && args.fingerprint===sub.fingerprint && reviewInputs(root).fingerprint===sub.fingerprint,'stale or wrong manuscript/evidence fingerprint');
      const bindings=json(path.join(root,'.slr/paper-bindings.json'));
      requireValue(bindings[args.reviewerId]?.role==='reviewer' && bindings[args.reviewerId].submissionId===sub.id,'independent bound reviewer required');
      validateAssessment(args.report,state.topics.map(t=>t.id));
      const revision=activeRevision(c);
      if(revision) {
        const prior=c.submissions.find(s=>s.id===revision.sourceSubmission).assessment;
        requireValue(args.report.priorIssueChecks.length===prior.issues.length && new Set(args.report.priorIssueChecks.map(p=>p.issueId)).size===prior.issues.length
          && prior.issues.every(i=>args.report.priorIssueChecks.some(p=>p.issueId===i.id)),'reassessment must check every prior issue');
      }
      if(sub.assessment) { requireValue(hash(JSON.stringify(sub.assessment))===hash(JSON.stringify(args.report)),'assessment is immutable');return c; }
      const resultFile=path.join(reportDir(root,sub.id),'assessment.json');
      if(fs.existsSync(resultFile))requireValue(hash(JSON.stringify(json(resultFile)))===hash(JSON.stringify(args.report)),'interrupted assessment differs');
      else atomicJSON(resultFile,args.report);
      renderReports(root,sub,args.report);sub.assessment=args.report;sub.reviewerId=args.reviewerId;sub.assessedAt=now();
      if(revision) {revision.assessed=true;revision.assessedAt=now();c.activeRevisionId=null;}
      const count=c.revisions.filter(r=>r.assessed).length-c.batchStart;
      c.status=args.report.passed?(args.report.comparison.status==='complete'?'passed':'comparison_pending'):'revision_required';
      if(!args.report.passed && count>=3) {c.status='paused';c.pause={kind:'quality',reason:'Three revisions remain below 70',resumeStatus:'revision_required'};}
      return save();
    }
    if(action==='begin-revision') {
      // Recover a crash between the durable repair intent and the research-state write.
      if(c.status==='repairing') {
        const r=activeRevision(c);requireValue(r,'missing repair intent');
        if(state.revisionContext?.id!==r.id)atomicJSON(statePath(root),openRevisionState(state,r));
        return c;
      }
      requireValue(c.status==='revision_required' && sub.assessment && !sub.assessment.passed,'revision requires a failed assessment');
      verifySnapshot(root,sub);
      requireValue(reviewInputs(root).fingerprint===sub.fingerprint,'preserve reviewed inputs before opening revision');
      const scopeIssue=sub.assessment.issues.some(i=>i.kind==='scope');
      if(scopeIssue)requireValue(args.scopeResolution?.withinApprovedScope===true && args.scopeResolution.explicitUserDecision===true
        && nonempty(args.scopeResolution.userMessage) && nonempty(args.scopeResolution.action),'scope change requires user decision; cannot revise scope automatically');
      const issueIds=sub.assessment.issues.map(i=>i.id),topicIds=[...new Set(sub.assessment.issues.flatMap(i=>i.topicIds))];
      if(sub.assessment.issues.some(i=>i.topicIds.length>1 || i.kind==='global' || i.kind==='scope')) {
        requireValue(state.topics.some(t=>t.id===args.coordinatorTopicId),'choose a coordinating Manager');
        if(!topicIds.includes(args.coordinatorTopicId))topicIds.push(args.coordinatorTopicId);
      }
      const r={id:`revision-${c.revisions.length+1}`,sourceSubmission:sub.id,issueIds,topicIds,coordinatorTopicId:args.coordinatorTopicId??null,assessed:false,createdAt:now(),...(scopeIssue?{scopeResolution:args.scopeResolution}:{})};
      const next=openRevisionState(state,r);
      c.revisions.push(r);c.activeRevisionId=r.id;c.status='repairing';save();atomicJSON(statePath(root),next);return c;
    }
    if(action==='pause') {
      requireValue(nonempty(args.reason) && ['tool','permission','compile','scope'].includes(args.kind),'pause requires operational reason');
      requireValue(c.status!=='passed' && c.status!=='paused','cannot pause completed/already paused review');
      requireValue(!Object.values(state.leases).some(l=>l.active),'stop or finish workers before pausing');
      c.pause={kind:args.kind,reason:args.reason,resumeStatus:c.status};c.status='paused';return save();
    }
    if(action==='resume') {
      requireValue(c.status==='paused','review is not paused');
      if(['quality','scope'].includes(c.pause.kind))requireValue(args.explicitUserContinue===true && nonempty(args.userMessage),'explicit user continuation required');
      else requireValue(args.prerequisiteRestored===true,'verify restored prerequisite');
      if(c.pause.kind==='quality')c.batchStart=c.revisions.filter(r=>r.assessed).length;
      (c.resumeEvents??=[]).push({at:now(),pause:c.pause,userMessage:args.userMessage??null});
      c.status=c.pause.resumeStatus;c.pause=null;return save();
    }
    if(action==='retry-comparison') {
      requireValue(c.status==='comparison_pending' && reviewInputs(root).fingerprint===sub.fingerprint,'comparison retry requires current passed manuscript');
      verifySnapshot(root,sub);
      // Append a new assessment attempt instead of changing an immutable result.
      const id=`submission-${String(c.submissions.length+1).padStart(4,'0')}`;
      copyFrozenTree(reportDir(root,sub.id),reportDir(root,id));
      c.submissions.push({...sub,id,assessment:null,reviewerId:null,assessedAt:null,createdAt:now(),comparisonRetryOf:sub.id,revisionId:null});
      c.status='awaiting_review';return save();
    }
    throw new Error(`unknown final review action: ${action}`);
  });
}

if(process.argv[1] && path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const [action,root,input]=process.argv.slice(2);
    requireValue(root && path.isAbsolute(root),'absolute workspace required');
    console.log(JSON.stringify(finalReviewControl(path.resolve(root),action,input?json(input):{}),null,2));
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
