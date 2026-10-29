import {feedbackSchema} from './kb-feedback-schema.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {workspaceRoots} from './workspace-context.mjs';

export const KB_SERVER='survey-kb';
export const KB_PREFIX='mcp__survey-kb__';
export const KB_ROLES=['worker','manager','scoper','paper'];
export const KB_STAGES=['scope_planning','task_planning','paper_discovery','paper_reading','topic_synthesis','paper_writing'];
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export const chars=s=>Array.from(String(s));
export const cut=(s,n)=>chars(s).slice(0,n).join('');
export function atomic(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);
}
export function safe(root,relative) {
  const base=path.resolve(root),p=path.resolve(base,relative),r=path.relative(base,p);
  if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))throw new Error('KB path outside workspace');
  for(let f=p;;f=path.dirname(f)) {
    if(fs.existsSync(f)&&fs.lstatSync(f).isSymbolicLink())throw new Error('KB symbolic link refused');
    if(f===base)break;
  }
  return p;
}
export const kbPath=(root,relative='')=>safe(root,path.join('.slr/kb',relative));
export function config(root) {
  const f=safe(root,'.slr/survey-kb.json');
  if(!fs.existsSync(f))return null;
  const c=json(f);
  if(c.version!==1||typeof c.enabled!=='boolean'||!c.runId||!c.budgets)throw new Error('invalid Survey KB configuration');
  return c;
}
export function configure(root,input={}) {
  if(input===null||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='enabled'))throw new Error('surveyKb accepts enabled only');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new Error('surveyKb.enabled must be boolean');
  if(fs.existsSync(safe(root,'.slr/survey-kb.json')))throw new Error('Survey KB configuration is immutable; resume existing run');
  const c={version:1,enabled:input.enabled??true,runId:randomUUID(),server:KB_SERVER,snapshotGeneration:snapshotControl().generation,
    budgets:{strategies:3,strategySnippet:1200,strategyChars:4500,papers:5,paperSnippet:1000,paperChars:8000,readChars:24000},
    requestTimeoutMs:20000,createdAt:new Date().toISOString()};
  atomic(safe(root,'.slr/survey-kb.json'),c);return c;
}
export function snapshotControl() {
  const file=path.join(process.env.SURVEY_KB_SNAPSHOT_DIR??'/root/survey-kb/snapshots','control.json');
  const state=fs.existsSync(file)?json(file):{generation:0};
  if(!Number.isInteger(state.generation)||state.generation<0)throw new Error('invalid KB snapshot generation');return state;
}
export function enabled(root) {try{const c=config(root),state=snapshotControl();return c?.enabled===true&&!state.pending_restore&&(c.snapshotGeneration??0)===state.generation;}catch{return false;}}
export function warning(root,kind,error) {
  try {atomic(kbPath(root,`warnings/${sha(kind)}.json`),{kind,error:String(error?.message??error).slice(0,1000),at:new Date().toISOString()});}catch{/* never fail the research operation */}
}
export function locked(root,name,fn) {
  const dir=kbPath(root,`locks/${name}`);fs.mkdirSync(path.dirname(dir),{recursive:true});
  try {fs.mkdirSync(dir);}catch(e){
    if(e.code!=='EEXIST')throw e;
    let dead=false;
    try {const owner=json(path.join(dir,'owner.json'));try{process.kill(owner.pid,0);}catch(x){dead=x.code==='ESRCH';}}
    catch{dead=Date.now()-fs.statSync(dir).mtimeMs>120000;}
    if(!dead)throw new Error('KB state busy; retry later');
    // dir is resolved through kbPath and verified inside the workspace above.
    fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir);
  }
  try {fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({pid:process.pid,at:Date.now()}));return fn();}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
}
export function runtime(root) {
  const f=kbPath(root,'runtime.json');return fs.existsSync(f)?json(f):{sessions:{},agents:{}};
}
export function rootsFor(input) {
  return workspaceRoots(input);
}
export function resolveCaller(input) {
  const found=[];
  for(const root of rootsFor(input))try {
    const state=json(safe(root,'.slr/state.json')),rt=runtime(root);
    if(!input.agent_id) {if(rt.sessions[input.session_id])found.push({root,state,rt,role:'main'});continue;}
    const side=safe(root,'.slr/paper-bindings.json');
    const b=state.bindings?.[input.agent_id]??(fs.existsSync(side)?json(side)[input.agent_id]:null)??
      (rt.agents[input.agent_id]?.bound?rt.agents[input.agent_id]:null);
    if(!b)continue;
    const supplied=String(input.agent_type??'').split(':').at(-1);
    const expected={worker:'slr-worker',manager:'slr-manager',paper:'slr-paper-writer',scoper:'slr-scoper',checker:'slr-checker',reviewer:'slr-reviewer'}[b.role];
    if(supplied!==expected)continue;
    const a=rt.agents[input.agent_id];
    if(a?.sessionId&&input.session_id&&a.sessionId!==input.session_id)continue;
    found.push({root,state,rt,b,role:b.role});
  }catch{/* missing or ambiguous bindings fail closed for KB only */}
  return found.length===1?found[0]:null;
}
export function scopeFor(caller) {
  const {root,state,b,role}=caller;
  if(!enabled(root)||!KB_ROLES.includes(role))throw new Error('Survey KB disabled or role not permitted');
  let task,stage;
  if(role==='worker') {
    const l=state.leases?.[b.leaseId];
    if(state.stage!=='researching'||!l?.active||l.agentId!==caller.agentId)throw new Error('Worker KB access requires an active lease');
    task=`${b.topicId}/${b.taskId}`;stage=l.phase==='discover'?'paper_discovery':'paper_reading';
  } else if(role==='manager') {
    const topic=state.topics.find(t=>t.id===b.topicId);
    if(state.stage!=='researching'||!topic||topic.status==='completed')throw new Error('Manager KB access requires active topic');
    if(state.revisionContext?.active&&!state.revisionContext.topicIds.includes(b.topicId))throw new Error('Manager topic is outside the current revision');
    task=b.topicId;stage=null;
  } else if(role==='scoper') {
    if(!['drafting_scope','awaiting_scope_approval'].includes(state.stage))throw new Error('Scoper KB access requires scoping stage');
    task='scope';stage='scope_planning';
  } else {
    const w=json(safe(root,'.slr/work-stages.json')).writers.at(-1);
    if(!w?.active||w.active.agentId!==caller.agentId)throw new Error('Paper KB access requires active writing phase');
    task=`${w.id}/${w.active.phaseId}`;stage='paper_writing';
  }
  const f=safe(root,'.slr/final-review.json');
  if(fs.existsSync(f)&&json(f).status==='paused')throw new Error('final review is paused');
  return {runId:config(root).runId,role,task,stage};
}
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const cacheKey=(scope,method,args)=>sha(JSON.stringify(stable({scope,method,args})));
export function cacheEntry(root,key) {
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('invalid cache key');
  return json(kbPath(root,`cache/${key}.json`));
}
export function sameScope(a,b) {return a.runId===b.runId&&a.role===b.role&&a.task===b.task&&a.stage===b.stage;}
export function authorize(input) {
  const method=input.tool_name?.slice(KB_PREFIX.length);
  const caller=resolveCaller(input);if(!caller)throw new Error('Survey KB requires one verified runtime binding');
  caller.agentId=input.agent_id;const scope=scopeFor(caller),args=structuredClone(input.tool_input??{}),budget=config(caller.root).budgets;
  if(method==='report_strategy_feedback') {
    const identity={runId:scope.runId,agentId:input.agent_id,role:scope.role,task:scope.task};
    for(const [k,v] of Object.entries(identity))if(args.context?.[k]!==undefined&&args.context[k]!==v)throw new Error('feedback identity must match current task');
    args.context={...args.context,...identity};
    const parsed=feedbackSchema.parse(args);
    const refsFile=kbPath(caller.root,`strategy-references/${sha(JSON.stringify(stable(scope)))}.json`);
    const refs=fs.existsSync(refsFile)?json(refsFile):[];
    if(!refs.some(r=>r.id===args.strategy_id&&r.revision===args.revision))throw new Error('feedback requires a strategy retrieved by this task and role');
    return {...caller,scope,method,args:parsed,key:cacheKey(scope,method,parsed),cached:false};
  }
  if(!['search_papers','search_strategies','read'].includes(method))throw new Error('Survey KB submission and job tools are script-only');
  const keys=method==='read'?['type','id','revision']:['query','filters','limit'];
  if(Object.keys(args).some(k=>!keys.includes(k)))throw new Error('unknown KB request argument');
  if(method!=='read') {
    if(typeof args.query!=='string'||!args.query.trim()||args.query.length>8000)throw new Error('KB query must be nonempty text of at most 8000 characters');
    const allowed=method==='search_papers'?['year_from','year_to','author','venue','doi','arxivId']:['role','stage','sourceType'];
    if(args.filters!==undefined&&(!args.filters||Array.isArray(args.filters)||typeof args.filters!=='object'))throw new Error('KB filters must be an object');
    for(const [key,value] of Object.entries(args.filters??{}))if(!allowed.includes(key)||(key.startsWith('year_')?!Number.isInteger(value):typeof value!=='string'||!value.trim()))throw new Error('invalid KB filter');
    if(args.filters?.sourceType!==undefined&&!['review','trajectory'].includes(args.filters.sourceType))throw new Error('invalid KB experience origin');
  }
  if(method==='search_papers') {
    if(scope.role!=='worker')throw new Error('only Worker searches KB papers');
    if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>budget.papers))throw new Error('KB paper search limit exceeds budget');
    args.limit??=budget.papers;
  } else if(method==='search_strategies') {
    args.filters??={};
    if(args.filters.role!==undefined&&args.filters.role!==scope.role)throw new Error('KB strategy role must match caller');
    args.filters.role=scope.role;
    // Stage is optional descriptive metadata, not a permission boundary. Keep
    // scope.stage tied to the actual assignment and preserve an omitted filter.
    if(args.filters.stage?.length>200)throw new Error('KB stage filter exceeds 200 characters');
    if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>budget.strategies))throw new Error('KB strategy search limit exceeds budget');
    args.limit??=budget.strategies;
  } else {
    if(!['paper','experience'].includes(args.type)||args.type==='paper'&&scope.role!=='worker')throw new Error('KB read type is not permitted');
    if(!Number.isInteger(args.revision)||args.revision<1)throw new Error('KB read requires the retrieved revision');
    const dir=kbPath(caller.root,'cache');let hit=false;
    if(fs.existsSync(dir))for(const f of fs.readdirSync(dir)) {
      if(!/^[a-f0-9]{64}\.json$/.test(f))continue;
      const e=json(path.join(dir,f));
      if(sameScope(e.scope,scope)&&e.method===(args.type==='paper'?'search_papers':'search_strategies')&&e.result.results?.some(r=>r.id===args.id&&r.revision===args.revision))hit=true;
    }
    if(!hit&&args.type==='experience'){const f=kbPath(caller.root,`strategy-references/${sha(JSON.stringify(stable(scope)))}.json`);hit=fs.existsSync(f)&&json(f).some(r=>r.id===args.id&&r.revision===args.revision);}
    if(!hit)throw new Error('KB read must reference a result retrieved by this task and role');
  }
  const key=cacheKey(scope,method,args),f=kbPath(caller.root,`cache/${key}.json`);
  return {...caller,scope,method,args,key,cached:fs.existsSync(f)};
}
export function decodeResult(value) {
  if(value?.isError)throw new Error('KB tool reported an error');
  if(value?.structuredContent)return value.structuredContent;
  if(Array.isArray(value?.content))return JSON.parse(value.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
  if(typeof value==='string')return JSON.parse(value);
  return value;
}
export function displayResult(result,method,budget) {
  if(result.unavailable)return {unavailable:true,reason:result.reason};
  if(method==='read') {
    if(result.kind==='experience'&&(result.strategy_status!=='active'||result.current_revision!==result.revision))return {id:result.id,revision:result.revision,current_revision:result.current_revision,status:result.strategy_status,unavailable:true,reason:'Strategy is inactive or superseded; retrieve the current active revision'};
    const text=JSON.stringify(result,null,2),body=cut(text,budget.readChars-400);
    return fitView({id:result.id,revision:result.revision,text:body,truncated:chars(text).length>chars(body).length,nextOffset:chars(body).length,totalChars:chars(text).length},budget.readChars);
  }
  if(!Array.isArray(result?.results))throw new Error('invalid KB search response');
  const paper=method==='search_papers',max=paper?budget.paperChars:budget.strategyChars,limit=paper?budget.papers:budget.strategies;
  const out={results:[],omitted:0};
  for(const row of result.results.slice(0,limit)) {
    const snippet=cut(row.snippet??'',paper?budget.paperSnippet:budget.strategySnippet);
    const item={...row,snippet,truncated:snippet!==row.snippet};
    out.results.push(item);
    if(chars(JSON.stringify(out)).length>max-400) {out.results.pop();out.omitted++;}
  }
  out.omitted+=Math.max(0,result.results.length-limit);return fitView(out,max);
}
export function fitView(value,max) {
  const size=v=>chars(JSON.stringify(v,null,2)).length+1;
  if(Array.isArray(value.results))while(value.results.length&&size(value)>max){value.results.pop();value.omitted++;}
  if(typeof value.text==='string'&&size(value)>max) {
    const all=chars(value.text);let lo=0,hi=all.length;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2),candidate={...value,text:all.slice(0,mid).join(''),truncated:true,nextOffset:(value.offset??0)+mid};if(size(candidate)<=max)lo=mid;else hi=mid-1;}
    value={...value,text:all.slice(0,lo).join(''),truncated:true,nextOffset:(value.offset??0)+lo};
  }
  if(size(value)>max)throw new Error('KB response metadata exceeds display budget');return value;
}
export function storeResponse(input) {
  const a=authorize(input),result=decodeResult(input.tool_response);
  if(!result||typeof result!=='object')throw new Error('invalid KB response');
  if(a.method==='read'&&(result.id!==a.args.id||result.revision!==a.args.revision))throw new Error('KB returned a different entity/revision');
  if(a.method==='read'&&a.args.type==='experience'&&result.content?.role!==a.scope.role)throw new Error('KB returned experience for another role');
  if(a.method==='search_strategies'&&result.results?.some(r=>r.role!==a.scope.role))throw new Error('KB returned strategies for another role');
  const view=displayResult(result,a.method,config(a.root).budgets);
  const cache={scope:a.scope,method:a.method,args:a.args,result,at:new Date().toISOString()};
  const budgets=config(a.root).budgets;
  const value=fitView({...view,cacheKey:a.key,cachePath:kbPath(a.root,`views/${a.key}.json`)},a.method==='read'?budgets.readChars:a.method==='search_papers'?budgets.paperChars:budgets.strategyChars);
  rememberStrategies(a.root,cache);
  atomic(value.cachePath,value);
  atomic(kbPath(a.root,`cache/${a.key}.json`),cache);return value;
}
export function lookupCache(input) {
  const a=authorize(input);if(!a.cached)return {hit:false};
  const e=cacheEntry(a.root,a.key);
  if(!sameScope(e.scope,a.scope)||e.method!==a.method)throw new Error('cached response scope mismatch');
  if(e.method==='search_strategies'||e.method==='read'&&e.args.type==='experience')return {hit:false,requiresValidation:true,cacheKey:a.key};
  const budget=config(a.root).budgets,view=displayResult(e.result,a.method,budget);
  return fitView({...view,hit:true,cacheKey:a.key,cachePath:kbPath(a.root,`views/${a.key}.json`)},
    a.method==='read'?budget.readChars:a.method==='search_papers'?budget.paperChars:budget.strategyChars);
}
export function normalizeExperience(e) {
  const out={};
  for(const k of ['sourceType','role','executionSummary','strategy']) {
    if(typeof e?.[k]!=='string'||!e[k].trim())throw new Error(`invalid experience ${k}`);out[k]=e[k];
  }
  if(out.sourceType!=='review'||!KB_ROLES.includes(out.role))throw new Error('invalid review experience origin/role');
  for(const k of ['stage','task','applicability']) {
    if(e[k]==null||typeof e[k]==='string'&&!e[k].trim())continue;
    if(typeof e[k]!=='string')throw new Error(`invalid experience ${k}`);out[k]=e[k];
  }
  return out;
}

// Immutable retrieval references remain valid for reporting a problem with an older revision.
export function rememberStrategies(root,entry) {
  const rows=entry.method==='search_strategies'?entry.result.results:entry.method==='read'&&entry.args.type==='experience'&&entry.result.strategy_status==='active'?[entry.result]:[];
  if(!rows?.length)return;
  const f=kbPath(root,`strategy-references/${sha(JSON.stringify(stable(entry.scope)))}.json`);
  locked(root,'strategy-references',()=>{
    const all=fs.existsSync(f)?json(f):[];
    for(const r of rows)if(r.id&&r.revision&&!all.some(x=>x.id===r.id&&x.revision===r.revision))all.push({id:r.id,revision:r.revision});
    atomic(f,all);
  });
}
