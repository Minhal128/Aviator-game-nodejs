/**
 * Rig for the Sprint 3 DB/API suites. These tests need REAL MySQL (the §7.2
 * wallet contract is about InnoDB row locks — mocking it would test nothing):
 * point DATABASE_URL_TEST at a DISPOSABLE database and run `npm test`.
 * Without DATABASE_URL_TEST the suites self-skip, so the Sprint 2 Colyseus
 * tests keep running anywhere.
 *
 * Lifecycle: beforeAll applies drizzle/0000_init.sql (idempotent) · each test
 * starts from TRUNCATEd lr_ tables + a fresh core seed · afterAll drains the
 * pool. Files already run serially (vitest fileParallelism: false).
 */
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiApp, type ApiAppOptions, type ApiServices } from '../src/api.app.js';
import { createDb, type Db, type DbHandle } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate.js';
import { seedCore } from '../src/db/seed.js';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;

/** 64 chars — comfortably over the 256-bit floor apiEnv enforces. */
export const TEST_JWT_SECRET = 'vitest-only-secret-vitest-only-secret-vitest-only-secret-64char';

/** describe() that self-skips (with a visible title) when no test DB is set. */
export const describeDb = describe.runIf(TEST_DB_URL !== undefined && TEST_DB_URL !== '');

export interface DbSuite {
  db: () => Db;
  handle: () => DbHandle;
}

/**
 * Registers the suite lifecycle hooks and returns lazy accessors (the handle
 * only exists after beforeAll runs).
 */
export function setupDbSuite(): DbSuite {
  let handle: DbHandle | null = null;

  beforeAll(async () => {
    if (!TEST_DB_URL) throw new Error('DATABASE_URL_TEST is required for DB suites');
    await applyMigrations(TEST_DB_URL);
    handle = createDb(TEST_DB_URL);
  });

  beforeEach(async () => {
    if (!handle) throw new Error('suite not initialized');
    await truncateAll(handle);
    await seedCore(handle.db);
  });

  afterAll(async () => {
    await handle?.close();
    handle = null;
  });

  return {
    db: () => {
      if (!handle) throw new Error('suite not initialized');
      return handle.db;
    },
    handle: () => {
      if (!handle) throw new Error('suite not initialized');
      return handle;
    },
  };
}

/** TRUNCATE every lr_ table of the test database (FK checks off). */
async function truncateAll(handle: DbHandle): Promise<void> {
  const [rows] = await handle.pool.query(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name LIKE 'lr\\_%'`,
  );
  const tables = (rows as Array<{ t: string }>).map((r) => r.t);
  const conn = await handle.pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// HTTP rig — boots the real Express app on an ephemeral port
// ---------------------------------------------------------------------------

export interface RunningApp {
  baseUrl: string;
  services: ApiServices;
  close: () => Promise<void>;
}

export function startApp(
  db: Db,
  overrides: Partial<Omit<ApiAppOptions, 'db'>> = {},
): Promise<RunningApp> {
  const { app, services } = createApiApp({
    db,
    jwtSecret: TEST_JWT_SECRET,
    rateLimits: false,
    trustProxy: false,
    ...overrides,
  });
  return new Promise((resolvePromise) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        baseUrl: `http://127.0.0.1:${port}`,
        services,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((err) => (err ? fail(err) : done())),
          ),
      });
    });
  });
}

/** JSON POST returning { status, body } — assertions stay one-liners. */
export async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await parseJson(res) };
}

export async function getJson(
  baseUrl: string,
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await parseJson(res) };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (text === '') return {};
  return JSON.parse(text) as Record<string, unknown>;
}
