/**
 * Environment for the ludo-game process. Sprint 2 keeps this dependency-free
 * (no DB, no JWT); the zod-validated full env arrives with the API process
 * in Sprint 3 (ARQUITECTURA §3 server/src/config/env.ts).
 */

export interface GameEnv {
  /** WebSocket port. Behind nginx in production (§11.4). */
  gamePort: number;
  /** Bind address — 127.0.0.1 by default, nginx terminates TLS. */
  gameHost: string;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`GAME_PORT "${raw}" is not a valid TCP port`);
  }
  return port;
}

function readLogLevel(raw: string | undefined): GameEnv['logLevel'] {
  // Tests stay quiet unless the developer explicitly asks for logs.
  if (raw === undefined || raw === '') {
    return process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined
      ? 'silent'
      : 'info';
  }
  const found = LOG_LEVELS.find((level) => level === raw);
  if (!found) throw new RangeError(`LOG_LEVEL "${raw}" must be one of ${LOG_LEVELS.join('|')}`);
  return found;
}

export const env: GameEnv = {
  gamePort: readPort(process.env.GAME_PORT, 8107),
  gameHost: process.env.GAME_HOST ?? '127.0.0.1',
  logLevel: readLogLevel(process.env.LOG_LEVEL),
};
