/**
 * Minimal leveled logger for the game server: timestamped lines to
 * stdout/stderr, no dependencies, silent under vitest (env.ts defaults
 * LOG_LEVEL to `silent` when NODE_ENV=test/VITEST).
 */
import { env } from './config/env.js';

type Level = 'error' | 'warn' | 'info' | 'debug';

const WEIGHT: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const THRESHOLD = env.logLevel === 'silent' ? -1 : WEIGHT[env.logLevel];

function write(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (WEIGHT[level] > THRESHOLD) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}${
    meta ? ` ${JSON.stringify(meta)}` : ''
  }\n`;
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
}

export const log = {
  error: (msg: string, meta?: Record<string, unknown>): void => write('error', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>): void => write('warn', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>): void => write('info', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>): void => write('debug', msg, meta),
};
