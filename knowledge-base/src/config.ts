import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
const positive = (key: string, fallback: number) => z.coerce.number().int().positive().parse(process.env[key] ?? fallback);
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://kb:invalid@localhost:5432/kb',
  embeddingUrl: process.env.EMBEDDING_URL ?? 'http://localhost:8000',
  port: positive('PORT', 3000), token: process.env.MCP_TOKEN ?? '',
  bodyLimit: positive('MAX_REQUEST_BYTES', 16 * 1024 * 1024),
  piDir: resolve(process.env.PI_CONFIG_DIR ?? './config'),
  maxAttempts: positive('JOB_MAX_ATTEMPTS', 3), leaseSeconds: positive('JOB_LEASE_SECONDS', 120),
  agentConfig: resolve(process.env.AGENT_CONFIG ?? './config/agents.json'),
};
export const roleConfigSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), maxTurns: z.number().int().positive().default(20), timeoutSeconds: z.number().int().positive().default(300) });
export function agentConfig() {
  return z.object({ manager: roleConfigSchema, distiller: roleConfigSchema }).parse(JSON.parse(readFileSync(config.agentConfig, 'utf8')));
}
