import { createHash } from 'node:crypto';
import { z } from 'zod';

export const kindSchema = z.enum(['paper', 'experience']);
export type Kind = z.infer<typeof kindSchema>;
const text = z.string().trim().min(1);
export const metadataSchema = z.object({
  title: text, authors: z.array(text), year: z.number().int().min(1000).max(3000).nullable(),
  canonicalUrl: z.string().url().nullable(), doi: z.string().nullable(),
  arxivId: z.string().nullable(), venue: z.string().nullable(),
}).strict();
export const paperSchema = z.object({ metadata: metadataSchema, note: text }).strict();
export const experienceRoles = ['worker', 'manager', 'scoper', 'paper'] as const;
export const experienceRoleSchema = z.enum(experienceRoles).describe('Applicable role; trajectory experiences must inherit trusted source agentRole. Direct review experiences may advise any of the four roles.');
export const experienceSchema = z.object({
  sourceType: z.enum(['review', 'trajectory']), role: experienceRoleSchema,
  stage: text.optional().describe('Applicable workflow stage, only when supported by evidence.'),
  task: text.optional().describe('Specific task at the time, only when known.'),
  executionSummary: text.describe('Observed actions, outcome, errors and repairs; distinguish observations from inferences.'),
  strategy: text.describe('Concrete reusable advice for the selected role, grounded in the supplied evidence.'),
  applicability: text.optional().describe('Known preconditions and limitations; omission does not mean universal applicability.'),
}).strict();
export const rangeSchema = z.object({ start: z.number().int().positive(), end: z.number().int().positive() })
  .strict().refine(x => x.end >= x.start, 'end must be >= start');
export const sourceSchema = z.object({ type: z.literal('trajectory'), id: z.string().uuid(), event_range: rangeSchema.optional() }).strict();
export type Source = z.infer<typeof sourceSchema>;
export const experienceInput = z.object({ experience: experienceSchema, sources: z.array(sourceSchema).max(100).default([]) })
  .strict().refine(x => x.experience.sourceType !== 'trajectory' || x.sources.length > 0, 'trajectory experience requires sources');
export const paperFilters = z.object({ year_from: z.number().int().optional(), year_to: z.number().int().optional(), author: text.optional(), venue: text.optional(), doi: text.optional(), arxivId: text.optional() }).strict();
export const strategyFilters = z.object({ role: experienceRoleSchema.optional(), stage: text.optional(), sourceType: z.enum(['review', 'trajectory']).optional() }).strict();
export const paperSearch = z.object({ query: text.max(8000), filters: paperFilters.default({}), limit: z.number().int().min(1).max(50).default(10) }).strict();
export const strategySearch = z.object({ query: text.max(8000), filters: strategyFilters.default({}), limit: z.number().int().min(1).max(50).default(10) }).strict();
export const readSchema = z.object({ type: z.enum(['paper', 'experience', 'trajectory']), id: z.string().uuid(), revision: z.number().int().positive().optional(), event_range: rangeSchema.optional() }).strict()
  .refine(x => x.type === 'trajectory' ? x.revision === undefined : x.event_range === undefined, 'revision applies to papers/experiences; event_range to trajectories');
export const decisionSchema = z.object({
  action: z.enum(['new', 'duplicate', 'supplement', 'keep_separate']),
  targetId: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(),
  reason: text, evidence: z.array(text).min(1), proposedContent: z.unknown().optional(),
}).strict();
export type Decision = z.infer<typeof decisionSchema>;
export type Paper = z.infer<typeof paperSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Payload = Paper | Experience;
export function normalizeDoi(value: string | null | undefined): string | null {
  return value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase() || null;
}
export function normalizeArxiv(value: string | null | undefined): string | null {
  return value?.trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '').replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '').toLowerCase() || null;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(typeof value === 'string' ? value.normalize('NFC').replace(/\r\n/g, '\n') : value);
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function validateTrajectory(content: string): string[] {
  if (!content.trim()) throw new Error('trajectory must not be empty');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const [index,line] of lines.entries()) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`invalid JSON at line ${index+1}`); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`line ${index+1} must be an object`);
  }
  return lines;
}
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function keywords(value: string): string {
  return [...segmenter.segment(value.normalize('NFKC').toLowerCase())].filter(s => s.isWordLike).map(s => s.segment).join(' ');
}
export function searchText(kind: Kind, payload: Payload): string {
  if (kind === 'paper') { const p = payload as Paper; return p.metadata.title+'\n'+p.note; }
  const e = payload as Experience;
  return [e.task,e.applicability,e.strategy,e.executionSummary.slice(0,1200)].filter(v=>v!==undefined).join('\n');
}
export function validateDecision(value: unknown, kind: Kind, candidateIds: string[]): Decision {
  const d = decisionSchema.parse(value);
  if (d.action !== 'new' && (!d.targetId || !candidateIds.includes(d.targetId) || !d.expectedRevision)) throw new Error('decision must reference a retrieved candidate and revision');
  if (d.action === 'new' && d.targetId) throw new Error('new must not specify targetId');
  if (d.action === 'supplement') (kind === 'paper' ? paperSchema : experienceSchema).parse(d.proposedContent);
  return d;
}
export function fuse<T extends { id: string; entity_id: string }>(a: T[], b: T[], limit: number): (T & { score: number })[] {
  const scores = new Map<string, T & { score: number }>();
  for (const list of [a,b]) list.forEach((r,i) => { const old = scores.get(r.id); scores.set(r.id, { ...r, score: (old?.score ?? 0)+1/(60+i+1) }); });
  const seen = new Set<string>();
  return [...scores.values()].sort((x,y) => y.score-x.score || x.id.localeCompare(y.id)).filter(r => {
    if (seen.has(r.entity_id)) return false; seen.add(r.entity_id); return true;
  }).slice(0,limit);
}
