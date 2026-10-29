import {z} from 'zod';
export const feedbackSchema=z.object({
  strategy_id:z.string().uuid(),revision:z.number().int().positive(),suggested_status:z.enum(['disabled','need_revised']),reason:z.string().trim().min(1).max(8000),
  context:z.object({runId:z.string().min(1).max(200),agentId:z.string().min(1).max(200),role:z.enum(['worker','manager','scoper','paper']),task:z.string().min(1).max(2000),
    situation:z.string().trim().min(1).max(8000),action:z.string().trim().min(1).max(8000),outcome:z.string().trim().min(1).max(8000),
    evidence:z.array(z.string().trim().min(1).max(8000)).min(1).max(20)}).strict(),
  correction:z.string().trim().min(1).max(8000).optional(),related_feedback_id:z.string().uuid().optional(),
}).strict();
