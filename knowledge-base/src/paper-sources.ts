import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,normalizeDoi,type Paper} from './domain.js';
import {createHash} from 'node:crypto';

export type Document={id:string;url:string;kind:'metadata'|'html'|'pdf';text:string;hash:string;fetchedAt:string;links:string[];metadata:Record<string,unknown>;independent?:boolean};
export type Dossier={documents:Document[];errors:{url:string;reason:string}[];searched:boolean};
export class SourceUnavailable extends Error {}
export function publicIPv4(ip:string) {
  const a=ip.split('.').map(Number);
  if(a.length!==4||a.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===100&&a[1]>=64&&a[1]<=127||
    a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&[0,2,168].includes(a[1])||
    a[0]===198&&[18,19,51].includes(a[1])||a[0]===203&&a[1]===0&&a[2]===113);
}
export function sourceUrl(value:string) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw new SourceUnavailable('public HTTPS source required');
  u.hash='';return u;
}
export async function resolvePublic(host:string,resolver=lookup) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const addresses=await Promise.race([resolver(host,{family:4,all:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new SourceUnavailable('source DNS timeout')),10000);})]);
    if(!addresses.length||addresses.some(x=>!publicIPv4(x.address)))throw new SourceUnavailable('source address is not public');
    return addresses;
  }catch(e){if(e instanceof SourceUnavailable)throw e;throw new SourceUnavailable('source DNS unavailable');}
  finally{clearTimeout(timer);}
}
let arxivAfter=0;
// Resolve once and pin the socket to a checked public IPv4 address; recheck each redirect.
export async function fetchPublic(value:string,redirects=0):Promise<{url:string;body:Buffer;type:string}> {
  const u=sourceUrl(value);
  if(redirects>5)throw new SourceUnavailable('too many source redirects');
  if(u.hostname==='export.arxiv.org') {const wait=Math.max(0,arxivAfter-Date.now());arxivAfter=Math.max(Date.now(),arxivAfter)+3000;if(wait)await new Promise(r=>setTimeout(r,wait));}
  const addresses=await resolvePublic(u.hostname);
  const response=await new Promise<{status:number;location?:string;type:string;body:Buffer}>((resolve,reject)=>{
    const timer=setTimeout(()=>{req.destroy(new SourceUnavailable('source timeout'));},20000);
    const req=request(u,{agent:false,family:4,
      lookup:((_host:any,opts:any,cb:any)=>opts.all?cb(null,[addresses![0]]):cb(null,addresses![0].address,4)) as any,
      headers:{'User-Agent':'SurveyKB-PaperVerifier/1.0','Accept':'text/html,application/pdf,application/json,application/atom+xml','Accept-Encoding':'identity'}},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024)req.destroy(new SourceUnavailable('source exceeds 32 MiB'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode??0,location:res.headers.location,type:String(res.headers['content-type']??''),body:Buffer.concat(chunks)}));
    });
    req.on('error',()=>reject(new SourceUnavailable('source connection failed or timed out')));
    req.on('close',()=>clearTimeout(timer));req.end();
  });
  if(response.status>=300&&response.status<400&&response.location)return fetchPublic(new URL(response.location,u).href,redirects+1);
  if(response.status!==200)throw new SourceUnavailable(`source HTTP ${response.status}`);
  return {url:u.href,body:response.body,type:response.type};
}
const execute=promisify(execFile);
export async function document(url:string,fetcher=fetchPublic):Promise<Document> {
  const r=await fetcher(url);const rawHash=createHash('sha256').update(r.body).digest('hex');
  const base={id:hash({url:r.url,rawHash}),url:r.url,hash:rawHash,fetchedAt:new Date().toISOString()};
  if(/json|xml|atom/.test(r.type))return {...base,kind:'metadata',text:r.body.toString('utf8'),links:[],metadata:{}};
  const pdf=r.body.subarray(0,5).toString()==='%PDF-';
  if(!pdf&&!/html/i.test(r.type))throw new SourceUnavailable('unsupported paper source type');
  const dir=await mkdtemp(join(tmpdir(),'kb-paper-'));
  try {
    const file=join(dir,pdf?'source.pdf':'source.html');await writeFile(file,r.body,{mode:0o600});
    const {stdout}=await execute('python3',[fileURLToPath(new URL('../scripts/paper-text.py',import.meta.url)),pdf?'pdf':'html',file],{timeout:40000,maxBuffer:8*1024*1024});
    const p=JSON.parse(stdout);
    if(!p.text?.trim())throw new Error('empty text');
    const text=(Object.keys(p.metadata).length?JSON.stringify(p.metadata)+'\n':'')+p.text;
    return {...base,kind:pdf?'pdf':'html',text,links:p.links.slice(0,2000).flatMap((link:string)=>{try{return [sourceUrl(new URL(link,r.url).href).href];}catch{return [];}}),metadata:p.metadata};
  }catch{throw new SourceUnavailable('paper text unavailable; PDF may be scanned or extraction failed');}
  finally{await rm(dir,{recursive:true,force:true});}
}
export function discoveryUrls(paper:Paper) {
  const m=paper.metadata;
  const urls=[`https://api.crossref.org/works?rows=3&query.bibliographic=${encodeURIComponent([m.title,...m.authors.slice(0,2)].join(' '))}`];
  if(m.doi)urls.push('https://api.crossref.org/works/'+encodeURIComponent(normalizeDoi(m.doi)!));
  if(m.arxivId)urls.push('https://export.arxiv.org/api/query?id_list='+encodeURIComponent(m.arxivId.replace(/^arxiv:/i,'')));
  return urls;
}
export async function discover(paper:Paper,dossier:Dossier,save:()=>Promise<void>,fetcher=document) {
  for(const url of discoveryUrls(paper)) {
    if(dossier.documents.some(d=>d.url===url))continue;
    try{const d=await fetcher(url);if(d.text.length>1000000)throw new SourceUnavailable('metadata too large');dossier.documents.push({...d,independent:true});dossier.searched=true;}
    catch(e){if(!(e instanceof SourceUnavailable))throw e;dossier.errors.push({url,reason:e.message});}
    await save();
  }
}
