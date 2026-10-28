import { validateTrajectory, validateDecision, paperSchema, experienceSchema, hash, normalizeDoi, normalizeArxiv, type Payload, type Kind, type Paper, type Experience } from './domain.js';
import { prepare } from './embedding.js';
import * as store from './store.js';
import { manage, distillSegment } from './agents.js';

export function trajectorySegments(content:string, budget=16000) {
  const lines=validateTrajectory(content),segments:{start:number;end:number;text:string}[]=[];
  let text='',start=1,end=1;
  const flush=()=>{if(text)segments.push({start,end,text});text='';};
  lines.forEach((line,index)=>{
    if(text.length+line.length+20>budget)flush();
    if(line.length>budget) {
      for(let pos=0;pos<line.length;pos+=budget)segments.push({start:index+1,end:index+1,text:`[line ${index+1}, characters ${pos}..${Math.min(pos+budget,line.length)}]\n${line.slice(pos,pos+budget)}`});
    } else {if(!text)start=index+1;end=index+1;text+=`[line ${index+1}] ${line}\n`;}
  });flush();return segments;
}
export function checkSupplement(kind:Kind, old:Payload, next:Payload) {
  if(kind==='experience') {
    for(const key of ['sourceType','role','stage'] as const)if((old as Experience)[key] !== (next as Experience)[key])throw new Error('supplement cannot change experience role/stage/sourceType');
  } else {
    const a=(old as Paper).metadata,b=(next as Paper).metadata;
    for(const [x,y] of [[normalizeDoi(a.doi),normalizeDoi(b.doi)],[normalizeArxiv(a.arxivId),normalizeArxiv(b.arxivId)]])if(x && x!==y)throw new Error('supplement cannot remove or change established paper identifiers');
  }
}
const defaultDependencies={store,prepare,manage,distillSegment};
export async function processIngest(job:store.Job,deps=defaultDependencies) {
  const {store,prepare,manage}=deps;
  const {kind}=job.payload;
  const content=(kind==='paper'?paperSchema:experienceSchema).parse(job.payload.content);
  const found=await store.candidates(kind,content);
  const same=found.find(c=>hash(c.content)===hash(content));
  const decision=same ? {action:'duplicate' as const,targetId:same.id,expectedRevision:same.revision,reason:'Identical normalized content',evidence:['content hash matches']} : found.length ? await manage(kind,content,found,job.payload.sources) : {action:'new' as const,reason:'No existing candidate',evidence:['No matching stored record was retrieved']};
  validateDecision(decision,kind,found.map(c=>c.id));
  let result:Payload=content;
  if(decision.action==='supplement') {
    result=(kind==='paper'?paperSchema:experienceSchema).parse(decision.proposedContent);
    checkSupplement(kind,found.find(c=>c.id===decision.targetId)!.content,result);
  }
  const encoded=decision.action==='duplicate'?undefined:await prepare(kind,result);
  await store.publish(job,decision,result,encoded);
}
export async function processDistill(job:store.Job,deps=defaultDependencies) {
  const {store,distillSegment}=deps;
  const trajectory=await store.read('trajectory',job.payload.trajectory_id);
  const segments=trajectorySegments(trajectory.content);
  const progress=job.checkpoint ?? {next:0,summary:'',candidates:[],children:null};
  if(!progress.children) {
    progress.total=segments.length;
    if(progress.next<segments.length) {
      const i=progress.next;
      const result=await distillSegment(trajectory.id,trajectory.line_count,segments[i],progress.summary,trajectory.origins??[]);
      progress.summary=result.summary;progress.candidates.push(...result.candidates);progress.next=i+1;
      await store.checkpoint(job,progress);
      if(progress.next<segments.length){await store.defer(job);return;}
    }
    const unique=[...new Map(progress.candidates.map((c:any)=>[hash(c),c])).values()] as any[];
    progress.children=[];
    for(const c of unique) progress.children.push(await store.submit('experience',c.experience,c.sources));
    await store.checkpoint(job,progress);
  }
  const ids=new Set<string>();let waiting=false;
  for(const child of progress.children) {
    if(child.id) {ids.add(child.id);continue;}
    const status=await store.getJob(child.job_id);
    if(status.status==='failed')throw new Error(`child ingestion failed: ${child.job_id}`);
    if(status.status!=='succeeded')waiting=true;
    else for(const id of status.result.ids)ids.add(id);
  }
  if(waiting)await store.defer(job);else await store.finish(job,{ids:[...ids],trajectory_id:trajectory.id,candidate_count:progress.candidates.length});
}
