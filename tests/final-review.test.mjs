import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {complete,manuscript,review,topics} from '../evals/fixture-lib.mjs';
import {assessment,mockCompile,submitAndRecord} from '../evals/final-review-lib.mjs';
import {finalReviewControl as control,finalReviewStatus,validateAssessment,reviewInputs} from '../scripts/final-review.mjs';
import {mutate,loadState,atomicJSON,statePath,validateV2} from '../scripts/pipeline.mjs';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';

function setup(t) {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-final-'));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  const root=path.join(project,'workspaces','fixture-review');complete(root);manuscript(root);
  assert.equal(mockCompile(root).status,'success');return {root,project};
}
function finishRevision(root,n=1) {
  for(const topicId of loadState(root).revisionContext.topicIds) {
    fs.appendFileSync(path.join(root,`topics/${topicId}/chapter.md`),`\nRepair ${n}.\n`);
    review(root,topicId);
  }
  if(loadState(root).roundOpen)mutate(root,'end-round');
  mutate(root,'finalize',{scaleReason:'Synthetic control-flow fixture deliberately uses one shared paper; no real coverage claimed.'});fs.appendFileSync(path.join(root,'paper/main.tex'),`\n% repaired ${n}\n`);mockCompile(root);
}

test('twenty items use exact IDs, integer scores and 69/70 threshold without critical veto',()=>{
  assert.deepEqual(validateAssessment(assessment(69),topics),{total:69,passed:false});
  const passed=assessment(70);passed.issues=assessment(69).issues;
  assert.deepEqual(validateAssessment(passed,topics),{total:70,passed:true});
  for(const change of [r=>r.items.pop(),r=>r.items[0].score=1.5,r=>r.items[0].score=6,r=>r.items[0].id=r.items[1].id,r=>r.total++,r=>r.passed=true,r=>r.items[0].evidence='',r=>r.issues=[]]) {
    const r=assessment(69);change(r);assert.throws(()=>validateAssessment(r,topics));
  }
});
test('reference matching, source locations, attribution and empty role suggestions',()=>{
  for(const match of ['same','overlapping','adjacent'])assert.equal(validateAssessment(assessment(70,{match}),topics).passed,true);
  const adjacent=assessment(70,{match:'adjacent'});adjacent.comparison.differences[0].dimension='coverage';assert.throws(()=>validateAssessment(adjacent,topics),/adjacent/);
  const unavailable=assessment(70,{available:false});assert.equal(validateAssessment(unavailable,topics).passed,true);
  for(const change of [r=>r.comparison.references[0].fulltext='unavailable',r=>r.comparison.differences[0].referenceLocation='',r=>r.suggestions.manager[0].attribution='certain',r=>r.suggestions.manager[0].differenceId='unknown']){
    const r=assessment(70);change(r);assert.throws(()=>validateAssessment(r,topics));
  }
});
test('snapshot, Markdown advice, idempotent passing delivery and read-only status',t=>{
  const {root}=setup(t),before=fs.readFileSync(statePath(root));
  const c=submitAndRecord(root,assessment(70));assert.equal(c.status,'passed');
  const dir=path.join(root,'paper/reviews/submission-0001');
  for(const f of ['assessment.json','assessment.md','comparison.md','scoper.md','manager.md','worker.md','snapshot/paper/main.pdf','snapshot/papers','research-state.json'])assert.ok(fs.existsSync(path.join(dir,f)),f);
  assert.match(fs.readFileSync(path.join(dir,'manager.md'),'utf8'),/hypothesis/);
  assert.match(fs.readFileSync(path.join(dir,'worker.md'),'utf8'),/No evidence-backed/);
  const saved=fs.readFileSync(path.join(root,'.slr/final-review.json'));
  assert.equal(finalReviewStatus(root).complete,true);assert.deepEqual(fs.readFileSync(path.join(root,'.slr/final-review.json')),saved);
  assert.equal(control(root,'submit').submissions.length,1);assert.deepEqual(fs.readFileSync(statePath(root)),before);
});
test('stale manuscript, evidence and PDF cannot inherit acceptance',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(70));
  fs.appendFileSync(path.join(root,'paper/main.tex'),'\n% change');assert.equal(finalReviewStatus(root).complete,false);
  assert.throws(()=>control(root,'submit'),/PDF/);mockCompile(root);
  const second=control(root,'submit');assert.equal(second.submissions.length,2);assert.equal(second.status,'awaiting_review');
  const p=Object.values(loadState(root).papers)[0];fs.appendFileSync(path.join(root,`papers/${p.id}/note.md`),'tamper');
  assert.equal(finalReviewStatus(root).current,false);assert.throws(()=>reviewInputs(root),/changed|stale/);
});
test('missing reference stays pending; comparison retry appends an immutable attempt',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(70,{available:false}));assert.equal(finalReviewStatus(root).complete,false);
  const old=fs.readFileSync(path.join(root,'paper/reviews/submission-0001/assessment.json'));
  const c=control(root,'retry-comparison');assert.equal(c.submissions.length,2);assert.equal(c.status,'awaiting_review');
  submitAndRecord(root,assessment(70));assert.equal(finalReviewStatus(root).complete,true);
  assert.deepEqual(fs.readFileSync(path.join(root,'paper/reviews/submission-0001/assessment.json')),old);
});
test('controlled revision has independent one-round budget and restricted topic/task scope',t=>{
  const {root}=setup(t),s=loadState(root);s.currentRound=s.maxRounds;s.consecutiveLowYieldRounds=2;atomicJSON(statePath(root),s);
  submitAndRecord(root,assessment(69));control(root,'begin-revision');
  assert.equal(loadState(root).topics[1].status,'completed');assert.equal(loadState(root).topics[0].status,'revision');
  assert.throws(()=>mutate(root,'review-topic',{topicId:'generation'}),/outside assigned/);
  mutate(root,'begin-round');assert.equal(loadState(root).currentRound,5);assert.equal(loadState(root).revisionContext.roundsUsed,1);
  assert.throws(()=>mutate(root,'reserve',{topicId:'retrieval',taskId:'first'}),/outside assigned/);
  mutate(root,'end-round');assert.throws(()=>mutate(root,'begin-round'),/budget exhausted/);
  finishRevision(root);assert.deepEqual(validateV2(loadState(root)),[]);assert.equal(loadState(root).consecutiveLowYieldRounds,2);
  submitAndRecord(root,assessment(70,{priorIssues:assessment(69).issues}));assert.equal(finalReviewStatus(root).complete,true);
});
test('shared-paper supplement expands authorization and forces all affected chapter checks',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(69));control(root,'begin-revision');mutate(root,'begin-round');
  const p=Object.values(loadState(root).papers)[0];mutate(root,'supplement',{paperId:p.id,reason:'Review identified missing comparison conditions',taskId:'repair-conditions'});
  assert.deepEqual(new Set(loadState(root).revisionContext.topicIds),new Set(topics));assert.ok(loadState(root).topics.every(t=>t.status==='revision'));
  assert.throws(()=>review(root,'generation'),/unaccepted/);
  mutate(root,'reserve',{topicId:'retrieval',taskId:'repair-conditions',leaseId:'repair'});
  fs.appendFileSync(path.join(root,`papers/${p.id}/note.md`),'\nVerified condition fixture supplement.');
  mutate(root,'finish-read',{leaseId:'repair'});mutate(root,'accept-paper',{paperId:p.id,checked:true,rationale:'Fixture reacceptance'});
  finishRevision(root);submitAndRecord(root,assessment(70,{priorIssues:assessment(69).issues}));assert.equal(finalReviewStatus(root).complete,true);
});
test('three failing reassessments pause; continuation retains cumulative history',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(60));
  for(let n=1;n<=3;n++) {control(root,'begin-revision');finishRevision(root,n);submitAndRecord(root,assessment(60,{priorIssues:assessment(60).issues}));}
  const c=finalReviewStatus(root);assert.equal(c.status,'paused');assert.equal(c.revisions.filter(r=>r.assessed).length,3);assert.equal(c.submissions.length,4);
  assert.throws(()=>control(root,'begin-revision'),/failed assessment/);assert.throws(()=>control(root,'resume',{prerequisiteRestored:true}),/user continuation/);
  control(root,'resume',{explicitUserContinue:true,userMessage:'Continue another batch'});control(root,'begin-revision');finishRevision(root,4);
  submitAndRecord(root,assessment(70,{priorIssues:assessment(60).issues}));assert.equal(finalReviewStatus(root).complete,true);assert.equal(finalReviewStatus(root).revisions.length,4);
});
test('tool pause preserves repair budget and blocks writes until recovery',t=>{
  const {root,project}=setup(t);submitAndRecord(root,assessment(60));control(root,'begin-revision');mutate(root,'bind',{agentId:'m',role:'manager',topicId:'retrieval'});
  mutate(root,'begin-round');control(root,'pause',{kind:'compile',reason:'Compiler unavailable after stopped workers'});
  assert.throws(()=>mutate(root,'end-round'),/paused/);assert.throws(()=>control(root,'resume',{}),/prerequisite/);
  assert.equal(evaluateHook({project_dir:project,agent_type:'slr-manager',agent_id:'m',tool_name:'Write',tool_input:{file_path:path.join(root,'topics/retrieval/chapter.md')}}).allowed,false);
  control(root,'resume',{prerequisiteRestored:true});assert.equal(loadState(root).revisionContext.roundsUsed,1);
  assert.equal(finalReviewStatus(root).revisions.filter(r=>r.assessed).length,0);finishRevision(root);
});
test('Reviewer can retrieve only when bound, never write/delegate or run arbitrary shell',t=>{
  const {root,project}=setup(t);control(root,'submit');control(root,'bind',{agentId:'r'});
  const hook=(tool,args={},id='r')=>evaluateHook({project_dir:project,agent_type:'slr-harness:slr-reviewer',agent_id:id,tool_name:tool,tool_input:args}).allowed;
  for(const tool of ['Read','WebSearch','WebFetch','mcp__papers__search_papers'])assert.equal(hook(tool),true,tool);
  assert.equal(hook('Bash',{command:'paper-search sources'}),true);
  for(const tool of ['Write','Edit','Agent','Skill','mcp__papers__delete'])assert.equal(hook(tool,{file_path:path.join(root,'paper/main.tex')}),false,tool);
  assert.equal(hook('Bash',{command:'node scripts/final-review.mjs record x'}),false);
  assert.equal(hook('WebSearch',{},'unbound'),false);
});
test('legacy review refuses mutation and snapshot needs successful compilation',t=>{
  const {root}=setup(t),s=loadState(root);s.schemaVersion=1;atomicJSON(statePath(root),s);const before=fs.readFileSync(statePath(root));
  assert.throws(()=>control(root,'submit'),/legacy/);assert.deepEqual(fs.readFileSync(statePath(root)),before);assert.equal(fs.existsSync(path.join(root,'.slr/final-review.json')),false);
});
test('reassessment must check previous issues and cannot overwrite earlier result',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(60));control(root,'begin-revision');finishRevision(root);
  const c=control(root,'submit'),s=c.submissions.at(-1);control(root,'bind',{agentId:'r'});
  const args={submissionId:s.id,fingerprint:s.fingerprint,reviewerId:'r',report:assessment(70)};
  assert.throws(()=>control(root,'record',args),/every prior issue/);
  args.report=assessment(70,{priorIssues:assessment(60).issues});control(root,'record',args);
  args.report=assessment(80,{priorIssues:assessment(60).issues});assert.throws(()=>control(root,'record',args),/immutable/);
});
test('global issues require coordinating Manager and scope issues never silently expand scope',t=>{
  const {root}=setup(t);const r=assessment(69);r.issues[0].kind='global';r.issues[0].topicIds=[];submitAndRecord(root,r);
  assert.throws(()=>control(root,'begin-revision'),/coordinating/);control(root,'begin-revision',{coordinatorTopicId:'evaluation'});
  assert.deepEqual(loadState(root).revisionContext.topicIds,['evaluation']);
});

test('scope changes pause without rewriting approved scope',t=>{
  const {root}=setup(t),original=fs.readFileSync(path.join(root,'SCOPE_ORIGINAL.md'));
  const r=assessment(69);r.issues[0].kind='scope';submitAndRecord(root,r);
  assert.throws(()=>control(root,'begin-revision'),/scope change/);
  control(root,'pause',{kind:'scope',reason:'Requested scope expansion requires a separately approved review'});
  assert.throws(()=>control(root,'resume',{prerequisiteRestored:true}),/user continuation/);
  control(root,'resume',{explicitUserContinue:true,userMessage:'Keep the approved scope and qualify the coverage claims'});
  control(root,'begin-revision',{coordinatorTopicId:'retrieval',scopeResolution:{withinApprovedScope:true,explicitUserDecision:true,userMessage:'Keep the approved scope and qualify the coverage claims',action:'Narrow the unsupported completeness claim'}});
  assert.deepEqual(fs.readFileSync(path.join(root,'SCOPE_ORIGINAL.md')),original);
});
test('persisted repair intent recovers interrupted reopen without resetting work',t=>{
  const {root}=setup(t),original=loadState(root);submitAndRecord(root,assessment(69));control(root,'begin-revision');
  atomicJSON(statePath(root),original);control(root,'begin-revision');assert.equal(loadState(root).revisionContext.active,true);
  mutate(root,'begin-round');control(root,'begin-revision');assert.equal(loadState(root).revisionContext.roundsUsed,1);
  assert.equal(finalReviewStatus(root).revisions.length,1);
});
test('repair round still enforces nine slots and two attempts, preserving untouched topics',t=>{
  const {root,project}=setup(t);submitAndRecord(root,assessment(69));control(root,'begin-revision');mutate(root,'begin-round');
  mutate(root,'plan',{topicId:'retrieval',tasks:Array.from({length:10},(_,n)=>({id:`repair-${n}`,question:'New gap',boundary:'Test gap',rationale:'Final assessment evidence request'}))});
  for(let n=0;n<9;n++)mutate(root,'reserve',{topicId:'retrieval',taskId:`repair-${n}`,leaseId:`l-${n}`});
  assert.throws(()=>mutate(root,'reserve',{topicId:'retrieval',taskId:'repair-9'}),/slot/);
  mutate(root,'fail',{leaseId:'l-0',reason:'Stopped transport'});mutate(root,'reserve',{topicId:'retrieval',taskId:'repair-0',leaseId:'retry'});
  mutate(root,'fail',{leaseId:'retry',reason:'Stopped transport'});
  assert.equal(loadState(root).topics[0].tasks.find(x=>x.id==='repair-0').status,'blocked');
  mutate(root,'bind',{agentId:'unaffected',role:'manager',topicId:'generation'});
  assert.equal(evaluateHook({project_dir:project,agent_type:'slr-manager',agent_id:'unaffected',tool_name:'Write',tool_input:{file_path:path.join(root,'topics/generation/chapter.md')}}).allowed,false);
});
test('comparison retry recovers an interrupted copy and does not count as a quality revision',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(70,{available:false}));
  const base=path.join(root,'paper/reviews'),target=path.join(base,'submission-0002');fs.mkdirSync(target);
  fs.copyFileSync(path.join(base,'submission-0001/manifest.json'),path.join(target,'manifest.json'));
  control(root,'retry-comparison');submitAndRecord(root,assessment(70));
  assert.equal(finalReviewStatus(root).complete,true);assert.equal(finalReviewStatus(root).revisions.length,0);
});
test('frozen snapshot tampering invalidates delivery even when live sources are unchanged',t=>{
  const {root}=setup(t);submitAndRecord(root,assessment(70));
  fs.appendFileSync(path.join(root,'paper/reviews/submission-0001/snapshot/paper/main.tex'),'tamper');
  assert.equal(finalReviewStatus(root).complete,false);assert.match(finalReviewStatus(root).error,/snapshot changed/);
  assert.throws(()=>control(root,'submit'),/snapshot changed/);
});
