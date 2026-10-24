import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState,validateV2,transition,mutate,loadState,statePath,atomicJSON} from '../scripts/pipeline.mjs';
import {normalizeResearchProfile,researchScale,scaleCompletion} from '../scripts/research-profile.mjs';
import {researchSummary} from '../scripts/bounded-output.mjs';
import {contextControl,recoverySummary} from '../scripts/context-control.mjs';
import {managerControl} from '../scripts/manager-control.mjs';
import {citedPaperKeys,buildPaper,paperStatus} from '../scripts/paper-build.mjs';
import {seed,planRound,discover,finishReading,complete,manuscript,topics,write} from '../evals/fixture-lib.mjs';

const profile=(tier,targetPapers)=>normalizeResearchProfile({tier,source:'explicit',rationale:'User explicitly selected this setting.',...(targetPapers?{targetPapers,targetSource:'explicit'}:{})});
const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function root(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'slr-scale-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return path.join(base,'fixture-review');}

test('tier defaults and explicit counts preserve all execution budgets',()=>{
  for(const [tier,count] of [['low',30],['medium',60],['high',90]]) {
    const s=createState({reviewId:'test',topic:'Test',researchProfile:profile(tier)});
    assert.equal(s.researchProfile.targetPapers,count);assert.equal(s.maxRounds,5);assert.equal(s.maxWorkers,9);assert.equal(s.retryLimit,2);assert.deepEqual(validateV2(s),[]);
  }
  assert.equal(createState({reviewId:'test',topic:'Test'}).researchProfile.targetPapers,60);
  assert.equal(profile('high',12).targetPapers,12);
  assert.throws(()=>normalizeResearchProfile({tier:'high',source:'inferred'}),/rationale/);
  for(const input of [{tier:'ultra'},{targetPapers:31},{targetPapers:0,targetSource:'explicit'},{targetPapers:1.5,targetSource:'explicit'},{source:'conflict',tier:'high'},{rationale:'x'.repeat(1001)}])assert.throws(()=>normalizeResearchProfile(input));
});

test('profile editable only before approval and survives recovery without inference',t=>{
  const r=root(t);seed(r,{approved:false});
  assert.throws(()=>mutate(r,'configure-research',{}),/explicitly/);
  mutate(r,'configure-research',{researchProfile:profile('low')});
  assert.equal(loadState(r).researchProfile.targetPapers,30);
  contextControl(r,'enable');const bytes=fs.readFileSync(statePath(r));
  assert.equal(recoverySummary(r).researchScale.profile.tier,'low');assert.deepEqual(fs.readFileSync(statePath(r)),bytes);
  const s=loadState(r);s.stage='researching';s.approval={scopeHash:'fixture'};
  assert.throws(()=>transition(s,'configure-research',{researchProfile:profile('high')},r),/frozen/);
  s.researchProfile.targetPapers=-1;assert.ok(validateV2(s).length);
});

test('shared discovery, pending reading and acceptance use one global counter',t=>{
  const r=root(t);seed(r);planRound(r);
  for(const id of topics)discover(r,id);
  let scale=researchScale(loadState(r));assert.equal(scale.registered,1);assert.equal(scale.shared,1);assert.equal(scale.pending,1);assert.equal(scale.accepted,0);assert.equal(scale.remainingAfterPending,59);
  finishReading(r,topics[0]);scale=researchScale(loadState(r));assert.equal(scale.accepted,1);assert.equal(scale.pending,0);assert.equal(scale.remaining,59);
  for(const id of topics.slice(1))finishReading(r,id);
  assert.equal(researchScale(loadState(r)).accepted,1);
});

test('three Managers see the same aggregate target and cannot change it',t=>{
  const r=root(t);seed(r);planRound(r);contextControl(r,'enable');discover(r,topics[0]);
  for(const id of topics) {
    mutate(r,'bind',{agentId:`manager-${id}`,role:'manager',topicId:id});
    const file=`topics/${id}/requests/scale.json`;
    write(r,file,JSON.stringify({requestId:'scale',action:'query',args:{collection:'scale'}}));
    const before=fs.readFileSync(statePath(r)),out=managerControl(r,`manager-${id}`,file);
    assert.equal(out.researchScale.profile.targetPapers,60);assert.equal(out.researchScale.remainingAfterPending,59);assert.deepEqual(fs.readFileSync(statePath(r)),before);
    write(r,file,JSON.stringify({requestId:'scale',action:'configure-research',args:{researchProfile:profile('high')}}));
    assert.throws(()=>managerControl(r,`manager-${id}`,file),/invalid Manager request/);
  }
});

test('pending target attainment requires a gap rationale, never cancels existing reading',t=>{
  const r=root(t);seed(r);planRound(r);discover(r,topics[0]);
  const s=loadState(r);s.researchProfile=profile('low',1);
  const task={id:'gap',question:'Check another method',boundary:'One evidenced gap'};
  assert.throws(()=>transition(s,'plan',{topicId:topics[1],tasks:[task]},r),/gap rationale/);
  const next=transition(s,'plan',{topicId:topics[1],tasks:[{...task,rationale:'Resolve a missing comparison condition.'}]},r);
  assert.equal(next.topics[0].tasks[0].phase,'read');assert.equal(next.topics[0].tasks[0].status,'pending');
  assert.equal(next.topics[1].tasks.at(-1).rationale,'Resolve a missing comparison condition.');
});

test('count deviations need explanations but never demand padding or bypass Checker',t=>{
  const r=root(t);const s=complete(r);
  assert.equal(s.scaleCompletion.accepted,1);assert.equal(s.scaleCompletion.difference,-59);assert.match(s.scaleCompletion.reason,/Synthetic/);
  assert.throws(()=>scaleCompletion(s),/scaleReason/);
  const over={...s,researchProfile:profile('high',1),papers:{a:{status:'final'},b:{status:'final'}}};
  assert.equal(scaleCompletion(over,'Necessary evidence gap beyond the requested target.').difference,1);
  const high={...s,researchProfile:profile('high'),papers:Object.fromEntries(Array.from({length:95},(_,i)=>[i,{status:'final'}]))};
  assert.equal(scaleCompletion(high,'Additional method families needed comparison evidence.').difference,5);
  assert.equal(scaleCompletion({...s,researchProfile:profile('medium',1)}).difference,0);
  const unfinished={...s,stage:'researching',researchProfile:profile('low',1),topics:s.topics.map(t=>({...t,status:'review'}))};
  assert.throws(()=>transition(unfinished,'finalize',{scaleReason:'Already at target'},r),/chapters/);
});

test('historical schema 2 stays without target through context enable and mutation',t=>{
  const r=root(t);seed(r);const s=loadState(r);delete s.researchProfile;atomicJSON(statePath(r),s);
  const before=fs.readFileSync(statePath(r));assert.equal(researchSummary(loadState(r)).researchScale.profile,null);assert.deepEqual(fs.readFileSync(statePath(r)),before);
  contextControl(r,'enable');mutate(r,'begin-round');
  assert.equal(loadState(r).researchProfile,undefined);assert.equal(recoverySummary(r).researchScale.remaining,null);assert.deepEqual(validateV2(loadState(r)),[]);
});

test('large registries keep control/recovery summaries bounded',()=>{
  const s=createState({reviewId:'test',topic:'Test'});
  for(let i=0;i<12000;i++)s.papers[`p-${i}`]={status:i%2?'final':'pending',topicIds:['a','b']};
  const summary=researchSummary(s);assert.equal(summary.researchScale.accepted,6000);assert.equal(summary.researchScale.pending,6000);assert.ok(JSON.stringify(summary).length<8000);
});

test('citation counts exclude search hits, repeated cites, comments and unused bibliography',t=>{
  assert.deepEqual([...citedPaperKeys(String.raw`\citet{a} \citep[see][p. 2]{a,b} % \citep{ignored}
\citep*{b}`)],['a','b']);
  const r=root(t);complete(r);const dir=manuscript(r);
  const run=(cmd,args)=>{const out=args.find(a=>a.startsWith('-outdir=')).slice(8);fs.writeFileSync(path.join(out,'main.pdf'),'%PDF-1.4 fixture');fs.writeFileSync(path.join(out,'main.log'),'');return {status:0};};
  assert.equal(buildPaper(dir,{run}).citedPaperCount,1);assert.equal(paperStatus(dir).citedPaperCount,1);
  fs.appendFileSync(path.join(dir,'main.tex'),'\n% changed');assert.equal(paperStatus(dir).citedPaperCount,null);
});

test('semantic eval expected profiles are valid inputs, not measured model classifications',()=>{
  const cases=JSON.parse(fs.readFileSync(path.join(plugin,'evals/research-tiers/cases.json'),'utf8'));
  for(const c of cases) {
    const p=normalizeResearchProfile({...c.expected,rationale:`Expected eval setting for ${c.id}; not a model output.`});
    assert.equal(p.targetPapers,c.expected.targetPapers);
  }
  for(const id of ['negation','modifier','quoted','tier-priority','explicit-count','conflict'])assert.ok(cases.some(c=>c.id===id));
});

test('active prompts share tier contract and retain scope approval and quality checks',()=>{
  for(const f of ['agents/slr-scoper.md','agents/slr-manager.md','agents/slr-worker.md','skills/review/SKILL.md','skills/review/references/workflow.md','skills/review/references/scoping.md']) {
    const text=fs.readFileSync(path.join(plugin,f),'utf8');assert.match(text,/research-scale\.md/);
    assert.doesNotMatch(text,/There is no default (?:target|paper-count target)|Do not impose a default target/);
  }
  const contract=fs.readFileSync(path.join(plugin,'skills/review/references/research-scale.md'),'utf8');
  assert.match(contract,/Scope human\s+approval remains mandatory/);assert.match(contract,/Five initial rounds, nine concurrent Workers/);
  assert.match(contract,/soft target, not a scoring|must not deduct points solely/);
});
