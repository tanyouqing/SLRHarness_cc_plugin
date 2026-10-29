import {z} from 'zod';
import {validateTrajectory} from './domain.js';

export const triageSchema=z.object({
  kind:z.enum(['failure','recovered_success','routine_success','unique_success','unknown']),
  reason:z.string().min(1).max(2000),
  evidence:z.array(z.object({start:z.number().int().min(1),end:z.number().int().min(1),observation:z.string().min(1).max(2000)}).strict()).max(20),
  uniqueValue:z.string().min(1).max(2000).optional(),
}).strict();
export type Triage=z.infer<typeof triageSchema>;
export function checkTriage(value:unknown,lineCount:number):Triage {
  const result=triageSchema.parse(value);
  if(result.kind!=='unknown'&&!result.evidence.length)throw new Error('triage outcome requires evidence');
  if(result.kind==='unique_success'&&!result.uniqueValue)throw new Error('unique success requires specific value');
  if(result.evidence.some(e=>e.end<e.start||e.end>lineCount))throw new Error('triage evidence outside trajectory');
  return result;
}
// These are navigation hints, never an outcome classifier. Quoted errors may be
// false positives; absence of a match is not evidence of error-free execution.
export function triageOverview(content:string) {
  const lines=validateTrajectory(content),hints:number[]=[];
  lines.forEach((line,i)=>{if(/is_error|error|fail|timeout|denied|retry|recover|修复|失败|报错|重试/i.test(line))hints.push(i+1);});
  const selected=[...new Set([1,2,3,...hints.slice(0,6),...hints.slice(-6),...Array.from({length:6},(_,i)=>lines.length-i)])]
    .filter(n=>n>=1&&n<=lines.length).sort((a,b)=>a-b);
  return {lineCount:lines.length,hintCount:hints.length,hintLines:hints.slice(0,200),hintsTruncated:hints.length>200,
    excerpts:selected.map(line=>({line,text:lines[line-1].slice(0,1000),truncated:lines[line-1].length>1000})),
    coverage:'Selected excerpts only; absence of error hints does not prove success. Read relevant windows or return unknown.'};
}
