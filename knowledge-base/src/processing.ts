import { validateTrajectory, validateDecision, paperSchema, experienceSchema, hash, normalizeDoi, normalizeArxiv, type Payload, type Kind, type Paper, type Experience } from './domain.js';
import { prepare } from './embedding.js';
import * as store from './store.js';
import { manage, distillSegment, consolidate, checkDistilled, checkConsolidation, type Draft } from './agents.js';
import { sourceRole, assertExperienceRole } from './roles.js';

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
const defaultDependencies={store,prepare,manage,distillSegment,consolidate};
export async function processIngest(job:store.Job,deps=defaultDependencies) {
  const {store,prepare,manage}=deps;
  const {kind}=job.payload;
  const content=(kind==='paper'?paperSchema:experienceSchema).parse(job.payload.content);
  const found=await store.candidates(kind,content,job.payload.sources??[]);
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
  const {store,distillSegment,consolidate}=deps;
  const trajectory=await store.read('trajectory',job.payload.trajectory_id);
  if(trajectory.distillation_blocked_reason)throw new Error('trajectory administratively removed');
  const role=sourceRole(trajectory.origins??[]);
  const segments=trajectorySegments(trajectory.content);
  const progress=job.checkpoint ?? {next:0,summary:'',candidates:[],children:null};
  // Old checkpoints with submitted children continue tracking their original IDs.
  progress.phase??=progress.children?'waiting':'segments';
  progress.version=2;progress.total=segments.length;
  for(const c of progress.candidates??[])assertExperienceRole(c.experience,role);
  const save=()=>store.checkpoint(job,progress);
  const yieldJob=async()=>{await save();await store.defer(job);};
  if(progress.phase==='segments') {
    if(progress.next<segments.length) {
      const result=checkDistilled(await distillSegment(trajectory.id,trajectory.line_count,segments[progress.next],progress.summary,trajectory.origins),trajectory.id,trajectory.line_count,role);
      progress.summary=result.summary;progress.candidates.push(...result.candidates);progress.next++;
    }
    if(progress.next===segments.length) {
      progress.phase='consolidating';
      progress.consolidation={next:0,current:null,compare:0,assessed:false,items:[],decisions:[]};
    }
    await yieldJob();return;
  }
  if(progress.phase==='consolidating') {
    const c=progress.consolidation;
    if(!c.current && c.next<progress.candidates.length) {
      c.current={...progress.candidates[c.next],candidateId:`candidate-${c.next}`};
      c.next++;c.compare=0;c.assessed=false;
    }
    if(c.current) {
      const other:Draft|undefined=c.assessed?c.items[c.compare]:undefined;
      if(!c.assessed||other) {
        const decision=checkConsolidation(await consolidate(c.current,other,role),c.current,other,role);
        c.decisions.push(decision);
        if(decision.action==='drop')c.current=null;
        else if(decision.action==='merge') {
          const sources=[...new Map([...c.current.sources,...other!.sources].map((s:any)=>[hash(s),s])).values()];
          c.current={candidateId:c.current.candidateId,experience:decision.experience,sources};
          c.items.splice(c.compare,1);c.compare=0;c.assessed=true;
        } else if(!c.assessed)c.assessed=true;
        else c.compare++;
      } else {c.items.push(c.current);c.current=null;}
    }
    if(!c.current && c.next===progress.candidates.length) {
      progress.finalCandidates=c.items.map(({candidateId,...rest}:Draft)=>rest);
      progress.phase='submitting';progress.children=[];progress.submitted=0;
    }
    await yieldJob();return;
  }
  if(progress.phase==='submitting') {
    for(const c of progress.finalCandidates)assertExperienceRole(c.experience,role);
    // Persist each receipt. A lost receipt reuses store.submit's content hash.
    if(progress.submitted<progress.finalCandidates.length) {
      const c=progress.finalCandidates[progress.submitted];
      progress.children.push(await store.submit('experience',c.experience,c.sources));
      progress.submitted++;await yieldJob();return;
    }
    progress.phase='waiting';await save();
  }
  const ids=new Set<string>();let waiting=false;
  for(const child of progress.children??[]) {
    if(child.id) {ids.add(child.id);continue;}
    const status=await store.getJob(child.job_id);
    if(status.status==='failed')throw new Error(`child ingestion failed: ${child.job_id}`);
    if(status.status!=='succeeded')waiting=true;
    else for(const id of status.result.ids)ids.add(id);
  }
  if(waiting)await store.defer(job);else await store.finish(job,{ids:[...ids],trajectory_id:trajectory.id,candidate_count:progress.candidates.length,consolidated_count:progress.finalCandidates?.length??null,strategy_count:ids.size});
}
