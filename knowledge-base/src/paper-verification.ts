import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {run,schemaTool} from './agents.js';
import {currentPolicy} from './policy.js';
import {hash,normalizeArxiv,normalizeDoi,type Paper} from './domain.js';
import {document,SourceUnavailable,type Dossier,type Document} from './paper-sources.js';
import {openSearchTools} from './search-mcp.js';

const text=z.string().trim().min(1);
export const citationSchema=z.object({sourceId:text,start:z.number().int().nonnegative(),quote:text.max(6000)}).strict();
const field=z.object({outcome:z.enum(['match','mismatch','unknown','not_supplied']),reason:text,evidence:z.array(citationSchema)}).strict();
export const identitySchema=z.object({passed:z.boolean(),reason:text,
  fields:z.object({title:field,authors:field,year:field,doi:field,arxivId:field,venue:field}).strict(),
  version:z.object({label:text,confirmed:z.boolean(),outcome:z.enum(['match','mismatch','unknown']).optional(),reason:text,evidence:z.array(citationSchema),resolvedArxivId:text.optional().describe('When known: exact versioned identifier, e.g. 2501.00001v2, evidenced by the original URL or quoted header. Omit if unavailable.')}).strict(),
  originalSources:z.array(text).max(12),
}).strict();
export const contentSchema=z.object({passed:z.boolean(),reason:text,coverageReason:text,
  claims:z.array(z.object({noteStart:z.number().int().nonnegative(),noteQuote:text.max(6000),
    kind:z.enum(['quantitative','method','conclusion','limitation']),
    verdict:z.enum(['supported','contradicted','unverified']),
    reasoning:text,conditions:text,evidence:z.array(citationSchema),
    quantities:z.array(z.object({noteValue:text,sourceValue:text,metric:text,unit:text,setting:text,comparison:text}).strict()),
  }).strict()).max(100),
}).strict();
export type Identity=z.infer<typeof identitySchema>&{verified?:boolean;originalBound?:boolean;contradictions?:string[]};
export type ContentCheck=z.infer<typeof contentSchema>&{verified?:boolean;contradictions?:string[]};
type Span={start:number;end:number};
export function validateCitations(citations:z.infer<typeof citationSchema>[],docs:Document[],read:Map<string,Span[]>) {
  for(const e of citations) {
    const d=docs.find(d=>d.id===e.sourceId),end=e.start+e.quote.length;
    if(!d||d.text.slice(e.start,end)!==e.quote)throw new Error('evidence quote does not match fetched source');
    if(!(read.get(d.id)??[]).some(s=>s.start<=e.start&&s.end>=end))throw new Error('read cited source window before deciding');
  }
}
export function validateIdentity(value:unknown,paper:Paper,dossier:Dossier,read:Map<string,Span[]>):Identity {
  const r:Identity=identitySchema.parse(value);
  for(const e of [...Object.values(r.fields).map(f=>f.evidence),r.version.evidence])validateCitations(e,dossier.documents,read);
  for(const id of r.originalSources)if(!dossier.documents.some(d=>d.id===id&&d.kind!=='metadata'))throw new Error('identity must reference a fetched original HTML/PDF');
  // Lack of evidence is a gap, not a contradiction. Never preserve a model's
  // negative verdict without inspectable evidence from a fetched source.
  for(const [key,f] of Object.entries(r.fields)) {
    const value=paper.metadata[key as keyof Identity['fields']];
    const supplied=Array.isArray(value)?value.length>0:!!value;
    if(!supplied)f.outcome='not_supplied';
    else if(f.outcome==='mismatch'&&!f.evidence.length)f.outcome='unknown';
  }
  r.version.outcome??=r.version.confirmed?'match':'unknown';
  if(r.version.outcome==='mismatch'&&!r.version.evidence.length)r.version.outcome='unknown';
  r.contradictions=Object.entries(r.fields).filter(([,f])=>f.outcome==='mismatch').map(([k,f])=>`${k}: ${f.reason}`);
  if(r.version.outcome==='mismatch')r.contradictions.push(`version: ${r.version.reason}`);
  const requestedVersion=paper.metadata.arxivId?.match(/^(.+)v(\d+)$/i);
  if(requestedVersion&&r.version.confirmed&&r.version.evidence.length&&r.version.resolvedArxivId&&normalizeArxiv(r.version.resolvedArxivId)===normalizeArxiv(paper.metadata.arxivId)&&r.version.resolvedArxivId.toLowerCase()!==paper.metadata.arxivId!.toLowerCase())
    r.contradictions.push('version: resolved arXiv version differs from the submitted version');
  r.passed=r.contradictions.length===0;r.verified=false;r.originalBound=false;
  if(r.passed)try {
    if(!dossier.searched||!r.version.confirmed||!r.version.evidence.length||!r.originalSources.length)throw new Error('identity/version lacks independent evidence');
    if(!r.version.evidence.some(e=>r.originalSources.includes(e.sourceId)))throw new Error('version must be bound to the fetched original');
    if(!r.fields.title.evidence.some(e=>dossier.documents.some(d=>d.id===e.sourceId&&d.independent&&d.kind==='metadata')))throw new Error('title identity needs independent bibliographic evidence');
    for(const key of ['title','authors','doi','arxivId'] as const)if(paper.metadata[key]&&(r.fields[key].outcome!=='match'||!r.fields[key].evidence.length))throw new Error('original identity is not established');
    const requested=paper.metadata.arxivId?.match(/^(.+)v(\d+)$/i);
    if(paper.metadata.arxivId) {
      const resolved=r.version.resolvedArxivId?.toLowerCase();
      if(!resolved||!/^.+v[1-9]\d*$/.test(resolved)||normalizeArxiv(resolved)!==normalizeArxiv(paper.metadata.arxivId))throw new Error('exact arXiv version must be resolved');
      if(requested&&resolved!==paper.metadata.arxivId.toLowerCase())throw new Error('resolved arXiv version differs from submission');
      const located=r.originalSources.some(id=>{const u=new URL(dossier.documents.find(d=>d.id===id)!.url);return (u.hostname==='arxiv.org'||u.hostname.endsWith('.arxiv.org'))&&decodeURIComponent(u.pathname).replace(/\.pdf$/,'').endsWith('/'+resolved);});
      if(!located&&!r.version.evidence.some(e=>r.originalSources.includes(e.sourceId)&&e.quote.replace(/\s/g,'').toLowerCase().includes(resolved)))throw new Error('resolved version lacks original URL/header evidence');
    }
    if(requested)for(const id of r.originalSources) {
      const url=new URL(dossier.documents.find(d=>d.id===id)!.url);
      const version=(url.hostname==='arxiv.org'||url.hostname.endsWith('.arxiv.org'))?url.pathname.match(/\/(?:html|pdf|abs)\/(.+)v(\d+)(?:\.pdf)?$/):null;
      if(version&&version[1]===requested[1]&&version[2]!==requested[2])throw new Error('original arXiv version differs from submission');
    }
    for(const [key,identifier] of [['doi',normalizeDoi(paper.metadata.doi)],['arxivId',normalizeArxiv(paper.metadata.arxivId)]] as const) {
      if(identifier&&!r.fields[key].evidence.some(e=>e.quote.replace(/\\\//g,'/').toLowerCase().includes(identifier)))throw new Error(`identity ${key} requires the actual identifier in evidence`);
    }
    // A missing venue/year does not invalidate a known paper/version's original
    // evidence. L2 must still detect its concrete contradictions.
    r.originalBound=true;
    for(const key of Object.keys(r.fields) as (keyof Identity['fields'])[]) {
      const supplied=Array.isArray(paper.metadata[key])?(paper.metadata[key] as string[]).length>0:!!paper.metadata[key];
      if(supplied&&(r.fields[key].outcome!=='match'||!r.fields[key].evidence.length))throw new Error(`identity field ${key} did not match`);
    }
    r.verified=true;
  }catch{r.verified=false;}
  return r;
}
export function validateContent(value:unknown,paper:Paper,identity:Identity,dossier:Dossier,read:Map<string,Span[]>):ContentCheck {
  const r:ContentCheck=contentSchema.parse(value);
  const seen=new Set<string>();
  for(const c of r.claims) {
    const key=`${c.noteStart}:${c.noteQuote}`;
    if(seen.has(key)||paper.note.slice(c.noteStart,c.noteStart+c.noteQuote.length)!==c.noteQuote)throw new Error('claim must uniquely quote the submitted note');
    seen.add(key);validateCitations(c.evidence,dossier.documents,read);
    if(!(identity.originalBound??identity.verified)||!c.evidence.length||c.evidence.some(e=>!identity.originalSources.includes(e.sourceId)))c.verdict='unverified';
    if(c.kind==='quantitative'&&c.verdict==='supported') {
      if(!c.quantities.length)c.verdict='unverified';
      for(const q of c.quantities)if(!c.noteQuote.includes(q.noteValue)||!c.evidence.some(e=>e.quote.includes(q.sourceValue)))c.verdict='unverified';
    }
  }
  r.contradictions=r.claims.filter(c=>c.verdict==='contradicted').map(c=>c.reasoning);
  r.passed=identity.passed&&r.contradictions.length===0;
  r.verified=r.passed&&identity.verified===true&&r.claims.length>0&&r.claims.every(c=>c.verdict==='supported');
  return r;
}
// Each level is a fresh management-model call, with server-owned source windows.
export async function verifyLevel(level:'L1'|'L2',paper:Paper,dossier:Dossier,save:()=>Promise<void>,identity?:Identity,
  invoke:typeof run=run,fetcher=document,openSearch:typeof openSearchTools=openSearchTools):Promise<Identity|ContentCheck> {
  const notePages=new Set<number>(),read=new Map<string,Span[]>();let result:Identity|ContentCheck|undefined;
  const sourceSummary=()=>dossier.documents.map(d=>({id:d.id,url:d.url,kind:d.kind,hash:d.hash,independent:d.independent===true,characters:d.text.length,links:d.links.slice(0,100),metadata:d.metadata}));
  const instructions=await readFile(new URL('../prompts/paper-verification.md',import.meta.url),'utf8');
  let fetches=0;
  const tools=[
    schemaTool('read_paper_submission','Read the entire note before deciding. page is zero-based; 12000 characters/page. Metadata is supplied separately.',z.object({page:z.number().int().nonnegative()}).strict(),async({page})=>{
      const start=page*12000;if(start>=paper.note.length)throw new Error('note page out of range');notePages.add(page);
      return {start,text:paper.note.slice(start,start+12000),next_page:start+12000<paper.note.length?page+1:null};
    }),
    schemaTool('list_paper_sources','List fetched source IDs, hashes and discovered links; metadata search hits are not original-paper evidence.',z.object({}).strict(),async()=>sourceSummary()),
    schemaTool('read_paper_source','Read a source window using zero-based character positions; cite exact quotes and start offsets. PDF page markers are retained.',z.object({sourceId:text,start:z.number().int().nonnegative(),length:z.number().int().min(1).max(12000)}).strict(),async({sourceId,start,length})=>{
      const d=dossier.documents.find(x=>x.id===sourceId);if(!d||start>=d.text.length)throw new Error('source window unavailable');
      const end=Math.min(start+length,d.text.length);read.set(d.id,[...(read.get(d.id)??[]),{start,end}]);
      return {start,text:d.text.slice(start,end),next_start:end<d.text.length?end:null};
    }),
    schemaTool('find_paper_source_text','Find literal text in a fetched source, returning offsets. Read the relevant windows before citing them.',z.object({sourceId:text,query:text.max(500)}).strict(),async({sourceId,query})=>{
      const d=dossier.documents.find(x=>x.id===sourceId);if(!d)throw new Error('source unavailable');const hits=[];
      for(let i=d.text.toLowerCase().indexOf(query.toLowerCase());i>=0&&hits.length<20;i=d.text.toLowerCase().indexOf(query.toLowerCase(),i+1))hits.push(i);
      return {offsets:hits};
    }),
    ...(level==='L1'?[schemaTool('fetch_paper_source','Retrieve a public original source, preferring HTML then PDF. No login, credentials, browser code or private addresses. At most 8 new source requests per call.',z.object({url:z.string().url()}).strict(),async({url})=>{
      const old=dossier.documents.find(d=>d.url===url);if(old)return sourceSummary().find(d=>d.id===old.id);
      if(++fetches>8||dossier.documents.filter(d=>d.kind!=='metadata').length>=8)return {unavailable:true,reason:'source budget exhausted; record evidence gap, not contradiction'};
      try{const d=await fetcher(url);if(d.text.length>1000000)throw new SourceUnavailable('source text too large');if(!dossier.documents.some(x=>x.id===d.id))dossier.documents.push(d);await save();return sourceSummary().find(x=>x.id===d.id);}
      catch(e){if(!(e instanceof SourceUnavailable))throw e;dossier.errors.push({url,reason:e.message});await save();return {unavailable:true,reason:e.message};}
    })]:[]),
    schemaTool('submit_paper_verification','Read the note and cited source windows. Only evidenced contradictions block admission. Missing sources/evidence pass with gaps. The server derives passed/verified from the detailed outcomes.',level==='L1'?identitySchema:contentSchema,async(value)=>{
      if(notePages.size!==Math.ceil(paper.note.length/12000))throw new Error('read the entire note before deciding');
      result=level==='L1'?validateIdentity(value,paper,dossier,read):validateContent(value,paper,identity!,dossier,read);
      return {accepted:true};
    },true),
  ];
  const search=await openSearch(dossier,save);
  try{await invoke('manager',{mode:'paper_verification',level,instructions,metadata:paper.metadata,noteCharacters:paper.note.length,notePages:Math.ceil(paper.note.length/12000),contentHash:hash(paper),identity,sources:sourceSummary(),sourceErrors:dossier.errors},[...tools,...search.tools],currentPolicy);}
  finally{await search.close();}
  if(!result)throw new Error('paper verifier returned no decision');return result;
}
