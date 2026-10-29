import {z} from 'zod';
import {experienceSchema} from './domain.js';
export const feedbackSchema=z.object({
  strategy_id:z.string().uuid(),revision:z.number().int().positive(),
  suggested_status:z.enum(['disabled','need_revised']),reason:z.string().trim().min(1).max(8000),
  context:z.object({runId:z.string().min(1).max(200),agentId:z.string().min(1).max(200),
    role:z.enum(['worker','manager','scoper','paper']),task:z.string().min(1).max(2000),
    situation:z.string().trim().min(1).max(8000),action:z.string().trim().min(1).max(8000),
    outcome:z.string().trim().min(1).max(8000),evidence:z.array(z.string().trim().min(1).max(8000)).min(1).max(20)}).strict(),
  correction:z.string().trim().min(1).max(8000).optional(),related_feedback_id:z.string().uuid().optional(),
}).strict();
export const assessmentSchema=z.object({action:z.enum(['retain','disable','revise','reactivate']),reason:z.string().min(1).max(8000),
  evidenceNeeded:z.array(z.string().min(1).max(2000)).max(20).optional()}).strict();
export const draftSchema=z.object({content:experienceSchema.optional(),reason:z.string().min(1).max(8000)}).strict();
export const verificationSchema=z.object({approved:z.boolean(),reason:z.string().min(1).max(8000)}).strict();
export function checkIdentity(old:any,next:any) {
  if(next.role!==old.role||next.sourceType!==old.sourceType)throw new Error('strategy role/sourceType cannot change');
}
export function assertVersion(record:any,snapshot:any) {
  if(record.current_revision!==snapshot.current_revision||record.status_version!==snapshot.status_version)
    throw new Error('strategy version changed; reassessment required');
}
export function expired(record:any,now:number,days=90) {
  return record.strategy_status==='active'&&!record.inactivity_exempt &&
    now-Math.max(Date.parse(record.activity_started_at),record.last_retrieved_at?Date.parse(record.last_retrieved_at):0)>=(record.inactivity_days??days)*86400000;
}
