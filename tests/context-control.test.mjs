import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {seed,topics,complete,manuscript,record,candidate,chapter,review,write} from '../evals/fixture-lib.mjs';
import {assessment,mockCompile} from '../evals/final-review-lib.mjs';
import {loadState,mutate,atomicJSON,statePath,hash,paperControl} from '../scripts/pipeline.mjs';
import {researchSummary,researchQuery,reviewSummary,reviewQuery,readSlice} from '../scripts/bounded-output.mjs';
import {contextControl,checkpoint,recoverySummary} from '../scripts/context-control.mjs';
import {contextHook} from '../scripts/context-hook.mjs';
import {managerControl} from '../scripts/manager-control.mjs';
import {stageControl,stages,writerReady,reviewReady} from '../scripts/work-stages.mjs';
import {finalReviewControl as finalControl} from '../scripts/final-review.mjs';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';
const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function setup(t,finished=false) {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-context-')),root=path.join(project,'workspaces','fixture-review');
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  if(finished){complete(root);manuscript(root);}else seed(root);
  contextControl(root,'enable');return {project,root};
}
function request(root,topicId,requestId,action,args={}) {
  const relative=`topics/${topicId}/requests/${requestId}.json`;write(root,relative,JSON.stringify({requestId,action,args}));return relative;
}
const run=(root,topicId,id,action,args)=>managerControl(root,`m-${topicId}`,request(root,topicId,id,action,args));
const stopped={stopped:true,runtimeEvidence:'Synthetic runtime stopped event, not a real Agent run'};
function managers(root,count=1) {
  mutate(root,'begin-round');
  for(const id of topics) {
    mutate(root,'bind',{agentId:`m-${id}`,role:'manager',topicId:id});
    write(root,`topics/${id}/plan.json`,JSON.stringify({topicId:id,tasks:Array.from({length:count},(_,i)=>({id:`task-${i}`,question:'Fixture question',boundary:'Fixture boundary'}))}));
    run(root,id,'plan','plan');
  }
}
function finishWriter(root,prefix='writer',newRevision=false) {
  let n=0;
  do {
    const agentId=`${prefix}-${n++}`;paperControl(root,'bind-paper',{agentId,role:'paper'});
    const phase=stageControl(root,'writer-start',{agentId,newRevision:newRevision&&n===1,reason:'Synthetic revision'});
    write(root,'paper/writing-handoff.md',`# Fixture handoff\nPhase ${phase.phase}; inspect canonical accepted sources.`);
    stageControl(root,'writer-finish',{agentId,phase:phase.phase,inputHash:phase.inputHash,...stopped});
  } while(!writerReady(root));
}
function stagedAssessment(root,total,prefix,priorIssues=[]) {
  const sub=finalControl(root,'submit').submissions.at(-1);
  for(let i=0;;i++) {
    const agentId=`${prefix}-${i}`;finalControl(root,'bind',{agentId});
    const unit=stageControl(root,'review-start',{agentId,submissionId:sub.id});
    if(i===0){assert.equal(unit.id,'scope-1');assert.equal(unit.rubricVersion,'survey-2');assert.match(unit.scopePath,/snapshot\/SCOPE.md$/);assert.match(unit.rubricPath,/rubric.md$/);assert.equal(unit.inputPolicy,'scope-manuscript-v2');}
    write(root,unit.artifact,JSON.stringify(unit.id==='score'?{unitId:'score',submissionId:sub.id,fingerprint:sub.fingerprint,reviewerId:agentId,report:assessment(total,{priorIssues})}
      :{unitId:unit.id,fingerprint:sub.fingerprint,locations:['Synthetic section'],findings:'Synthetic control-flow evidence only'}));
    stageControl(root,'review-finish',{submissionId:sub.id,agentId,...stopped});
    if(unit.id==='score')break;
  }
  return finalControl(root,'record-file');
}

test('large registries/history have bounded summaries and complete pagination',t=>{
  const {root}=setup(t),s=loadState(root);
  s.papers=Object.fromEntries(Array.from({length:1000},(_,i)=>[`p-${i}`,{id:`p-${i}`,title:'x'.repeat(i===0?12000:80)}]));
  assert.ok(JSON.stringify(researchSummary(s)).length<=8000);
  let offset=0,seen=[];
  do {const p=researchQuery(s,{collection:'papers',offset});assert.ok(JSON.stringify(p).length<=8000);seen.push(...p.items.map(x=>x.id));offset=p.nextOffset;}while(offset!==null);
  assert.equal(new Set(seen).size,1000);
  const c={status:'passed',submissions:Array.from({length:400},(_,i)=>({id:`sub-${i}`,assessment:{total:70,issues:Array(50).fill({evidence:'x'.repeat(1000)}),comparison:{status:'complete'}}})),revisions:[]};
  assert.ok(JSON.stringify(reviewSummary(c)).length<=8000);
  assert.ok(JSON.stringify(reviewQuery(c,{collection:'issues'})).length<=8000);
  write(root,'long.md','A'.repeat(50000));assert.equal(readSlice(root,{file:'long.md'}).text.length,24000);
  assert.equal(readSlice(root,{file:'long.md',offset:48000}).nextOffset,null);
  assert.throws(()=>readSlice(root,{file:'../secret.md'}),/relative/);
});

test('Manager discovery, unique shared ownership, read delivery and acceptance stay local',t=>{
  const {root}=setup(t);managers(root);
  for(const id of topics) {
    const lease=run(root,id,'discover','reserve',{taskId:'task-0'});
    run(root,id,'bind','bind-worker',{leaseId:lease.leaseId,agentId:`w-${id}`});
    write(root,`topics/${id}/tasks/task-0/search.md`,'Synthetic discovery log');
    write(root,`topics/${id}/tasks/task-0/candidates.json`,JSON.stringify({candidates:[candidate]}));
    run(root,id,'found','finish-discovery',{leaseId:lease.leaseId,...stopped});
  }
  let s=loadState(root);assert.equal(Object.keys(s.papers).length,1);const p=Object.values(s.papers)[0];assert.equal(p.topicIds.length,3);
  const owner=p.owner.topicId,lease=run(root,owner,'read','reserve',{taskId:'task-0'});record(root,p);
  const delivery={processedPaperIds:[p.id],reusedPaperIds:[],remainingPaperIds:[p.id],missingEvidence:[],supplementRequests:[]};
  write(root,`topics/${owner}/tasks/task-0/result.json`,JSON.stringify(delivery));
  assert.throws(()=>run(root,owner,'done','finish-read',{leaseId:lease.leaseId,...stopped}),/partial/);
  delivery.remainingPaperIds=[];write(root,`topics/${owner}/tasks/task-0/result.json`,JSON.stringify(delivery));
  run(root,owner,'done','finish-read',{leaseId:lease.leaseId,...stopped});
  write(root,`topics/${owner}/acceptance.json`,JSON.stringify([{paperId:p.id,checked:true,rationale:'Synthetic evidence validation'}]));
  run(root,owner,'accept','accept-paper',{paperId:p.id});assert.equal(loadState(root).papers[p.id].status,'final');
  const sibling=run(root,'generation','reading','reserve',{taskId:'task-0'});
  mutate(root,'bind',{agentId:'checker',role:'checker'});chapter(root,owner);review(root,owner);
  const events=fs.readdirSync(path.join(root,'.slr/checkpoints')).map(f=>JSON.parse(fs.readFileSync(path.join(root,'.slr/checkpoints',f))));
  assert.ok(events.some(e=>e.kind===`topic:${owner}`));assert.equal(loadState(root).leases[sibling.leaseId].active,true);
  assert.throws(()=>run(root,'generation','foreign','accept-paper',{paperId:p.id}),/owning topic/);
  assert.throws(()=>run(root,owner,'scope','approve',{}),/action/);
});

test('existing workspaces opt in explicitly only after active leases resolve; legacy is unchanged',t=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-old-'));t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  const root=path.join(project,'fixture-review');seed(root);mutate(root,'begin-round');mutate(root,'plan',{topicId:'retrieval',tasks:[{id:'first',question:'Fixture',boundary:'Fixture'}]});
  mutate(root,'reserve',{topicId:'retrieval',taskId:'first',leaseId:'live'});
  const before=fs.readFileSync(statePath(root));contextControl(root,'summary');assert.deepEqual(fs.readFileSync(statePath(root)),before);
  assert.throws(()=>contextControl(root,'enable'),/active leases/);assert.equal(fs.existsSync(path.join(root,'.slr/context-policy.json')),false);
  mutate(root,'fail',{leaseId:'live',reason:'Synthetic stopped proof'});contextControl(root,'enable');assert.equal(loadState(root).currentRound,1);
  const s=loadState(root);s.schemaVersion=1;atomicJSON(statePath(root),s);assert.throws(()=>contextControl(root,'enable'),/legacy/);
});

test('CLI summaries omit registry bodies while explicit diagnostics and paged queries remain available',t=>{
  const {root}=setup(t);
  const command=path.join(plugin,'scripts/pipeline.mjs');
  const output=JSON.parse(execFileSync(process.execPath,[command,'status',root],{encoding:'utf8'}));
  assert.equal(output.stage,'researching');assert.equal(output.papers,undefined);assert.ok(JSON.stringify(output).length<8000);
  const full=JSON.parse(execFileSync(process.execPath,[command,'status',root,'--full'],{encoding:'utf8'}));assert.deepEqual(full.papers,{});
});

test('concurrent Manager processes share nine slots, retries and idempotent receipts',async t=>{
  const {root}=setup(t);managers(root,4);
  const jobs=topics.flatMap(id=>Array.from({length:4},(_,i)=>({id,file:request(root,id,`reserve-${i}`,'reserve',{taskId:`task-${i}`})})));
  await Promise.all(jobs.map(job=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(plugin,'scripts/manager-control.mjs'),root,`m-${job.id}`,job.file]);let text='';child.stdout.on('data',b=>text+=b);child.on('error',reject);child.on('exit',code=>code?reject(new Error(`manager exited ${code}`)):resolve(JSON.parse(text)));
  })));
  for(let pass=0;pass<4;pass++)for(const job of jobs)managerControl(root,`m-${job.id}`,job.file);
  let s=loadState(root);assert.equal(Object.values(s.leases).filter(l=>l.active).length,9);
  const own=Object.values(s.leases).find(l=>l.topicId==='retrieval'),task=s.topics[0].tasks.find(t=>t.id===own.taskId);
  const before=fs.readFileSync(statePath(root));managerControl(root,'m-retrieval',jobs.find(j=>j.id==='retrieval'&&j.file.endsWith(`${task.id.replace('task','reserve')}.json`)).file);assert.deepEqual(fs.readFileSync(statePath(root)),before);
  assert.throws(()=>run(root,'generation','foreign-lease','fail',{leaseId:own.id,reason:'bad',...stopped}),/outside/);
  assert.throws(()=>run(root,'retrieval','live','fail',{leaseId:own.id,reason:'bad'}),/stopped/);
  run(root,'retrieval','fail-1','fail',{leaseId:own.id,reason:'Fixture stopped',...stopped});
  const second=run(root,'retrieval','retry','reserve',{taskId:own.taskId});assert.ok(second.leaseId);
  run(root,'retrieval','fail-2','fail',{leaseId:second.leaseId,reason:'Fixture stopped again',...stopped});
  assert.equal(loadState(root).topics[0].tasks.find(t=>t.id===own.taskId).status,'blocked');
});

test('guard authenticates Manager helper, scoped messaging and bounded input',t=>{
  const {root,project}=setup(t);managers(root);const file=request(root,'retrieval','r','reserve',{});
  const hook=(id,tool,args)=>evaluateHook({project_dir:project,agent_type:'slr-manager',agent_id:id,tool_name:tool,tool_input:args});
  const command=`node "${plugin}/scripts/manager-control.mjs" "${root}" "m-retrieval" "${file}"`;
  assert.equal(hook('m-retrieval','Bash',{command}).allowed,true);
  assert.equal(hook('m-generation','Bash',{command}).allowed,false);
  const lease=managerControl(root,'m-retrieval',file);run(root,'retrieval','b','bind-worker',{leaseId:lease.leaseId,agentId:'w'});
  assert.equal(hook('m-retrieval','SendMessage',{to:'w',message:'Continue assigned task'}).allowed,true);
  assert.equal(hook('m-generation','SendMessage',{to:'w',message:'Continue'}).allowed,false);
  assert.equal(hook('m-retrieval','SubagentHandback',{message:'a'.repeat(8001)}).allowed,false);
  write(root,'large.md','a'.repeat(25000));assert.equal(hook('m-retrieval','Read',{file_path:path.join(root,'large.md')}).allowed,false);
  assert.equal(hook('m-retrieval','Read',{file_path:path.join(root,'x.pdf'),pages:'1-6'}).allowed,false);
  assert.equal(hook('m-retrieval','Read',{file_path:path.join(root,'x.pdf'),pages:'6-10'}).allowed,true);
});

test('scope checkpoint requires Git approval, topic checkpoints preserve live siblings and hooks are read-only at start',t=>{
  const {root,project}=setup(t);assert.throws(()=>contextControl(root,'checkpoint-scope'));
  execFileSync('git',['-C',root,'init'],{stdio:'pipe'});execFileSync('git',['-C',root,'add','SCOPE_ORIGINAL.md'],{stdio:'pipe'});
  execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','scope'],{stdio:'pipe'});
  const a=contextControl(root,'checkpoint-scope'),b=contextControl(root,'checkpoint-scope');assert.equal(a.checkpoint,b.checkpoint);
  managers(root);run(root,'retrieval','first-slot','reserve',{});const l=run(root,'generation','live','reserve',{}),before=fs.readFileSync(statePath(root));
  checkpoint(root,'topic:retrieval','synthetic-event');assert.deepEqual(fs.readFileSync(statePath(root)),before);
  assert.equal(loadState(root).leases[l.leaseId].active,true);
  contextHook({cwd:project,hook_event_name:'PreCompact'});
  const out=contextHook({cwd:project,hook_event_name:'SessionStart',source:'compact'});assert.ok(JSON.stringify(out).length<8000);
  assert.deepEqual(fs.readFileSync(statePath(root)),before);assert.match(recoverySummary(root).next,/runtime status/);
});

test('staged writer requires fresh serial IDs, preserves partials and invalidates stale sources',t=>{
  const {root,project}=setup(t,true);paperControl(root,'bind-paper',{agentId:'w1',role:'paper'});
  const p=stageControl(root,'writer-start',{agentId:'w1'});
  paperControl(root,'bind-paper',{agentId:'w2',role:'paper'});assert.throws(()=>stageControl(root,'writer-start',{agentId:'w2'}),/active/);
  const hook=id=>evaluateHook({project_dir:project,agent_type:'slr-paper-writer',agent_id:id,tool_name:'Write',tool_input:{file_path:path.join(root,'paper/main.tex')}});
  assert.equal(hook('w1').allowed,true);assert.equal(hook('w2').allowed,false);
  fs.appendFileSync(path.join(root,'paper/main.tex'),'\n% partial saved');
  stageControl(root,'writer-abandon',{agentId:'w1',reason:'Fixture stopped',...stopped});
  assert.match(fs.readFileSync(path.join(root,'paper/main.tex'),'utf8'),/partial saved/);
  assert.equal(mockCompile(root).status,'writing-incomplete');
  finishWriter(root);assert.equal(writerReady(root),true);assert.equal(mockCompile(root).status,'success');
  fs.appendFileSync(path.join(root,'paper/main.tex'),'\n% changed outside stages');assert.equal(writerReady(root),false);
  assert.equal(mockCompile(root).status,'writing-incomplete');assert.equal(hook('w1').allowed,false);
});

test('staged full review requires all unit artifacts and rejects mutation after scoring',t=>{
  const {root,project}=setup(t,true);finishWriter(root);assert.equal(mockCompile(root).status,'success');
  const c=finalControl(root,'submit'),sub=c.submissions.at(-1);let lastId;
  for(let i=0;;i++) {
    const agentId=`review-unit-${i}`;lastId=agentId;finalControl(root,'bind',{agentId});
    const unit=stageControl(root,'review-start',{agentId,submissionId:sub.id});
    if(i===0){assert.equal(unit.id,'scope-1');assert.equal(unit.rubricVersion,'survey-2');assert.match(unit.scopePath,/snapshot\/SCOPE.md$/);assert.match(unit.rubricPath,/rubric.md$/);assert.equal(unit.inputPolicy,'scope-manuscript-v2');
      assert.equal(evaluateHook({project_dir:project,agent_type:'slr-reviewer',agent_id:agentId,tool_name:'Read',tool_input:{file_path:path.join(root,unit.scopePath)}}).allowed,true);}
    const allow=(f)=>evaluateHook({project_dir:project,agent_type:'slr-reviewer',agent_id:agentId,tool_name:'Write',tool_input:{file_path:path.join(root,f)}}).allowed;
    assert.equal(allow(unit.artifact),true);assert.equal(allow('paper/main.tex'),false);
    if(unit.id==='score') {
      assert.throws(()=>finalControl(root,'record',{submissionId:sub.id,fingerprint:sub.fingerprint,reviewerId:agentId,report:assessment(70)}),/complete all/);
      write(root,unit.artifact,JSON.stringify({unitId:'score',submissionId:sub.id,fingerprint:sub.fingerprint,reviewerId:agentId,report:assessment(70)}));
    }else write(root,unit.artifact,JSON.stringify({unitId:unit.id,fingerprint:sub.fingerprint,locations:['Synthetic exact section'],findings:'Synthetic coverage assertion, not real review'}));
    stageControl(root,'review-finish',{submissionId:sub.id,agentId,...stopped});assert.equal(allow(unit.artifact),false);
    if(unit.id==='score')break;
  }
  assert.equal(reviewReady(root,sub.id,lastId),true);assert.equal(finalControl(root,'record-file').status,'passed');
  const unit=stages(root).reviews[sub.id].units[0];fs.appendFileSync(path.join(root,unit.artifact),' ');
  assert.equal(reviewReady(root,sub.id,lastId),false);assert.throws(()=>finalControl(root,'record-file'),/complete all/);
});

test('three-topic shared-paper fixture completes staged low-score repair without resetting budgets',t=>{
  const {root}=setup(t,true),initial=loadState(root);
  assert.equal(Object.keys(initial.papers).length,1);assert.equal(initial.topics[0].reviewAttempts,2);
  finishWriter(root,'initial');mockCompile(root);
  const failed=stagedAssessment(root,69,'first-review'),issues=failed.submissions.at(-1).assessment.issues;
  assert.equal(failed.status,'revision_required');finalControl(root,'begin-revision');mutate(root,'begin-round');
  fs.appendFileSync(path.join(root,'topics/retrieval/chapter.md'),'\nSynthetic repaired comparison conditions.');review(root,'retrieval');
  mutate(root,'end-round');mutate(root,'finalize',{scaleReason:'Synthetic control-flow fixture deliberately uses one shared paper; no real coverage claimed.'});assert.equal(loadState(root).currentRound,initial.currentRound);
  assert.equal(writerReady(root),false);finishWriter(root,'repair');mockCompile(root);
  const passed=stagedAssessment(root,70,'second-review',issues);assert.equal(passed.status,'passed');assert.equal(passed.submissions.length,2);
  assert.ok(fs.existsSync(path.join(root,'paper/reviews/submission-0001/assessment.json')));
  assert.equal(loadState(root).revisionContext.roundsUsed,1);
});
