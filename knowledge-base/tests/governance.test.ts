import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {feedbackSchema,expired,assertVersion,checkIdentity} from '../src/governance-domain.js';
import {govern} from '../src/agents.js';
import {processFeedback,governanceDependencies,reportFeedback,sweepInactive} from '../src/governance.js';
import {pool} from '../src/db.js';
import {search,claim,publish} from '../src/store.js';
const id='00000000-0000-4000-8000-000000000001';
const content={role:'worker',sourceType:'review',executionSummary:'Observed limited evidence',strategy:'Read source before relying on claims'};
const feedback={strategy_id:id,revision:1,suggested_status:'need_revised',reason:'Conflicts with required task',context:{runId:'run',agentId:'agent',role:'worker',task:'topic/task',situation:'specific conditions',action:'applied the advice',outcome:'failed validation',evidence:['task output rejects action']}};
test('feedback schema requires concrete evidence, revision and role; optional supplement stays optional',()=>{
  assert.equal(feedbackSchema.parse(feedback).related_feedback_id,undefined);
  for(const changed of [{revision:0},{suggested_status:'active'},{context:{...feedback.context,role:'reviewer'}},{context:{...feedback.context,evidence:[]}}])assert.throws(()=>feedbackSchema.parse({...feedback,...changed}));
});
test('inactivity anchor, exact day boundary, exemption, custom period and non-active states',()=>{
  const r={strategy_status:'active',activity_started_at:'2026-01-01T00:00:00Z'};
  const now=Date.parse(r.activity_started_at)+90*86400000;
  assert.equal(expired(r,now-1),false);assert.equal(expired(r,now),true);
  for(const patch of [{strategy_status:'disabled'},{strategy_status:'need_revised'},{inactivity_exempt:true},{inactivity_days:180},{last_retrieved_at:new Date(now-86400000).toISOString()}])assert.equal(expired({...r,...patch},now),false);
  assert.equal(expired({...r,activity_started_at:new Date(now).toISOString()},now),false);
});
test('optimistic state and content versions reject stale decisions; source identity stays fixed',()=>{
  const old={current_revision:2,status_version:4};assertVersion({...old},old);
  assert.throws(()=>assertVersion({...old,status_version:5},old),/reassessment/);
  assert.throws(()=>assertVersion({...old,current_revision:3},old),/reassessment/);
  checkIdentity(content,{...content,strategy:'fixed'});
  assert.throws(()=>checkIdentity(content,{...content,role:'manager'}));
});
async function execute(tool:any,args:any) {
  return tool.execute('test',validateToolArguments({...tool,parameters:JSON.parse(JSON.stringify(tool.parameters))},{type:'toolCall',id:'test',name:tool.name,arguments:args}));
}
test('actual manager schemas require complete paged context and keep draft content optional',async()=>{
  const context={record:{content},feedback:{...feedback,reason:'long '.repeat(4000)}};
  const result=await govern('draft',context,async(_r,p:any,tools)=>{
    const submit=tools.find(t=>t.name==='submit_feedback_decision')!,read=tools.find(t=>t.name==='read_feedback_context')!;
    assert.deepEqual(submit.parameters.required,['reason']);
    await assert.rejects(execute(submit,{reason:'insufficient evidence'}),/read complete/);
    for(let page=0;page<p.pages;page++)await execute(read,{page});
    await assert.rejects(execute(submit,{content:{...content,role:'manager'},reason:'bad'}),/cannot change/);
    await execute(submit,{reason:'insufficient evidence'});
  });assert.equal(result.content,undefined);
});
test('fresh verification schema rejects missing approved and assessor cannot invent reactivation',async()=>{
  for(const mode of ['verify','assess'] as const)await govern(mode,{record:{content}},async(_r,p:any,tools)=>{
    await execute(tools.find(t=>t.name==='read_feedback_context'),{page:0});
    const submit=tools.find(t=>t.name==='submit_feedback_decision');
    if(mode==='verify') {await assert.rejects(execute(submit,{reason:'reviewed'}));await execute(submit,{approved:false,reason:'not enough evidence'});}
    else {await assert.rejects(execute(submit,{action:'reactivate',reason:'guess'}));await execute(submit,{action:'retain',reason:'inapplicable context',evidenceNeeded:['same conditions']});}
  });
});
function harness(action='revise') {
  let saved:any=null,finished:any,record:any={id,content,sources:[],current_revision:1,revision:1,status_version:1,strategy_status:'active'};
  let prepareFail=false;const calls:string[]=[],drafts:any[]=[];
  const save=(_j:any,p:any)=>{saved=structuredClone(p);};
  const deps:any={...governanceDependencies,snapshot:async()=>structuredClone(record),original:async()=>({content}),checkpoint:save,
    commit:save,defer:async()=>{},govern:async(mode:string)=>{calls.push(mode);return mode==='assess'?{action,reason:'grounded'}:mode==='draft'?{content:{...content,strategy:'fixed'},reason:'correct condition'}:{approved:true,reason:'evidence supports correction'};},
    applyAssessment:async(_j:any,p:any)=>{
      if(['revise','disable'].includes(p.assessment.action)){record.status_version++;record.strategy_status=p.assessment.action==='revise'?'need_revised':'disabled';}
      p.snapshot=structuredClone(record);p.phase=p.assessment.action==='revise'?'draft':p.assessment.action==='reactivate'?'verify':'finish';save(_j,p);
    },saveDraft:async(j:any,p:any)=>{drafts.push(p.draft);p.phase='verify';save(j,p);},
    prepare:async()=>{if(prepareFail)throw new Error('embedding failed');return {};},
    activate:async(j:any,p:any)=>{record={...record,strategy_status:'active',current_revision:2,revision:2,status_version:record.status_version+1};finished={outcome:'verified'};},
    finish:async(_j:any,_p:any,result:any)=>{finished=result;},
  };
  return {deps,calls,drafts,get record(){return record;},get saved(){return saved;},get finished(){return finished;},set prepareFail(v:boolean){prepareFail=v;},
    step:()=>processFeedback({id,kind:'feedback',payload:{entity_id:id,input:feedback},checkpoint:structuredClone(saved),lease_token:id,attempts:1},deps)};
}
test('assessment disables before drafting; independent verification; embedding failure resumes without new model calls',async()=>{
  const h=harness();await h.step();assert.equal(h.record.strategy_status,'need_revised');
  await h.step();assert.equal(h.drafts.length,1);assert.deepEqual(h.calls,['assess','draft']);
  h.prepareFail=true;await assert.rejects(h.step(),/embedding failed/);assert.equal(h.saved.phase,'publish');assert.equal(h.record.strategy_status,'need_revised');
  h.prepareFail=false;await h.step();assert.deepEqual(h.calls,['assess','draft','verify']);assert.equal(h.finished.outcome,'verified');assert.equal(h.record.strategy_status,'active');
});
test('low utility, unclear feedback, unsupported correction and rejected verification preserve correct state',async()=>{
  const disabled=harness('disable');await disabled.step();assert.equal(disabled.finished.status,'disabled');assert.deepEqual(disabled.calls,['assess']);
  const retained=harness('retain');await retained.step();assert.equal(retained.finished.status,'active');
  const insufficient=harness();await insufficient.step();insufficient.deps.govern=async()=>({reason:'missing fix evidence'});await insufficient.step();assert.equal(insufficient.finished.outcome,'needs_evidence');assert.equal(insufficient.record.strategy_status,'need_revised');
  const rejected=harness();await rejected.step();await rejected.step();rejected.deps.govern=async()=>({approved:false,reason:'unsupported action'});await rejected.step();assert.equal(rejected.finished.outcome,'verification_rejected');assert.equal(rejected.record.strategy_status,'need_revised');
});
test('model failure retries original stage; changed revision invalidates old checkpoint before activation',async()=>{
  const h=harness();const original=h.deps.govern;h.deps.govern=async()=>{throw new Error('provider unavailable');};
  await assert.rejects(h.step(),/provider/);assert.equal(h.saved.phase,'assess');
  h.deps.govern=original;await h.step();await h.step();h.record.current_revision=2;h.record.status_version++;
  await h.step();assert.deepEqual(h.calls,['assess','draft','assess']);assert.equal(h.finished,undefined);
});
test('lease/version failure before commit does not draft, publish or report completion',async()=>{
  const h=harness();h.deps.commit=async()=>{throw new Error('job lease lost');};await assert.rejects(h.step(),/lease/);assert.equal(h.record.strategy_status,'active');assert.equal(h.finished,undefined);assert.equal(h.drafts.length,0);
});
test('public search records only final exposed active results; internal candidate search does not refresh activity',async t=>{
  const query=pool.query,fetch=globalThis.fetch;const sql:string[]=[];
  t.after(()=>{pool.query=query;globalThis.fetch=fetch;});
  globalThis.fetch=async()=>new Response(JSON.stringify({embedding:Array(1024).fill(0.1),model_version:'test'}));
  pool.query=(async(q:string)=>{sql.push(q);if(q.startsWith('UPDATE entities'))return {rows:[{id,current_revision:1}]};if(q.startsWith('SELECT * FROM experience_sources'))return {rows:[]};return {rows:[{id,entity_id:id,revision:1,text:'advice',location:{},content,strategy_status:'active',status_version:1}]};}) as any;
  const result=await search('experience','advice',{},1);assert.equal(result.length,1);assert.ok(sql.filter(q=>q.includes('FROM search_chunks')).every(q=>q.includes("e.strategy_status='active'")));assert.equal(sql.filter(q=>q.startsWith('UPDATE entities')).length,1);
  sql.length=0;await search('experience','advice',{},1,{internal:true});assert.ok(!sql.some(q=>q.startsWith('UPDATE entities')));assert.ok(sql.filter(q=>q.includes('FROM search_chunks')).every(q=>!q.includes("e.strategy_status='active'")));
});
test('feedback receipt is idempotent and wrong role/related feedback rollback without creating jobs',async t=>{
  const connect=pool.connect;let received:any=null,jobs=0;const queries:string[]=[];let role='worker',related=id;
  t.after(()=>{pool.connect=connect;});
  pool.connect=(async()=>({release(){},async query(q:string){queries.push(q);
    if(q.includes('SELECT e.kind'))return {rows:[{kind:'experience',content:{role}}]};
    if(q.includes('SELECT entity_id FROM strategy_feedback'))return {rows:[{entity_id:related}]};
    if(q.includes('WHERE fingerprint'))return {rows:received?[received]:[]};
    if(q.includes('INSERT INTO jobs')){jobs++;return {rows:[{id}]};}
    if(q.includes('INSERT INTO strategy_feedback')){received={id,job_id:id};return {rows:[{id}]};}
    return {rows:[]};}})) as any;
  assert.equal((await reportFeedback(feedback)).status,'accepted');assert.equal((await reportFeedback(feedback)).status,'duplicate');assert.equal(jobs,1);
  role='paper';await assert.rejects(reportFeedback(feedback),/mismatch/);assert.equal(queries.at(-1),'ROLLBACK');
  role='worker';related='another';await assert.rejects(reportFeedback({...feedback,related_feedback_id:id}),/related/);assert.equal(jobs,1);
});
test('feedback alternates with ordinary queue without spending its scheduler counters',async t=>{
  const connect=pool.connect;let turn=true;const seen:string[]=[];
  t.after(()=>{pool.connect=connect;});
  pool.connect=(async()=>({release(){},async query(q:string,args:any[]=[]){seen.push(q);
    if(q.includes('SELECT ingest_streak'))return {rows:[{feedback_turn:turn,ingest_streak:2,completion_streak:1}]};
    if(q.startsWith('SELECT id,kind FROM jobs'))return {rows:[{id:'feedback',kind:'feedback'}]};
    if(q.startsWith('SELECT id,kind,COALESCE'))return {rows:[{id:'ordinary',kind:'ingest'}]};
    if(q.includes('SET feedback_turn'))turn=args[0];
    if(q.includes("SET status='running'"))return {rows:[{id:args[0]}]};return {rows:[]};}})) as any;
  assert.equal((await claim())?.id,'feedback');assert.ok(!seen.some(q=>q.includes('SET ingest_streak')));
  assert.equal((await claim())?.id,'ordinary');assert.ok(seen.some(q=>q.includes('SET ingest_streak')));assert.equal(turn,true);
});
test('inactive supplement queues review atomically and leaves current revision/index untouched',async t=>{
  const connect=pool.connect;const sql:string[]=[];
  t.after(()=>{pool.connect=connect;});
  pool.connect=(async()=>({release(){},async query(q:string){sql.push(q);
    if(q.includes("SELECT * FROM jobs WHERE id=$1 AND status='running'"))return {rows:[{payload:{kind:'experience',fingerprint:'hash',sources:[]}}]};
    if(q.includes('SELECT * FROM entities WHERE'))return {rows:[{id,current_revision:1,strategy_status:'disabled',status_version:2}]};
    if(q.includes('SELECT content FROM revisions'))return {rows:[{content}]};
    if(q.includes('INSERT INTO jobs'))return {rows:[{id:'recheck'}]};return {rows:[]};}})) as any;
  await publish({id,kind:'ingest',payload:{},checkpoint:null,lease_token:id,attempts:1},{action:'supplement',targetId:id,expectedRevision:1,reason:'new evidence',evidence:['source']},content as any);
  assert.ok(sql.some(q=>q.includes('INSERT INTO jobs')));assert.ok(!sql.some(q=>q.includes('INSERT INTO revisions')||q.includes('INSERT INTO search_chunks')));assert.equal(sql.at(-1),'COMMIT');
});
test('inactivity sweep uses migration anchor, current state filter and durable daily gate',async t=>{
  const connect=pool.connect;const sql:string[]=[];let recent=false;
  t.after(()=>{pool.connect=connect;});
  pool.connect=(async()=>({release(){},async query(q:string){sql.push(q);
    if(q.includes('SELECT inactivity_checked_at'))return {rows:[{inactivity_checked_at:recent?new Date():null}]};
    if(q.startsWith('SELECT id FROM entities'))return {rows:[{id}]};return {rows:[]};}})) as any;
  assert.equal((await sweepInactive()).disabled,1);assert.ok(sql.some(q=>q.includes('GREATEST(activity_started_at')));assert.ok(sql.some(q=>q.includes('SET inactivity_checked_at=now()')));
  recent=true;sql.length=0;assert.equal((await sweepInactive()).checked,0);assert.ok(!sql.some(q=>q.startsWith('UPDATE entities')));
  const migration=readFileSync(new URL('../migrations/005_strategy_governance.sql',import.meta.url),'utf8');assert.match(migration,/activity_started_at timestamptz NOT NULL DEFAULT now\(\)/);assert.match(migration,/immutable_strategy_drafts/);
});

test('actual activation rolls back failed indexing and publishes new revision, audit and state together',async t=>{
  const connect=pool.connect,sql:string[]=[];let failIndex=true,version=2;
  t.after(()=>{pool.connect=connect;});
  pool.connect=(async()=>({release(){},async query(q:string){sql.push(q);
    if(q.includes("SELECT * FROM jobs WHERE id=$1 AND status='running'"))return {rows:[{id}]};
    if(q.includes('SELECT * FROM entities'))return {rows:[{id,current_revision:1,status_version:version}]};
    if(q.includes('MAX(revision)'))return {rows:[{n:2}]};
    if(failIndex&&q.includes('INSERT INTO search_chunks'))throw new Error('index write failure');
    return {rows:[]};}})) as any;
  const job:any={id,kind:'feedback',payload:{entity_id:id},lease_token:id};
  const p={snapshot:{current_revision:1,status_version:2,content,sources:[]},draft:{content},draftId:id,verification:{approved:true,reason:'verified'}};
  const encoded={model_version:'test',chunks:[{location:{},text:'advice',embedding:Array(1024).fill(0.1)}]};
  await assert.rejects(governanceDependencies.activate(job,p,encoded),/index write/);
  assert.equal(sql.at(-1),'ROLLBACK');assert.ok(!sql.some(q=>q.includes('SET strategy_status')));
  sql.length=0;failIndex=false;await governanceDependencies.activate(job,p,encoded);
  assert.equal(sql.at(-1),'COMMIT');for(const q of ['INSERT INTO revisions','INSERT INTO search_chunks','SET current_revision','SET strategy_status','INSERT INTO strategy_events',"SET status='succeeded'"])assert.ok(sql.some(s=>s.includes(q)));
  assert.ok(!sql.some(q=>/UPDATE revisions|DELETE FROM revisions/.test(q)));
  sql.length=0;version=3;await assert.rejects(governanceDependencies.activate(job,p,encoded),/reassessment/);assert.equal(sql.at(-1),'ROLLBACK');assert.ok(!sql.some(q=>q.startsWith('INSERT')));
});
