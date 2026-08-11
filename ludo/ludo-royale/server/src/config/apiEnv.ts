/**
 * Environment for the ludo-api process, validated with zod (ARQUITECTURA §3
 * config/env.ts + §9.11: abort at boot with a clear message instead of
 * "starts but fails weird").
 *
 * Kept separate from config/env.ts (game process): the game server must keep
 * booting for Sprint 2 tests without DATABASE_URL/JWT_SECRET. Exposed as a
 * function, not a top-level constant, so callers control WHEN process.env is
 * read (after loadEnvFiles(), or after a test sets its own vars).
 */
import { z } from 'zod';

const apiEnvSchema = z.object({
  /** [DECISIÓN] dev default 8110 (task contract); the installer writes 3000. */
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8110),
  /** Keep 127.0.0.1 behind nginx (§11.4); 0.0.0.0 only for LAN testing. */
  API_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('mysql://'), 'DATABASE_URL must be a mysql:// URL'),
  /** HS256 secret shared by both processes (§8.2) — 256-bit minimum. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters (256-bit)'),
  /**
   * Comma-separated list of allowed browser origins for CORS. Empty/unset =
   * same-origin only (nginx serves client and API under one domain, §11.4);
   * set it when the web client is hosted on a different origin.
   */
  ALLOWED_ORIGINS: z.string().optional(),
});

export interface ApiEnv {
  apiPort: number;
  apiHost: string;
  databaseUrl: string;
  jwtSecret: string;
  allowedOrigins: string[];
}

/** Parse and validate process.env; throws a readable multi-line error. */
export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n');
    throw new Error(`ludo-api cannot boot — invalid environment:\n${lines}`);
  }
  const e = parsed.data;
  return {
    apiPort: e.API_PORT,
    apiHost: e.API_HOST,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    allowedOrigins: (e.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o !== ''),
  };
}
