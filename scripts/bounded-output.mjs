import fs from 'node:fs';
import path from 'node:path';
import {researchScale} from './research-profile.mjs';

export const RESPONSE_LIMIT=8000, READ_LIMIT=24000;
export function safePath(root, relative) {
  if(typeof relative!=='string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('relative workspace path required');
  const file=path.resolve(root,relative);
  const distance=path.relative(path.resolve(root),file);
  if(path.isAbsolute(distance)||distance==='..'||distance.startsWith(`..${path.sep}`))throw new Error('path outside workspace');
  let p=file;
  while(p!==path.resolve(root)) {
    if(fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error('symbolic links are not permitted');
    p=path.dirname(p);
  }
  return file;
}
export function bounded(value, source, next='Use query or read with offset/limit; --full is diagnostic only') {
  if(JSON.stringify(value).length<=RESPONSE_LIMIT) return value;
  return {ok:true,oversize:true,source,next};
}
export function page(items,{offset=0,limit=20}={},source) {
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100) throw new Error('invalid page offset/limit');
  const result={total:items.length,offset,items:[],nextOffset:null,source};
  for(let i=offset;i<Math.min(items.length,offset+limit);i++) {
    let item=items[i];
    if(JSON.stringify(item).length>RESPONSE_LIMIT-1000) item={id:item?.id??i,oversize:true,source,index:i,next:'Read source by character offset'};
    if(JSON.stringify({...result,items:[...result.items,item]}).length>RESPONSE_LIMIT-200) break;
    result.items.push(item);
  }
  if(offset+result.items.length<items.length) result.nextOffset=offset+result.items.length;
  return result;
}
export function readSlice(root,{file,offset=0,limit=READ_LIMIT}) {
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>READ_LIMIT) throw new Error('invalid read offset/limit');
  const target=safePath(root,file);
  if(!/\.(md|json|tex|bib|log|txt)$/.test(target)) throw new Error('bounded reader accepts text artifacts only');
  const text=fs.readFileSync(target,'utf8'),end=Math.min(text.length,offset+limit);
  return {file,offset,text:text.slice(offset,end),nextOffset:end<text.length?end:null,total:text.length};
}
export function researchSummary(s,action='status',root='.') {
  return bounded({ok:true,action,reviewId:s.reviewId,stage:s.stage,round:s.currentRound,maxRounds:s.maxRounds,maxWorkers:s.maxWorkers,
    researchScale:researchScale(s),scaleCompletion:s.scaleCompletion??null,
    roundOpen:s.roundOpen,topics:s.topics?.map(t=>({id:t.id,status:t.status,tasks:t.tasks.length})),
    counts:{papers:Object.keys(s.papers??{}).length,activeWorkers:Object.values(s.leases??{}).filter(l=>l.active).length},
    source:path.join(root,'.slr/state.json'),next:'query collections: topics, tasks, papers, leases; inspect only relevant IDs'},path.join(root,'.slr/state.json'));
}
export function researchQuery(s,args={},root='.') {
  const {collection='topics',id,topicId}=args;
  let items;
  if(collection==='topics')items=s.topics;
  else if(collection==='tasks')items=s.topics.filter(t=>!topicId||t.id===topicId).flatMap(t=>t.tasks.map(x=>({...x,topicId:t.id})));
  else if(['papers','leases','bindings'].includes(collection))items=Object.entries(s[collection]??{}).map(([id,x])=>({id,...x}));
  else if(collection==='reviewEvents')items=s.reviewEvents;
  else throw new Error('unknown query collection');
  return page(id?items.filter(x=>x.id===id):items,args,path.join(root,'.slr/state.json'));
}
export function reviewSummary(c,action='status',root='.') {
  const sub=c.submissions?.at(-1);
  return bounded({ok:true,action,status:c.status,current:c.current,complete:c.complete,error:c.error,
    submission:sub?{id:sub.id,fingerprint:sub.fingerprint,total:sub.assessment?.total,passed:sub.assessment?.passed,
      issues:sub.assessment?.issues?.length,comparison:sub.assessment?.comparison?.status}:null,
    revisions:c.revisions?.length,pause:c.pause,source:path.join(root,'.slr/final-review.json'),next:'query submissions, revisions or one submission report collection'},path.join(root,'.slr/final-review.json'));
}
export function reviewQuery(c,args={},root='.') {
  const {collection='submissions',id,submissionId}=args;
  const sub=c.submissions?.find(s=>s.id===submissionId)??c.submissions?.at(-1);
  let items;
  if(collection==='submissions')items=c.submissions.map(({assessment,...s})=>({...s,total:assessment?.total,passed:assessment?.passed}));
  else if(collection==='revisions')items=c.revisions;
  else if(['items','issues','priorIssueChecks'].includes(collection))items=sub?.assessment?.[collection]??[];
  else if(collection==='references'||collection==='differences')items=sub?.assessment?.comparison?.[collection]??[];
  else throw new Error('unknown review query collection');
  return page(id?items.filter(x=>x.id===id):items,args,path.join(root,'.slr/final-review.json'));
}
