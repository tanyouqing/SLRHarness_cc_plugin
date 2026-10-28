import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateTrajectory } from './domain.js';

export const sha256=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const trajectoryMetadata=z.object({
  runId:z.string().min(1),agentId:z.string().min(1),sessionId:z.string().min(1),
  agentRole:z.enum(['worker','manager','scoper','paper','checker','reviewer','main','other']),
  task:z.string().min(1).optional(),stage:z.string().min(1).optional(),
  originalHash:digest,projectionVersion:z.string().min(1),
  // Each projected event carries its original line. This avoids repeating a large mapping in every request.
  lineMapping:z.literal('embedded-originalLine'),
}).strict();
export type TrajectoryMetadata=z.infer<typeof trajectoryMetadata>;
export const transferSchema=z.object({id:digest,index:z.number().int().min(0),count:z.number().int().min(1).max(10000),contentHash:digest}).strict()
  .refine(v=>v.index<v.count,'trajectory part index outside count');
export const trajectoryInput=z.object({content:z.string().min(1),metadata:trajectoryMetadata.optional(),transfer:transferSchema.optional()}).strict()
  .refine(v=>!v.transfer||Buffer.byteLength(v.content)<=4*1024*1024,'trajectory part exceeds 4 MiB');
export type TrajectoryInput=z.infer<typeof trajectoryInput>;
export function assemble(parts:{index:number;content:string}[],count:number,expected:string):string|null {
  if(parts.length!==count)return null;
  const sorted=[...parts].sort((a,b)=>a.index-b.index);
  if(sorted.some((p,i)=>p.index!==i))throw new Error('trajectory part sequence invalid');
  const text=sorted.map(p=>p.content).join('');
  if(sha256(text)!==expected)throw new Error('trajectory content hash mismatch');
  validateTrajectory(text);return text;
}
