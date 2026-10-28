import { z } from 'zod';
import { config } from './config.js';
import type { Kind, Payload } from './domain.js';
const vector = z.array(z.number().finite()).length(1024);
export const preparedSchema = z.object({
  model_version: z.string(), chunks: z.array(z.object({ text: z.string().min(1), location: z.record(z.string(),z.unknown()), embedding: vector })).min(1),
});
export type Prepared = z.infer<typeof preparedSchema>;
async function post(path: string, body: unknown) {
  const response = await fetch(config.embeddingUrl+path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`embedding ${path} failed: HTTP ${response.status}`);
  return response.json();
}
export async function prepare(kind: Kind, payload: Payload): Promise<Prepared> { return preparedSchema.parse(await post('/prepare', { kind,payload })); }
export async function queryVector(text: string) {
  return z.object({ embedding: vector, model_version: z.string() }).parse(await post('/query', { text }));
}
export function vectorSql(value: number[]): string { vector.parse(value); return '['+value.join(',')+']'; }
