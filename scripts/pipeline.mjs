import {bounded,researchSummary,researchQuery,readSlice} from './bounded-output.mjs';
import {checkpoint,saveRecovery,contextControl} from './context-control.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const hash = value => createHash('sha256').update(value).digest('hex');
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const terminal = new Set(['completed', 'completed_with_limitations']);
const required = (condition, message) => { if (!condition) throw new Error(message); };
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const statePath = root => path.join(root, '.slr/state.json');
export function loadState(root) { return readJSON(statePath(root)); }
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function validateV2(s) {
  const errors = [];
  if (s?.schemaVersion !== 2) return ['schemaVersion must be 2'];
  if (!slug.test(s.reviewId ?? '')) errors.push('invalid reviewId');
  if (!['drafting_scope','awaiting_scope_approval','researching','blocked',...terminal].includes(s.stage)) errors.push('invalid stage');
  for (const key of ['maxRounds','maxWorkers','retryLimit']) if (!Number.isInteger(s[key]) || s[key] < 1) errors.push(`invalid ${key}`);
  if(s.maxWorkers>9 || s.retryLimit!==2) errors.push('at most nine workers and exactly two attempts per phase');
  if (!Number.isInteger(s.currentRound) || s.currentRound < 0 || s.currentRound > s.maxRounds) errors.push('invalid currentRound');
  const object=v=>v && typeof v==='object' && !Array.isArray(v);
  if (!Array.isArray(s.topics) || !object(s.papers) || !object(s.bindings) || !object(s.leases)) return [...errors, 'missing registries'];
  if(s.topics.some(t=>!object(t) || !Array.isArray(t.tasks))) return [...errors,'invalid topic registry'];
  if(typeof s.roundOpen!=='boolean' || !Number.isInteger(s.cursor) || s.cursor<0 || !Array.isArray(s.reviewEvents)) errors.push('invalid round bookkeeping');
  if (s.stage !== 'drafting_scope' && (s.topics.length < 3 || s.topics.length > 5)) errors.push('scope requires 3–5 topics');
  if (new Set(s.topics.map(t => t.id)).size !== s.topics.length) errors.push('duplicate topic IDs');
  for (const t of s.topics) {
    if (!slug.test(t.id) || !t.title?.trim() || !t.boundary?.trim() || !Array.isArray(t.tasks)) errors.push('invalid topic');
    if (!['pending','researching','review','revision','completed','blocked'].includes(t.status)) errors.push('invalid topic status');
    if (new Set(t.tasks.map(x => x?.id)).size !== t.tasks.length) errors.push('duplicate task IDs');
    for (const task of t.tasks) {
      if (!object(task) || !slug.test(task.id) || typeof task.question!=='string' || !task.question.trim() || !['discover','read'].includes(task.phase)
        || !['pending','running','complete','blocked'].includes(task.status) || !Array.isArray(task.paperIds) || !Array.isArray(task.limitations)
        || !object(task.attempts) || ['discover','read'].some(p=>!Number.isInteger(task.attempts[p]) || task.attempts[p]<0 || task.attempts[p]>2)) errors.push('invalid task');
    }
  }
  for(const [id,p] of Object.entries(s.papers)) {
    if(!object(p) || p.id!==id || !/^p-[a-f0-9]{12}$/.test(id) || !Array.isArray(p.keys) || !Array.isArray(p.topicIds)
      || !['pending','final'].includes(p.status) || !s.topics.some(t=>t.id===p.owner?.topicId && t.tasks.some(x=>x.id===p.owner?.taskId && x.paperIds?.includes(id)))) errors.push('invalid paper registry');
  }
  for(const l of Object.values(s.leases)) {
    if(!object(l) || typeof l.active!=='boolean' || !s.topics.some(t=>t.id===l.topicId && t.tasks.some(x=>x.id===l.taskId))) errors.push('invalid worker lease');
  }
  if (Object.values(s.leases).filter(l => l?.active).length > s.maxWorkers) errors.push('worker limit exceeded');
  if (!['drafting_scope','awaiting_scope_approval'].includes(s.stage) && !s.approval?.scopeHash) errors.push('missing approval');
  if (terminal.has(s.stage) && s.topics.some(t => t.status !== 'completed')) errors.push('terminal review requires all chapters accepted');
  if(s.revisionContext && (!Number.isInteger(s.revisionContext.roundsUsed) || s.revisionContext.roundsUsed<0 || s.revisionContext.roundsUsed>1
    || !Array.isArray(s.revisionContext.topicIds) || s.revisionContext.topicIds.some(id=>!s.topics.some(t=>t.id===id)))) errors.push('invalid revision context');
  return errors;
}

// Main-session final-review control calls this under the shared workspace lock.
// There is deliberately no unrestricted reopen command in the research CLI.
export function openRevisionState(state, revision) {
  const s=structuredClone(state);
  required(s.schemaVersion===2 && terminal.has(s.stage) && !s.roundOpen && !active(s).length,'revision requires completed v2 research');
  required(revision.id && revision.issueIds?.length && Array.isArray(revision.topicIds),'revision requires issues and assigned topics');
  for(const id of revision.topicIds) {
    const t=topicOf(s,id); t.status='revision'; t.reviewHash=null; t.reviewAttempts=0;
  }
  s.revisionContext={...revision,active:true,roundsUsed:0};
  s.stage='researching'; s.completionReason=null; s.updatedAt=new Date().toISOString();
  required(!validateV2(s).length,'invalid revision state'); return s;
}

export function createState(config) {
  required(slug.test(config.reviewId ?? '') && config.topic?.trim(), 'provide reviewId and topic');
  return { schemaVersion: 2, reviewId: config.reviewId, topic: config.topic,
    language: config.language ?? 'English', stage: 'drafting_scope', scopeRevision: 0,
    currentRound: 0, roundOpen: false, maxRounds: config.maxRounds ?? 5,
    maxWorkers: config.maxWorkers ?? 9, retryLimit: 2, consecutiveLowYieldRounds: 0,
    completionReason: null, approval: null, topics: [], papers: {}, bindings: {}, leases: {},
    cursor: 0, roundStart: null, reviewEvents: [], dispatchMode: 'nested',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function canonicalKeys(card) {
  const keys = [];
  if (card.doi) keys.push(`doi:${card.doi.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi.org\//, '').trim()}`);
  if (card.arxivId) keys.push(`arxiv:${card.arxivId.replace(/^.*?(\d{4}\.\d{4,5}).*$/, '$1')}`);
  if (card.title) keys.push(`title:${card.title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}`);
  if (card.canonicalUrl) {
    const u = new URL(card.canonicalUrl); u.hash = '';
    required(['http:','https:'].includes(u.protocol), 'canonical URL must be HTTP(S)');
    keys.push(`url:${u.toString().replace(/\/$/,'')}`);
  }
  return keys;
}
function topicOf(s, id) { const t = s.topics.find(x => x.id === id); required(t, 'unknown topic'); return t; }
function taskOf(s, topicId, id) { const t = topicOf(s, topicId).tasks.find(x => x.id === id); required(t, 'unknown task'); return t; }
const active = s => Object.values(s.leases).filter(l => l.active);
function paperFiles(root, id) { return ['metadata.json','note.md'].map(n => path.join(root,'papers',id,n)); }
export function paperFingerprint(root, id) { return hash(paperFiles(root,id).map(f => fs.readFileSync(f)).join('\0')); }
export function validatePaperRecord(root, p) {
  const [meta, noteFile] = paperFiles(root, p.id);
  const card = readJSON(meta), note = fs.readFileSync(noteFile,'utf8');
  required(card.paperId === p.id, 'metadata paperId mismatch');
  for (const k of ['title','authors','year','venue','doi','arxivId','canonicalUrl','sourceVersion','verification']) required(k in card, `missing metadata ${k}`);
  required(card.title?.trim() && Array.isArray(card.authors), 'invalid title/authors');
  required(card.year === null || Number.isInteger(card.year), 'year must be integer or null');
  required(['metadata_verified','fulltext_verified','abstract_only','unavailable'].includes(card.verification), 'invalid verification');
  required(canonicalKeys(card).some(k => p.keys.includes(k)), 'metadata changed paper identity');
  for(const prefix of ['doi:','arxiv:']) {
    const registered=p.keys.find(k=>k.startsWith(prefix)), supplied=canonicalKeys(card).find(k=>k.startsWith(prefix));
    required(!registered || registered===supplied,'metadata strong identifier differs from registered identity');
  }
  required((card.sourceVersion ?? null) === (p.sourceVersion ?? null), 'source version must match registered version');
  for (const heading of ['Research Question','Method','Study Setting','Findings','Comparison Conditions','Limitations','Evidence Locations','Open Questions']) {
    const section = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`).exec(note);
    required(section?.[1]?.trim(), `missing/empty note section: ${heading}`);
  }
  required(note.includes(p.id), 'note must identify its paper');
  return card;
}

function topicFingerprint(root, s, t) {
  const ids = [...new Set(t.tasks.flatMap(x => x.paperIds))].sort();
  const content = ['chapter.md','synthesis.md'].map(n => fs.readFileSync(path.join(root,'topics',t.id,n),'utf8'));
  for (const text of content) {
    required(text.trim(), 'empty chapter/synthesis');
    const cites = [...text.matchAll(/\[@(p-[a-f0-9]{12})\]/g)].map(m => m[1]);
    required(cites.length > 0, 'chapter and synthesis require canonical paper citations');
    for (const id of cites) required(ids.includes(id) && s.papers[id]?.status === 'final', `unaccepted or foreign citation: ${id}`);
  }
  for (const id of ids) if (s.papers[id]?.status === 'final') required(paperFingerprint(root,id) === s.papers[id].fingerprint, 'accepted paper changed; revalidate it');
  return hash([...content, ...ids.map(id => `${id}:${s.papers[id]?.fingerprint ?? 'pending'}`)].join('\0'));
}

// This reducer is called only by the main-session CLI, except the narrowly guarded bind-worker command.
export function transition(state, action, args = {}, root = '.') {
  const s = structuredClone(state);
  required(s.schemaVersion === 2, 'legacy workspace is read-only; only status and paper are available');
  required(!validateV2(s).length,'invalid prior state');
  const finalFile=path.join(root,'.slr/final-review.json');
  if(fs.existsSync(finalFile)) required(readJSON(finalFile).status!=='paused','final review is paused; use its recovery command first');
  required(!terminal.has(s.stage), 'research is terminal');
  required(s.stage!=='blocked' || action==='resume','blocked research requires explicit prerequisite recovery');
  const revision=s.revisionContext?.active?s.revisionContext:null;
  if(revision && args.topicId && !['bind','mode'].includes(action)) required(revision.topicIds.includes(args.topicId),'topic outside assigned revision');
  if (action === 'draft') {
    required(['drafting_scope','awaiting_scope_approval'].includes(s.stage), 'scope is frozen');
    required(Array.isArray(args.topics) && args.topics.length >= 3 && args.topics.length <= 5, 'provide 3–5 topics');
    s.topics = args.topics.map(t => ({ id: t.id, title: t.title, boundary: t.boundary, status:'pending', tasks:[], reviewAttempts:0, limitations:[], reviewHash:null }));
    s.scopeRevision++; s.stage = 'awaiting_scope_approval';
  } else if (action === 'approve') {
    required(s.stage === 'awaiting_scope_approval' && args.explicitApproval === true && args.userMessage?.trim(), 'explicit user approval required');
    const text = fs.readFileSync(path.join(root,'SCOPE_DRAFT.md'));
    required(args.scopeHash === hash(text), 'scope changed after approval');
    s.approval = { scopeHash:args.scopeHash, userMessage:args.userMessage, at:new Date().toISOString() };
    s.stage = 'researching';
  } else {
    required(s.approval, 'scope approval required');
    if (action === 'bind') {
      required(args.agentId?.trim() && ['manager','checker','paper'].includes(args.role), 'invalid binding');
      if (args.role === 'manager') topicOf(s,args.topicId);
      required(!s.bindings[args.agentId], 'agent already bound');
      s.bindings[args.agentId] = { role:args.role, topicId:args.topicId ?? null };
    } else if (action === 'mode') {
      required(['nested','main-dispatch'].includes(args.mode), 'invalid dispatch mode'); s.dispatchMode = args.mode;
    } else if (action === 'begin-round') {
      required(s.stage === 'researching' && !s.roundOpen && active(s).length === 0, 'cannot begin round');
      if(revision) { required(revision.roundsUsed<1,'revision research budget exhausted'); revision.roundsUsed++; }
      else { required(s.currentRound < s.maxRounds && s.consecutiveLowYieldRounds < 2, 'research budget exhausted'); s.currentRound++; }
      s.roundOpen = true;
      s.roundStart = { papers:Object.values(s.papers).filter(p => p.status === 'final').length, tasks:s.topics.reduce((n,t) => n+t.tasks.length,0), chapters:s.topics.filter(t=>t.status==='completed').length };
    } else if (action === 'plan') {
      required(s.stage === 'researching' && s.roundOpen, 'plan requires an open research round');
      const t = topicOf(s,args.topicId); required(t.status !== 'completed', 'topic already accepted');
      required(Array.isArray(args.tasks), 'tasks must be an array');
      for (const candidate of args.tasks) {
        required(slug.test(candidate.id ?? '') && candidate.question?.trim() && candidate.boundary?.trim(), 'task requires id, question and boundary');
        const old = t.tasks.find(x => x.id === candidate.id);
        if (old) { required(old.question === candidate.question && old.boundary === candidate.boundary, 'existing task is immutable; create a new evidenced task'); continue; }
        required(!revision && s.currentRound === 1 || candidate.rationale?.trim(), 'later tasks require an evidenced gap');
        t.tasks.push({ id:candidate.id, question:candidate.question, boundary:candidate.boundary, rationale:candidate.rationale ?? 'initial decomposition', phase:'discover', status:'pending', attempts:{discover:0,read:0}, paperIds:[], limitations:[], ...(revision?{revisionId:revision.id}:{}) });
      }
      t.status = 'researching';
    } else if (action === 'reserve') {
      required(s.stage === 'researching' && s.roundOpen && active(s).length < s.maxWorkers, 'no worker slot or closed round');
      const task = taskOf(s,args.topicId,args.taskId);
      if(revision) required(task.revisionId===revision.id,'task outside assigned revision');
      required(task.status === 'pending' && task.attempts[task.phase] < s.retryLimit, 'task is not dispatchable');
      if (task.phase === 'read') {
        for (const id of task.paperIds) required(s.papers[id], 'unregistered paper');
      }
      const leaseId = args.leaseId ?? randomUUID(); required(!s.leases[leaseId], 'duplicate lease');
      s.leases[leaseId] = { id:leaseId, topicId:args.topicId, taskId:task.id, phase:task.phase, round:s.currentRound, active:true, agentId:null, ...(revision?{revisionId:revision.id,revisionRound:revision.roundsUsed}:{}) };
      task.status='running'; task.attempts[task.phase]++;
      s.cursor = (s.topics.findIndex(t=>t.id===args.topicId)+1) % s.topics.length;
    } else if (action === 'claim-launch') {
      const l=s.leases[args.leaseId], manager=s.bindings[args.managerId];
      required(l?.active && !l.agentId && !l.launchClaimed && manager?.role==='manager' && manager.topicId===l.topicId,'worker launch already claimed or not allocated');
      l.launchClaimed=true;
    } else if (action === 'bind-worker') {
      const l = s.leases[args.leaseId]; required(l?.active && !l.agentId, 'lease unavailable');
      required(args.agentId?.trim() && !s.bindings[args.agentId], 'agent already bound or missing');
      l.agentId=args.agentId; s.bindings[args.agentId]={role:'worker',topicId:l.topicId,taskId:l.taskId,leaseId:l.id};
    } else if (action === 'finish-discovery') {
      const l=s.leases[args.leaseId]; required(l?.active && l.phase==='discover','invalid discovery lease');
      const task=taskOf(s,l.topicId,l.taskId);
      required(Array.isArray(args.candidates),'candidates must be an array');
      for (const card of args.candidates) {
        required(card.title?.trim() && card.canonicalUrl && 'sourceVersion' in card, 'candidate requires title, URL, sourceVersion');
        const keys=canonicalKeys(card);
        const matches=Object.values(s.papers).filter(p=>p.keys.some(k=>keys.includes(k)));
        required(matches.length <= 1,'ambiguous identity: resolve conflicting aliases before registration');
        let p=matches[0];
        if(p) {
          const shared=p.keys.filter(k=>keys.includes(k));
          required(shared.some(k=>!k.startsWith('title:')) || (card.identityConfirmed===true && card.identityEvidence?.trim()),'title-only match requires documented identity confirmation');
          for(const type of ['doi:','arxiv:']) {
            const a=p.keys.find(k=>k.startsWith(type)), b=keys.find(k=>k.startsWith(type));
            required(!a || !b || a===b,'conflicting strong identifiers; manual identity resolution required');
          }
          required((p.sourceVersion??null)===(card.sourceVersion??null),'source version conflict: choose and document one version before retry');
          p.keys=[...new Set([...p.keys,...keys])];
        } else {
          const id=`p-${hash(keys[0]).slice(0,12)}`;
          p={ id, keys, title:card.title, sourceVersion:card.sourceVersion, canonicalUrl:card.canonicalUrl,
            owner:{topicId:l.topicId,taskId:l.taskId}, topicIds:[], status:'pending', fingerprint:null };
          required(!s.papers[id],'paper ID collision'); s.papers[id]=p;
        }
        if(!p.topicIds.includes(l.topicId)) p.topicIds.push(l.topicId);
        if(!task.paperIds.includes(p.id)) task.paperIds.push(p.id);
      }
      task.phase='read'; task.status=task.paperIds.length?'pending':'complete';
      if(!task.paperIds.length) { required(args.noEvidenceReason?.trim(),'empty discovery requires explanation'); task.limitations.push(args.noEvidenceReason); }
      l.active=false;
    } else if (action === 'accept-paper') {
      const p=s.papers[args.paperId]; required(p,'unknown paper');
      if(revision) required(taskOf(s,p.owner.topicId,p.owner.taskId).revisionId===revision.id,'paper outside assigned revision');
      required(args.checked === true && args.rationale?.trim(),'manager evidence acceptance required');
      required(!active(s).some(l=>l.topicId===p.owner.topicId && l.taskId===p.owner.taskId),'wait for writer to stop before accepting');
      validatePaperRecord(root,p); const fingerprint=paperFingerprint(root,p.id);
      if(p.fingerprint!==fingerprint) for(const t of s.topics) if(p.topicIds.includes(t.id)) { t.reviewHash=null; if(t.status==='completed') t.status='revision'; }
      p.status='final'; p.fingerprint=fingerprint; p.acceptance=args.rationale;
    } else if (action === 'finish-read') {
      const l=s.leases[args.leaseId]; required(l?.active && l.phase==='read','invalid read lease');
      const task=taskOf(s,l.topicId,l.taskId);
      for(const id of task.paperIds) { const p=s.papers[id]; if(p.owner.topicId===l.topicId && p.owner.taskId===l.taskId) validatePaperRecord(root,p); }
      task.status='complete'; l.active=false;
    } else if (action === 'fail') {
      const l=s.leases[args.leaseId]; required(l?.active && args.reason?.trim(),'active lease and reason required');
      const task=taskOf(s,l.topicId,l.taskId); l.active=false;
      task.status=task.attempts[task.phase] < s.retryLimit?'pending':'blocked';
      (task.failures??=[]).push({phase:task.phase,attempt:task.attempts[task.phase],reason:args.reason});
      if(task.status==='blocked') task.limitations.push(args.reason);
    } else if (action === 'supplement') {
      required(s.stage==='researching' && s.roundOpen,'supplement requires research budget');
      const p=s.papers[args.paperId]; required(p && args.reason?.trim(),'paper and evidence gap required');
      if(revision) required(p.topicIds.some(id=>revision.topicIds.includes(id)),'paper outside assigned revision');
      const owner=taskOf(s,p.owner.topicId,p.owner.taskId);
      required(owner.status!=='running','owner is active');
      const t=topicOf(s,p.owner.topicId);
      const id=args.taskId; required(slug.test(id??'') && !t.tasks.some(x=>x.id===id),'new supplement task ID required');
      p.owner={topicId:t.id,taskId:id}; p.status='pending';
      t.tasks.push({id,question:args.reason,boundary:'Supplement existing paper only',rationale:args.reason,phase:'read',status:'pending',attempts:{discover:0,read:0},paperIds:[p.id],limitations:[],...(revision?{revisionId:revision.id}:{})});
      for(const affected of s.topics.filter(x=>p.topicIds.includes(x.id))) {
        if(revision && !revision.topicIds.includes(affected.id)) { revision.topicIds.push(affected.id); affected.reviewAttempts=0; }
        affected.status='revision'; affected.reviewHash=null;
      }
    } else if (action === 'review-topic') {
      const t=topicOf(s,args.topicId);
      required(!active(s).some(l=>l.topicId===t.id),'workers still active');
      required(t.tasks.length && t.tasks.every(x=>['complete','blocked'].includes(x.status)),'unfinished topic tasks');
      required(t.reviewAttempts<3,'two repair cycles exhausted');
      required(['passed','revision_required'].includes(args.verdict) && Array.isArray(args.issues),'invalid checker result');
      required(args.checkerId && s.bindings[args.checkerId]?.role==='checker','independent checker binding required');
      for(const i of args.issues) required(i.location && i.evidence && i.action && ['major','minor'].includes(i.severity),'incomplete review issue');
      if(args.verdict==='passed') required(!args.issues.some(i=>i.severity==='major'),'major issues cannot pass');
      const fingerprint=topicFingerprint(root,s,t);
      required(args.fingerprint===fingerprint,'chapter/evidence changed since review');
      t.reviewAttempts++; t.limitations=[...new Set([...t.tasks.flatMap(x=>x.limitations),...(args.limitations??[])])];
      t.status=args.verdict==='passed'?'completed':t.reviewAttempts>=3?'blocked':'revision';
      t.reviewHash=args.verdict==='passed'?fingerprint:null;
      s.reviewEvents.push({...args,round:s.currentRound,attempt:t.reviewAttempts,...(revision?{revisionId:revision.id}:{})});
    } else if (action === 'close-task') {
      const task=taskOf(s,args.topicId,args.taskId);
      required(task.status==='pending' && args.reason?.trim(),'only pending tasks can be closed with a documented reason');
      task.status='blocked'; task.limitations.push(args.reason);
    } else if (action === 'end-round') {
      required(s.roundOpen && active(s).length===0,'active workers or no round');
      const newPapers=Object.values(s.papers).filter(p=>p.status==='final').length-s.roundStart.papers;
      const newTasks=s.topics.reduce((n,t)=>n+t.tasks.length,0)-s.roundStart.tasks;
      const newChapters=s.topics.filter(t=>t.status==='completed').length-s.roundStart.chapters;
      if(!revision) s.consecutiveLowYieldRounds=newPapers<=0 && newChapters<=0?s.consecutiveLowYieldRounds+1:0;
      s.roundMetrics={round:s.currentRound,newPapers,newTasks,newChapters,...(revision?{revisionId:revision.id,revisionRound:revision.roundsUsed}:{})}; s.roundOpen=false;
    } else if(action==='block') {
      required(args.reason?.trim() && active(s).length===0,'stop all workers and give reason'); s.stage='blocked'; s.lastError=args.reason;
    } else if(action==='resume') {
      required(s.stage==='blocked' && args.prerequisiteRestored===true,'verify prerequisite first'); s.stage='researching'; delete s.lastError;
    } else if(action==='finalize') {
      required(!s.roundOpen && active(s).length===0,'close round before finalization');
      required(s.topics.every(t=>t.status==='completed' && t.reviewHash===topicFingerprint(root,s,t)),'all topic chapters must pass current review');
      const limited=s.topics.some(t=>t.limitations.length || t.tasks.some(x=>x.status==='blocked'));
      s.stage=limited?'completed_with_limitations':'completed'; s.completionReason=limited?'accepted_with_limitations':'all_topics_accepted';
      if(revision) revision.active=false;
    } else throw new Error(`unknown action: ${action}`);
  }
  s.updatedAt=new Date().toISOString();
  const errors=validateV2(s); required(!errors.length,errors.join('; ')); return s;
}

export function nextTasks(s) {
  if(s.schemaVersion!==2 || s.stage!=='researching' || !s.roundOpen) return [];
  const topics=[...s.topics.slice(s.cursor),...s.topics.slice(0,s.cursor)];
  const queues=topics.filter(t=>t.status!=='completed' && (!s.revisionContext?.active || s.revisionContext.topicIds.includes(t.id))).map(t=>t.tasks.filter(x=>x.status==='pending' && (!s.revisionContext?.active || x.revisionId===s.revisionContext.id)).map(task=>({topicId:t.id,taskId:task.id,phase:task.phase})));
  const result=[]; let i=0;
  while(result.length < s.maxWorkers-active(s).length && queues.some(q=>q.length)) { const q=queues[i++%queues.length]; if(q.length) result.push(q.shift()); }
  return result;
}
export function reviewFingerprint(root, topicId) { const s=loadState(root); return topicFingerprint(root,s,topicOf(s,topicId)); }

export function paperControl(root, action, args) {
  const state=loadState(root);
  required(terminal.has(state.stage),'paper requires completed research');
  required(action==='bind-paper' && args.agentId?.trim() && args.role==='paper','only paper writer binding is supported');
  const file=path.join(root,'.slr/paper-bindings.json');
  const bindings=fs.existsSync(file)?readJSON(file):{};
  required(!bindings[args.agentId] && !state.bindings?.[args.agentId],'agent already bound');
  bindings[args.agentId]={role:'paper'}; atomicJSON(file,bindings); return bindings;
}

export function withLock(root, callback) {
  const file=path.join(root,'.slr/control.lock'); let fd;
  try { fd=fs.openSync(file,'wx'); } catch { throw new Error('control operation already active; retry, or inspect stale control.lock after confirming all writers stopped'); }
  try { return callback(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
export function mutate(root, action, args) {
  return withLock(root,()=>{
    const prev=loadState(root), next=transition(prev,action,args,root);
    if(action==='approve') for(const name of ['SCOPE_ORIGINAL.md','SCOPE.md']) {
      const target=path.join(root,name), content=fs.readFileSync(path.join(root,'SCOPE_DRAFT.md'));
      if(fs.existsSync(target)) required(fs.readFileSync(target).equals(content),'existing approved scope differs'); else fs.writeFileSync(target,content);
    }
    for(const t of next.topics) {
      fs.mkdirSync(path.join(root,'topics',t.id,'tasks'),{recursive:true});
      for(const task of t.tasks) fs.mkdirSync(path.join(root,'topics',t.id,'tasks',task.id),{recursive:true});
    }
    for(const p of Object.values(next.papers)) fs.mkdirSync(path.join(root,'papers',p.id),{recursive:true});
    atomicJSON(statePath(root),next);
    if(action==='review-topic' && args.verdict==='passed') checkpoint(root,`topic:${args.topicId}`,next.topics.find(t=>t.id===args.topicId).reviewHash);
    else saveRecovery(root);
    return next;
  });
}

async function cli() {
  const argv=process.argv.slice(2), full=argv.includes('--full');
  const [command, directory, input, extra] = argv.filter(x=>x!=='--full');
  const emit=value=>console.log(JSON.stringify(full?value:bounded(value,path.join(directory??'.','.slr/state.json'))));
  required(directory && path.isAbsolute(directory),'absolute workspace path required');
  const root=path.resolve(directory);
  if(command==='init') {
    required(!fs.existsSync(root),'workspace already exists');
    const s=createState(readJSON(input)); required(path.basename(root)===s.reviewId,'directory must match reviewId');
    required(!validateV2(s).length,'invalid initial settings'); fs.mkdirSync(root,{recursive:true}); atomicJSON(statePath(root),s); contextControl(root,'enable'); emit(full?s:researchSummary(s,command,root)); return;
  }
  if(command==='status') { const s=loadState(root);emit(full?s:researchSummary(s,command,root)); return; }
  if(command==='query') { emit(researchQuery(loadState(root),input?readJSON(input):{},root));return; }
  if(command==='read') { console.log(JSON.stringify(readSlice(root,readJSON(input))));return; }
  if(command==='bind-paper') { emit(full?paperControl(root,command,readJSON(input)):(paperControl(root,command,readJSON(input)),{ok:true,action:command})); return; }
  if(command==='next') { emit(nextTasks(loadState(root))); return; }
  if(command==='fingerprint') { console.log(reviewFingerprint(root,input)); return; }
  if(command==='bind-worker') { emit(researchSummary(mutate(root,command,{leaseId:input,agentId:extra}),command,root)); return; }
  const result=mutate(root,command,input?readJSON(input):{});emit(full?result:researchSummary(result,command,root));
}
if(process.argv[1] && path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()) {
  try { await cli(); } catch(error) { console.error(error.message); process.exitCode=1; }
}
