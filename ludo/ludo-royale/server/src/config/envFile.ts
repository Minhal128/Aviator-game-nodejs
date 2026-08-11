/**
 * Minimal .env loader (no dotenv dependency, same zero-dep spirit as the
 * Sprint 2 logger). Loads KEY=VALUE pairs WITHOUT overriding variables the
 * process already has, so PM2/launchd/CI env always wins.
 *
 * Search order (first hit per key wins): server/.env, then repo-root/.env —
 * ARQUITECTURA §2.2 puts the canonical .env at the monorepo root; the
 * server-local file is a dev convenience.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// src/config/ and dist/config/ sit at the same depth below server/.
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, '..', '..');
const ROOT_DIR = resolve(SERVER_DIR, '..');

function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  // Strip one layer of matching quotes.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/** Load default .env files into process.env (existing keys untouched). */
export function loadEnvFiles(
  paths: string[] = [resolve(SERVER_DIR, '.env'), resolve(ROOT_DIR, '.env')],
): void {
  // Tests must be hermetic: never leak the developer's .env (production
  // DATABASE_URL!) into vitest — suites opt in via DATABASE_URL_TEST only.
  if (process.env.VITEST) return;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const pair = parseLine(line);
      if (pair && process.env[pair[0]] === undefined) {
        process.env[pair[0]] = pair[1];
      }
    }
  }
}
