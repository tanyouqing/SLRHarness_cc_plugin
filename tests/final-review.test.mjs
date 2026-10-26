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

test('six dimensions use exact IDs, integer scores and 69/70 threshold without critical veto',()=>{
  assert.deepEqual(validateAssessment(assessment(69),topics),{total:69,passed:false});
  const passed=assessment(70);passed.issues=assessment(69).issues;
  assert.deepEqual(validateAssessment(passed,topics),{total:70,passed:true});
  for(const change of [r=>r.items.pop(),r=>r.items[0].score=1.5,r=>r.items[0].score=16,r=>r.items[0].id=r.items[1].id,r=>r.total++,r=>r.passed=true,r=>r.items[0].evidence='',r=>r.issues=[]]) {
    const r=assessment(69);change(r);assert.throws(()=>validateAssessment(r,topics));
  }
});
test('reference matching, source locations, attribution and empty experiences',()=>{
  for(const match of ['same','overlapping','adjacent'])assert.equal(validateAssessment(assessment(70,{match}),topics).passed,true);
  const adjacent=assessment(70,{match:'adjacent'});adjacent.comparison.differences[0].dimension='coverage';assert.throws(()=>validateAssessment(adjacent,topics),/adjacent/);
  const unavailable=assessment(70,{available:false});assert.equal(validateAssessment(unavailable,topics).passed,true);
  for(const change of [r=>r.comparison.references[0].fulltext='unavailable',r=>r.comparison.differences[0].referenceLocation='']){
    const r=assessment(70);change(r);assert.throws(()=>validateAssessment(r,topics));
  }
});
test('snapshot, unified JSON experience, idempotent passing delivery and read-only status',t=>{
  const {root}=setup(t),before=fs.readFileSync(statePath(root));
  const c=submitAndRecord(root,assessment(70));assert.equal(c.status,'passed');
  const dir=path.join(root,'paper/reviews/submission-0001');
  for(const f of ['assessment.json','assessment.md','comparison.md','experiences.json','snapshot/paper/main.pdf','snapshot/papers','research-state.json'])assert.ok(fs.existsSync(path.join(dir,f)),f);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'experiences.json'),'utf8')),{experiences:assessment(70).experiences});
  assert.equal(fs.existsSync(path.join(dir,'experience.md')),false);
  for(const role of ['scoper','manager','worker','paper'])assert.equal(fs.existsSync(path.join(dir,`${role}.md`)),false);
  const saved=fs.readFileSync(path.join(root,'.slr/final-review.json'));
  assert.equal(finalReviewStatus(root).complete,true);assert.deepEqual(fs.readFileSync(path.join(root,'.slr/final-review.json')),saved);
  assert.equal(control(root,'submit').submissions.length,1);assert.deepEqual(fs.readFileSync(statePath(root)),before);
});

test('minimal four-field experience is preserved, optional fields survive and legacy Markdown is untouched',t=>{
  const report=assessment(70);report.experiences=[
    {sourceType:'review',role:'worker',executionSummary:'The manuscript does not identify dataset versions.',strategy:'Record dataset versions alongside metrics and experimental settings.'},
    {sourceType:'review',role:'paper',executionSummary:'The manuscript ranks results collected under different conditions.',strategy:'Separate incompatible comparison settings and avoid a unified ranking.',stage:null,task:'',applicability:null}
  ];
  assert.equal(validateAssessment(report,topics).passed,true);
  for(const change of [r=>delete r.experiences,r=>r.experiences[0].role='reviewer',r=>r.experiences[0].sourceType='trajectory',r=>r.experiences[0].strategy='',r=>r.experiences[0].executionSummary=' ',r=>r.experiences[0].stage=42,r=>r.suggestions={}]) {
    const invalid=structuredClone(report);change(invalid);assert.throws(()=>validateAssessment(invalid,topics));
  }
  const {root}=setup(t);const sub=control(root,'submit').submissions.at(-1);
  const dir=path.join(root,'paper/reviews',sub.id),old=path.join(dir,'experience.md');
  fs.writeFileSync(old,'Historical Markdown retained.');submitAndRecord(root,report);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'experiences.json'),'utf8')),{experiences:report.experiences});
  assert.equal(fs.readFileSync(old,'utf8'),'Historical Markdown retained.');
  const before=fs.readFileSync(path.join(dir,'experiences.json'));control(root,'submit');
  assert.deepEqual(fs.readFileSync(path.join(dir,'experiences.json')),before);
});

test('unsupported or unavailable comparison emits empty experiences without fabricated roles',t=>{
  const report=assessment(70,{available:false});report.experiences=assessment(70).experiences;
  assert.throws(()=>validateAssessment(report),/completed reference comparison/);
  report.experiences=[];const {root}=setup(t);submitAndRecord(root,report);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'paper/reviews/submission-0001/experiences.json'),'utf8')),{experiences:[]});
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
  assert.equal(fs.existsSync(path.join(root,'paper/reviews/submission-0002/experiences.json')),false);
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
  for(const tool of ['WebSearch','WebFetch','mcp__papers__search_papers'])assert.equal(hook(tool),true,tool);
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


test('Reviewer reads manuscript and reference surveys but not research process artifacts',t=>{
  const {root,project}=setup(t),c=control(root,'submit'),sub=c.submissions.at(-1);
  control(root,'bind',{agentId:'reader'});
  const base=path.join(root,'paper/reviews',sub.id);
  const hook=(tool_name,tool_input)=>evaluateHook({project_dir:project,agent_type:'slr-reviewer',agent_id:'reader',tool_name,tool_input}).allowed;
  for(const name of ['snapshot/SCOPE.md','snapshot/paper/main.tex','snapshot/paper/references.bib','snapshot/paper/main.pdf','prior-issues.json','references/survey.pdf','manuscript-pages/page-1.png'])
    assert.equal(hook('Read',{file_path:path.join(base,name),...(name.endsWith('.pdf')?{pages:'1'}:{})}),true,name);
  for(const name of ['SCOPE.md','topics/retrieval/chapter.md','topics/retrieval/synthesis.md','.slr/state.json','paper/main.tex'])
    assert.equal(hook('Read',{file_path:path.join(root,name)}),false,name);
  for(const name of ['snapshot/SCOPE_ORIGINAL.md','snapshot/scoping.md','research-state.json','manifest.json','snapshot/papers/p1/note.md','snapshot/papers/p1/metadata.json'])
    assert.equal(hook('Read',{file_path:path.join(base,name)}),false,name);
  assert.equal(hook('Grep',{pattern:'.',path:root}),false);
  assert.equal(hook('Glob',{pattern:'**/*',path:path.join(base,'snapshot')}),false);
  assert.equal(hook('Read',{}),false);
  assert.equal(hook('Glob',{pattern:'../../snapshot/topics/**/*',path:path.join(base,'references')}),false);
  assert.equal(hook('Grep',{pattern:'claim',path:path.join(base,'snapshot/paper/main.tex')}),true);
});

test('main routes manuscript-only issues without rewriting the Reviewer assessment',t=>{
  const {root}=setup(t),r=assessment(69);r.issues[0].topicIds=[];
  submitAndRecord(root,r);
  assert.throws(()=>control(root,'begin-revision'),/main must route/);
  assert.throws(()=>control(root,'begin-revision',{issueRoutes:[{issueId:r.issues[0].id,topicIds:['unknown'],reason:'Wrong route'}]}),/invalid.*route/);
  control(root,'begin-revision',{issueRoutes:[{issueId:r.issues[0].id,topicIds:['retrieval'],reason:'Issue location maps to retrieval chapter'}]});
  assert.deepEqual(loadState(root).revisionContext.topicIds,['retrieval']);
  assert.deepEqual(finalReviewStatus(root).submissions[0].assessment.issues[0].topicIds,[]);
  finishRevision(root);const next=control(root,'submit').submissions.at(-1);
  const prior=JSON.parse(fs.readFileSync(path.join(root,'paper/reviews',next.id,'prior-issues.json'),'utf8'));
  assert.equal(prior[0].id,r.issues[0].id);assert.equal(prior[0].topicIds,undefined);
});


test('six dimension maxima, IDs and malformed scores are checked independently',()=>{
  const maxima={coverage:15,taxonomy:15,evidence:25,synthesis:20,critique:15,presentation:10};
  const perfect=assessment(100);assert.deepEqual(Object.fromEntries(perfect.items.map(i=>[i.id,i.score])),maxima);
  assert.equal(validateAssessment(perfect).total,100);
  for(let index=0;index<6;index++)for(const invalid of [-1,0.5,maxima[perfect.items[index].id]+1]) {
    const bad=structuredClone(perfect);bad.items[index].score=invalid;bad.total=bad.items.reduce((n,i)=>n+i.score,0);bad.passed=bad.total>=70;
    assert.throws(()=>validateAssessment(bad),/invalid rubric item/);
  }
  const wrong=structuredClone(perfect);wrong.items[0].id='coverage.scope';assert.throws(()=>validateAssessment(wrong));
  assert.throws(()=>validateAssessment({...perfect,rubricVersion:'unknown'}),/unsupported/);
  const oversized=structuredClone(perfect);oversized.items=Array.from({length:20},()=>({...perfect.items[0],score:5}));
  assert.throws(()=>validateAssessment(oversized),/exactly 6/);
});

test('approved scope must match both immutable original and approval hash without silent edits',t=>{
  const {root}=setup(t),scope=path.join(root,'SCOPE.md'),original=path.join(root,'SCOPE_ORIGINAL.md');
  const bytes=fs.readFileSync(scope),stateBefore=fs.readFileSync(statePath(root));
  fs.appendFileSync(scope,'\nChanged boundary');assert.throws(()=>control(root,'submit'),/approved scope mismatch/);
  assert.deepEqual(fs.readFileSync(original),bytes);assert.deepEqual(fs.readFileSync(statePath(root)),stateBefore);
  fs.copyFileSync(scope,original);assert.throws(()=>control(root,'submit'),/approved scope mismatch/);
  fs.writeFileSync(scope,bytes);fs.writeFileSync(original,bytes);submitAndRecord(root,assessment(70));
  assert.equal(finalReviewStatus(root).complete,true);fs.appendFileSync(scope,'\nLater change');
  assert.equal(finalReviewStatus(root).complete,false);assert.match(finalReviewStatus(root).error,/approved scope mismatch/);
});

test('restoring scope coverage is ordinary repair and six-dimensional report shows actual maxima',t=>{
  const {root}=setup(t),failed=assessment(69);failed.issues[0].topicIds=[];
  failed.issues[0].location='SCOPE.md research line 1; manuscript Section 4';
  failed.issues[0].action='Restore the omitted comparison inside the approved boundary';
  const c=submitAndRecord(root,failed);const rendered=fs.readFileSync(path.join(root,'paper/reviews',c.submissions[0].id,'assessment.md'),'utf8');
  assert.match(rendered,/coverage: 15\/15/);assert.match(rendered,/evidence: 25\/25/);
  const scope=fs.readFileSync(path.join(root,'SCOPE.md'));
  control(root,'begin-revision',{issueRoutes:[{issueId:'issue-1',topicIds:['retrieval'],reason:'Restore approved research line'}]});
  assert.equal(loadState(root).revisionContext.active,true);assert.deepEqual(fs.readFileSync(path.join(root,'SCOPE.md')),scope);
});
