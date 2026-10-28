import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { config, agentConfig } from './config.js';
import { validateDecision, paperSchema, experienceSchema, sourceSchema, type Kind, type Payload, type Decision } from './domain.js';
import * as store from './store.js';

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
async function run(role: 'manager'|'distiller', prompt: unknown, tools: AgentTool<any>[]) {
  const rc = agentConfig()[role], models = await runtime();
  if (models.getError()) throw new Error('Pi model configuration is invalid; inspect config/models.json');
  const model = models.getModel(rc.provider,rc.model);
  if (!model) throw new Error(`configured ${role} model is unavailable`);
  const systemPrompt = (await Promise.all(['project-context',role].map(name=>readFile(new URL(`../prompts/${name}.md`,import.meta.url),'utf8')))).join('\n\n');
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
export async function manage(kind: Kind, content: Payload, initial: any[], incomingSources:any[]=[]): Promise<Decision> {
  const allowed = new Map(initial.map(c=>[c.id,c]));
  let decision: Decision | undefined;
  const tools = [
    tool('search_candidates','Retrieve candidate previews for the current submission.',{},async()=>{const list=await store.candidates(kind,content);list.forEach(c=>allowed.set(c.id,c));return list.map(preview);}),
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
  await run('manager',{kind,incoming:preview({id:'incoming',content,sources:incomingSources}),candidates:initial.map(preview)},tools);
  if(!decision)throw new Error('manager did not submit a valid decision');
  return decision;
}
export const distilledSchema = z.object({
  summary:z.string().max(6000),
  candidates:z.array(z.object({experience:experienceSchema.extend({sourceType:z.literal('trajectory')}),sources:z.array(sourceSchema).min(1).max(20)}).strict()).max(20),
}).strict();
export const distilledToolSchema = toolSchema(distilledSchema);
export type Distilled = z.infer<typeof distilledSchema>;
export function checkDistilled(value:unknown, trajectoryId:string, lineCount:number):Distilled {
  const parsed=distilledSchema.parse(value);
  for(const c of parsed.candidates) {
    if(c.experience.sourceType!=='trajectory')throw new Error('distillation must produce trajectory experiences');
    for(const s of c.sources)if(s.id!==trajectoryId || (s.event_range && s.event_range.end>lineCount))throw new Error('invalid distilled source');
  }
  return parsed;
}
export async function distillSegment(trajectoryId:string,lineCount:number,segment:unknown,summary:string,origins:unknown[]=[]):Promise<Distilled> {
  let output:Distilled|undefined;
  await run('distiller',{trajectoryId,lineCount,origins:origins.length?origins:[{agentRole:'unknown'}],previousSummary:summary,segment},[
    tool('submit_candidates','Return a bounded running summary and reusable strategies supported by this trajectory; an empty candidate list is valid.',distilledToolSchema.properties,
      async args=>{output=checkDistilled(args,trajectoryId,lineCount);return {accepted:true};},true),
  ]);
  if(!output)throw new Error('distiller did not submit candidates');
  return output;
}
