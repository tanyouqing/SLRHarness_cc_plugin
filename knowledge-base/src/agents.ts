import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { config, agentConfig } from './config.js';
import { validateDecision, paperSchema, experienceSchema, sourceSchema, type Kind, type Payload, type Decision } from './domain.js';
import * as store from './store.js';
import {currentPolicy,legacyPolicy,type Policy} from './policy.js';
import {triageSchema,checkTriage,triageOverview,type Triage} from './triage.js';
import {validateTrajectory} from './domain.js';
import { sourceRole, assertExperienceRole, type ExecutionRole } from './roles.js';

let runtimePromise: Promise<ModelRuntime> | undefined;
function runtime() {
  return runtimePromise ??= ModelRuntime.create({
    modelsPath:join(config.piDir,'models.json'),authPath:join(config.piDir,'auth.json'),
    modelsStorePath:process.env.PI_MODELS_STORE ?? join(config.piDir,'models-store.json'),allowModelNetwork:false,
  });
}
function tool(name: string, description: string, properties: Record<string,any>, fn: (args: any) => Promise<unknown>, terminal=false): AgentTool<any> {
  return {name,label:name,description,parameters:Type.Object(properties,{additionalProperties:false}),executionMode:'sequential',
    execute:async (_id,args) => ({content:[{type:'text',text:JSON.stringify(await fn(args))}],details:{},...(terminal?{terminate:true}:{})})};
}
export async function loadPrompts(role:'manager'|'distiller',policy:Policy) {
  const prefix=policy===legacyPolicy?'legacy-v1/':'';
  return (await Promise.all(['project-context',role].map(name=>readFile(new URL(`../prompts/${prefix}${name}.md`,import.meta.url),'utf8')))).join('\n\n');
}
async function run(role: 'manager'|'distiller', prompt: unknown, tools: AgentTool<any>[],policy:Policy=legacyPolicy) {
  const rc = agentConfig()[role], models = await runtime();
  if (models.getError()) throw new Error('Pi model configuration is invalid; inspect config/models.json');
  const model = models.getModel(rc.provider,rc.model);
  if (!model) throw new Error(`configured ${role} model is unavailable`);
  const systemPrompt = await loadPrompts(role,policy);
  let turns=0, timedOut=false, exhausted=false;
  const agent = new Agent({initialState:{model,systemPrompt,tools},streamFn:models.streamSimple.bind(models),toolExecution:'sequential',
    prepareRequest:async ({context}) => {
      if (++turns>rc.maxTurns) {exhausted=true;throw new Error('agent turn budget exhausted');}
      return {context};
    }});
  const timeout = setTimeout(() => {timedOut=true;agent.abort();},rc.timeoutSeconds*1000);
  try {
    await agent.prompt(JSON.stringify(prompt));
    if (timedOut) throw new Error('agent timed out');
    if (exhausted) throw new Error('agent turn budget exhausted');
    const last = agent.state.messages.filter((m:any)=>m.role==='assistant').at(-1) as any;
    if (agent.state.errorMessage || last?.stopReason==='error' || last?.stopReason==='aborted') {const raw=String(agent.state.errorMessage??last?.errorMessage??'');const category=/429|rate.?limit/i.test(raw)?'rate_limit':/401|403|auth|credential/i.test(raw)?'authentication':/timeout|timed out/i.test(raw)?'timeout':/context|token.*limit/i.test(raw)?'context_limit':'provider_error';throw new Error(`model request failed (${category}); inspect provider configuration and availability`);}
  } catch(error) {
    if(timedOut)throw new Error('model request failed (timeout)');
    if(exhausted)throw new Error('agent turn budget exhausted');
    const message=error instanceof Error?error.message:'';
    const category=/429|rate.?limit/i.test(message)?'rate_limit':/401|403|auth|credential/i.test(message)?'authentication':/timeout|timed out/i.test(message)?'timeout':/context|token.*limit/i.test(message)?'context_limit':'provider_error';
    throw new Error(`model request failed (${category}); inspect provider configuration and availability`);
  } finally {clearTimeout(timeout);}
}
function preview(record:any) {
  const body=JSON.stringify(record.content);
  return {id:record.id,revision:record.revision,content_preview:body.slice(0,4000),content_characters:body.length,sources:record.sources??[]};
}
function toolSchema(schema:z.ZodType):any {
  const {$schema,...json}=z.toJSONSchema(schema,{target:'draft-7'});
  return json;
}
function schemaTool(name:string,description:string,schema:z.ZodType,fn:(args:any)=>Promise<unknown>,terminal=false):AgentTool<any> {
  const parameters=toolSchema(schema);
  // Preserve the complete JSON Schema, especially its required array. Rebuilding
  // Type.Object from plain properties loses Zod's optional-field information.
  return {...tool(name,description,{},fn,terminal),parameters};
}
export async function manage(kind: Kind, content: Payload, initial: any[], incomingSources:any[]=[],policy:Policy=legacyPolicy): Promise<Decision> {
  const allowed = new Map(initial.map(c=>[c.id,c]));
  let decision: Decision | undefined;
  const tools = [
    tool('search_candidates','Retrieve candidate previews for the current submission.',{},async()=>{const list=await store.candidates(kind,content,incomingSources);list.forEach(c=>allowed.set(c.id,c));return list.map(preview);}),
    tool('read_record','Read a window of a JSON-serialized record. id="incoming" reads the submission. start is a zero-based character offset, length <= 12000. Follow next_start until null before assuming complete coverage.',{id:Type.String(),start:Type.Optional(Type.Integer({minimum:0})),length:Type.Optional(Type.Integer({minimum:1,maximum:12000}))},async({id,start=0,length=8000})=>{
      if(id!=='incoming' && !allowed.has(id))throw new Error('candidate not in scope');
      const record=id==='incoming'?content:(await store.read(kind,id)).content;
      const text=JSON.stringify(record);if(start>=text.length)throw new Error('record offset out of range');
      return {id,start,text:text.slice(start,start+length),total_characters:text.length,next_start:start+length<text.length?start+length:null};
    }),
    tool('read_source','Read a bounded window from a candidate source trajectory.',{id:Type.String(),start:Type.Integer({minimum:1}),end:Type.Integer({minimum:1})},async({id,start,end})=>{
      if(end<start || end-start>99)throw new Error('source window must be 1–100 lines');
      const ids = new Set([...incomingSources.map(s=>s.id),...[...allowed.values()].flatMap(c=>(c.sources??[]).map((s:any)=>s.id))]);
      if(!ids.has(id))throw new Error('source outside candidate scope');
      const result = await store.read('trajectory',id,undefined,{start,end});
      if(result.content.length>30000)throw new Error('source window too large; request fewer lines');
      return result;
    }),
    tool('submit_decision','Submit the final decision, expected revision, reason and evidence. For supplement provide the complete revised payload.',{
      action:Type.Union(['new','duplicate','supplement','keep_separate'].map(v=>Type.Literal(v))),
      targetId:Type.Optional(Type.String()),expectedRevision:Type.Optional(Type.Integer({minimum:1})),reason:Type.String(),evidence:Type.Array(Type.String()),proposedContent:Type.Optional(toolSchema(kind==='paper'?paperSchema:experienceSchema)),
    },async args=>{decision=validateDecision(args,kind,[...allowed.keys()]);return {accepted:true};},true),
  ];
  await run('manager',{kind,incoming:preview({id:'incoming',content,sources:incomingSources}),candidates:initial.map(preview)},tools,policy);
  if(!decision)throw new Error('manager did not submit a valid decision');
  return decision;
}
export const distilledSchema = z.object({
  summary:z.string().max(6000),
  candidates:z.array(z.object({experience:experienceSchema.extend({sourceType:z.literal('trajectory')}),sources:z.array(sourceSchema).min(1).max(20)}).strict()).max(20),
}).strict();
export const distilledToolSchema = toolSchema(distilledSchema);
export type Distilled = z.infer<typeof distilledSchema>;
export function checkDistilled(value:unknown, trajectoryId:string, lineCount:number, role:ExecutionRole):Distilled {
  const parsed=distilledSchema.parse(value);
  for(const c of parsed.candidates) {
    assertExperienceRole(c.experience,role);
    if(c.experience.sourceType!=='trajectory')throw new Error('distillation must produce trajectory experiences');
    for(const s of c.sources)if(s.id!==trajectoryId || (s.event_range && s.event_range.end>lineCount))throw new Error('invalid distilled source');
  }
  return parsed;
}
export async function distillSegment(trajectoryId:string,lineCount:number,segment:unknown,summary:string,origins:unknown[]=[],invoke=run,policy:Policy=legacyPolicy,triage?:Triage):Promise<Distilled> {
  const requiredRole=sourceRole(origins);
  let output:Distilled|undefined;
  await invoke('distiller',{mode:'extract',requiredRole,trajectoryId,lineCount,origins,previousSummary:summary,segment,...(policy===currentPolicy?{triage}: {})},[
    schemaTool('submit_candidates','Return a bounded running summary and reusable strategies supported by this trajectory; an empty candidate list is valid.',distilledSchema,
      async args=>{output=checkDistilled(args,trajectoryId,lineCount,requiredRole);return {accepted:true};},true),
  ],policy);
  if(!output)throw new Error('distiller did not submit candidates');
  return output;
}

export type Candidate = Distilled['candidates'][number];
export type Draft = Candidate & {candidateId:string;version:string};
const consolidationSchema=z.object({
  action:z.enum(['keep','drop','merge']),candidateId:z.string(),candidateVersion:z.string(),
  targets:z.array(z.object({candidateId:z.string(),version:z.string()}).strict()).min(1).max(12).optional(),
  duplicateBasis:z.array(z.object({candidateId:z.string(),problem:z.string().min(1),coreAction:z.string().min(1),conditions:z.string().min(1)}).strict()).min(1).max(12).optional(),
  reason:z.string().min(1),experience:experienceSchema.extend({sourceType:z.literal('trajectory')}).optional(),
}).strict();
export type ConsolidationDecision=z.infer<typeof consolidationSchema>;
const legacyConsolidationSchema=consolidationSchema.omit({duplicateBasis:true});
export function checkConsolidation(value:unknown,current:Draft,targets:Draft[],role:ExecutionRole,allowDrop=true,policy:Policy=legacyPolicy):ConsolidationDecision {
  const d:ConsolidationDecision=(policy===legacyPolicy?legacyConsolidationSchema:consolidationSchema).parse(value);
  assertExperienceRole(current.experience,role);
  targets.forEach(t=>assertExperienceRole(t.experience,role));
  if(d.candidateId!==current.candidateId || d.candidateVersion!==current.version)throw new Error('unknown or stale consolidation candidate');
  if(d.action==='drop' && !allowDrop)throw new Error('cannot drop previously merged retained evidence');
  if(d.action==='merge') {
    if(!d.targets?.length || !d.experience || new Set(d.targets.map(t=>t.candidateId)).size!==d.targets.length ||
      d.targets.some(t=>!targets.some(other=>other.candidateId===t.candidateId && other.version===t.version)))throw new Error('invalid consolidation merge target or version');
    if(policy===currentPolicy && (!d.duplicateBasis || d.duplicateBasis.length!==d.targets.length || new Set(d.duplicateBasis.map(b=>b.candidateId)).size!==d.targets.length || d.duplicateBasis.some(b=>!d.targets!.some(t=>t.candidateId===b.candidateId))))throw new Error('merge requires duplicate basis for every target');
    assertExperienceRole(d.experience,role);
  } else if(d.targets !== undefined || d.experience !== undefined || d.duplicateBasis !== undefined)throw new Error('keep/drop cannot rewrite evidence');
  return d;
}
export async function consolidate(current:Draft,targets:Draft[],role:ExecutionRole,invoke=run,allowDrop=true,policy:Policy=legacyPolicy):Promise<ConsolidationDecision> {
  let output:ConsolidationDecision|undefined;
  const records=new Map([current,...targets].map(c=>[c.candidateId,c]));
  if(records.size!==targets.length+1)throw new Error('duplicate candidate ID in retrieved set');
  const read=new Set<string>();
  const next=new Map([...records.keys()].map(id=>[id,0]));
  await invoke('distiller',{mode:'consolidate',requiredRole:role,allowDrop,
    instruction:policy===currentPolicy?'Read all supplied records. Keep useful independent advice; drop low-value advice. Merge ONLY the same concrete problem and equivalent core action with compatible conditions, never merely complementary steps. For each target provide duplicateBasis explaining problem, coreAction and conditions. All targets must express ONE core recommendation; no broad bridging candidates. Preserve sources for covered advice. There is no target output count.':'Assess current value and compare with this retrieved set in ONE decision. Read all supplied records completely. Keep independent advice, merge with one or more compatible targets, or drop only low-value/unsupported current advice. Already-covered advice must merge sources, never drop them. Retrieval is not proof of duplication. Aim for 0–5 strategies per trajectory, not a quota or hard cap.',
    current:{id:current.candidateId,version:current.version,characters:JSON.stringify(current).length},
    targets:targets.map(t=>({id:t.candidateId,version:t.version,characters:JSON.stringify(t).length}))},[
    tool('read_candidate','Read candidate JSON in consecutive bounded windows; continue until next_start is null.',{
      id:Type.String(),start:Type.Integer({minimum:0}),
    },async({id,start})=>{
      if(!records.has(id)||next.get(id)!==start)throw new Error('candidate outside scope or nonconsecutive window');
      const text=JSON.stringify(records.get(id)),end=Math.min(start+12000,text.length);
      if(start>=text.length)throw new Error('candidate offset out of range');
      next.set(id,end);if(end===text.length)read.add(id);
      return {id,text:text.slice(start,end),next_start:end<text.length?end:null};
    }),
    schemaTool('submit_consolidation','Submit ONE decision over the retrieved set with candidateId and candidateVersion. For keep/drop omit targets and experience. For merge supply nonempty targets [{candidateId,version}] and complete experience. Sources are combined by the server, never generated.'+(policy===currentPolicy?' Merge also requires duplicateBasis for each target: shared problem, equivalent coreAction and compatible conditions. Do not combine complementary independent advice.':''),policy===legacyPolicy?legacyConsolidationSchema:consolidationSchema,async args=>{
      if(read.size!==records.size)throw new Error('read complete candidates before consolidation');
      output=checkConsolidation(args,current,targets,role,allowDrop,policy);return {accepted:true};
    },true),
  ],policy);
  if(!output)throw new Error('distiller did not submit consolidation');
  return output;
}

export async function assessTrajectory(trajectory:any,invoke=run):Promise<Triage> {
  const lines=validateTrajectory(trajectory.content),overview=triageOverview(trajectory.content);
  const requiredRole=sourceRole(trajectory.origins??[]);let output:Triage|undefined;
  await invoke('distiller',{mode:'triage',requiredRole,trajectoryId:trajectory.id,origins:trajectory.origins,overview},[
    tool('read_trajectory','Read one stored JSONL line in bounded character windows. Use next_start until null; omitted contents are not evidence.',{
      line:Type.Integer({minimum:1}),start:Type.Optional(Type.Integer({minimum:0})),
    },async({line,start=0})=>{
      const text=lines[line-1];if(!text||start>=text.length)throw new Error('trajectory window outside range');
      const end=Math.min(start+12000,text.length);
      return {line,start,text:text.slice(start,end),next_start:end<text.length?end:null};
    }),
    schemaTool('submit_triage','Classify this actor task using supported outcome evidence. Unknown is valid; routine_success skips extraction. Never infer success from the overall investigation.',triageSchema,
      async args=>{output=checkTriage(args,lines.length);return {accepted:true};},true),
  ],currentPolicy);
  if(!output)throw new Error('distiller did not submit triage');return output;
}
