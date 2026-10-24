import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createState,atomicJSON,mutate,loadState,hash,reviewFingerprint} from '../scripts/pipeline.mjs';
import {preparePaper} from '../scripts/paper-build.mjs';
export const topics=['retrieval','generation','evaluation'];
export function write(root,name,text) { const p=path.join(root,name); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,text); }
export function seed(root,{approved=true,maxRounds=5}={}) {
  fs.mkdirSync(root,{recursive:true}); atomicJSON(path.join(root,'.slr/state.json'),createState({reviewId:path.basename(root),topic:'Fixture survey',maxRounds}));
  write(root,'SCOPE_DRAFT.md','# Fixture scope\nThree topics: retrieval, generation, evaluation. Synthetic control-flow evidence only.\n');
  mutate(root,'draft',{topics:topics.map(id=>({id,title:id[0].toUpperCase()+id.slice(1),boundary:`Study ${id} with explicit conditions`}))});
  if(approved) mutate(root,'approve',{explicitApproval:true,userMessage:'Approve this synthetic test scope',scopeHash:hash(fs.readFileSync(path.join(root,'SCOPE_DRAFT.md')))});
  return loadState(root);
}
export function planRound(root) {
  mutate(root,'begin-round');
  for(const topicId of topics) mutate(root,'plan',{topicId,tasks:[{id:'first',question:`What supports ${topicId}?`,boundary:'One subtopic',rationale:'Initial task'}]});
}
export const candidate={title:'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',doi:null,arxivId:'2005.11401',canonicalUrl:'https://arxiv.org/abs/2005.11401',sourceVersion:'v1'};
export function discover(root,topicId,candidates=[candidate]) {
  const leaseId=`discover-${topicId}`;
  mutate(root,'reserve',{topicId,taskId:'first',leaseId});
  mutate(root,'bind-worker',{leaseId,agentId:`worker-${leaseId}`});
  mutate(root,'finish-discovery',{leaseId,candidates,noEvidenceReason:'Fixture empty search'});
}
export function record(root,p) {
  const card={...candidate,paperId:p.id,title:p.title,authors:['Patrick Lewis'],year:2020,venue:null,verification:'metadata_verified',sourceVersion:p.sourceVersion,canonicalUrl:p.canonicalUrl};
  // These records are test data and cannot support a substantive scientific survey.
  const headings=['Research Question','Method','Study Setting','Findings','Comparison Conditions','Limitations','Evidence Locations','Open Questions'];
  write(root,`papers/${p.id}/metadata.json`,JSON.stringify(card,null,2));
  write(root,`papers/${p.id}/note.md`,`# ${p.id}\n`+headings.map(h=>`## ${h}\nSynthetic fixture text; not verified scientific evidence. Source: abstract.\n`).join('\n'));
}
export function finishReading(root,topicId) {
  const leaseId=`read-${topicId}`;
  mutate(root,'reserve',{topicId,taskId:'first',leaseId});
  mutate(root,'bind-worker',{leaseId,agentId:`worker-${leaseId}`});
  for(const p of Object.values(loadState(root).papers)) if(p.owner.topicId===topicId) record(root,p);
  mutate(root,'finish-read',{leaseId});
  for(const p of Object.values(loadState(root).papers)) if(p.owner.topicId===topicId) mutate(root,'accept-paper',{paperId:p.id,checked:true,rationale:'Synthetic fixture shape verified'});
}
export function chapter(root,topicId) {
  const s=loadState(root), t=s.topics.find(t=>t.id===topicId), id=t.tasks[0].paperIds[0];
  write(root,`topics/${topicId}/chapter.md`,`# ${t.title}\nFixture synthesis [@${id}], abstract. No scientific result claimed.\n`);
  write(root,`topics/${topicId}/synthesis.md`,`# Background and Terms\nFixture material [@${id}], abstract.\n## Problem and Significance\nNot studied.\n## Taxonomy Relations\nSynthetic categories.\n## Comparison Conditions\nNo empirical comparison.\n## Conflicts\nUnknown.\n## Challenges and Directions\nVerify full text before scientific use.\n`);
}
export function review(root,topicId,{verdict='passed',issues=[],limitations=[]}={}) {
  return mutate(root,'review-topic',{topicId,checkerId:'checker',verdict,issues,limitations,fingerprint:reviewFingerprint(root,topicId)});
}
export function complete(root,{limited=false,repair=true}={}) {
  seed(root); planRound(root);
  for(const t of topics) discover(root,t);
  for(const t of topics) finishReading(root,t);
  mutate(root,'bind',{agentId:'checker',role:'checker'});
  for(const t of topics) {
    chapter(root,t);
    if(repair && t===topics[0]) {
      review(root,t,{verdict:'revision_required',issues:[{location:'chapter paragraph 1',evidence:'No comparable experimental protocol',severity:'major',action:'Remove unsupported comparison'}]});
      fs.appendFileSync(path.join(root,`topics/${t}/chapter.md`),'The fixture does not establish comparative effectiveness.\n');
    }
    review(root,t,{limitations:limited?['Fixture evidence coverage is limited']:[]});
  }
  mutate(root,'end-round'); mutate(root,'finalize',{scaleReason:'Synthetic control-flow fixture deliberately uses one shared paper; no real coverage claimed.'}); return loadState(root);
}
export function manuscript(root,{chinese=false}={}) {
  const dir=path.join(root,'paper'); preparePaper(dir);
  const id=Object.keys(loadState(root).papers)[0];
  let tex=fs.readFileSync(path.join(dir,'main.tex'),'utf8')
    .replace('Survey Title',chinese?'分层综述流程验证':'Hierarchical Survey Pipeline Validation')
    .replace('\\section{Topic Name}\\label{sec:topic-slug}',topics.map(t=>`\\section{${t[0].toUpperCase()+t.slice(1)}}\\label{sec:topic-${t}}`).join('\n'))
    .replace('\\begin{abstract}','\\begin{abstract}\nThis document checks the delivery pipeline using synthetic material, not scientific findings.')
    .replace(/(\\label\{[^}]+\})/g,`$1\nThis synthetic fixture exercises traceability to \\citep{${id}}. No experimental comparison or substantive survey conclusion is claimed.`);
  if(chinese) tex=tex.replace('\\surveychinesefalse','\\surveychinesetrue').replace('This document checks the delivery pipeline using synthetic material, not scientific findings.','本文件使用合成材料验证分层综述流程，内容不构成真实文献综述结论。').replaceAll('This synthetic fixture exercises traceability to','本节验证引用与论文笔记之间的对应关系，参考').replaceAll('No experimental comparison or substantive survey conclusion is claimed.','当前材料仅用于程序测试，未进行实验比较；实际研究结论需要回读原文核验。');
  write(root,'paper/main.tex',tex);
  write(root,'paper/references.bib',`@misc{${id},author={Lewis, Patrick and others},title={Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks},year={2020},eprint={2005.11401},archivePrefix={arXiv},url={https://arxiv.org/abs/2005.11401}}\n`);
  return dir;
}
export function scaffold(kind, project=process.cwd()) {
  if(kind==='blank') return project;
  const root=path.join(project,'workspaces','fixture-review');
  if(fs.existsSync(root)) throw new Error('fixture workspace already exists; use a fresh sandbox');
  if(kind.startsWith('paper') || kind==='three-topic' || kind==='legacy') complete(root,{limited:kind==='paper-limitations'});
  else seed(root,{approved:!['scope-gate','scope-revision'].includes(kind)});
  if(kind==='paper-revision') manuscript(root);
  if(kind==='legacy') {
    const s=loadState(root); atomicJSON(path.join(root,'.slr/state.json'),{...s,schemaVersion:1});
    write(root,'topics/legacy/final.md','---\nstatus: final\n---\nLegacy fixture: only source-backed facts are usable.\n');
    write(root,'REVIEW_PAPER.md','# Preserved legacy draft\n');
  }
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe',windowsHide:true});
  git(['init']); git(['add','.']); git(['-c','user.name=SLR Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture: isolated synthetic corpus']);
  if(['completed','completed_with_limitations'].includes(loadState(root).stage)) git(['tag','slr-complete']);
  return root;
}
