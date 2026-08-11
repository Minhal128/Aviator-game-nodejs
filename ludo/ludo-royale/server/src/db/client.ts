/**
 * MySQL access layer shared by BOTH processes (ludo-api and ludo-game):
 * one mysql2 pool wrapped by Drizzle over the full §7 schema.
 *
 * Services receive a `Db` (or a `Tx` inside transactions) — they never build
 * their own pool. Tests create an isolated instance from DATABASE_URL_TEST.
 */
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql, { type Pool } from 'mysql2/promise';
import * as schema from './schema.js';

export type Db = MySql2Database<typeof schema>;

/**
 * Transaction handle as passed to `db.transaction(async (tx) => ...)`.
 * Derived instead of imported: drizzle's transaction generics are internal.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Anything a service can run queries on. */
export type DbConn = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: Pool;
  /** Drain the pool — graceful shutdown and test teardown. */
  close: () => Promise<void>;
}

/**
 * Build a pool + drizzle instance from a `mysql://user:pass@host:port/name`
 * URL. `timezone: 'Z'` keeps the §7 convention: DATETIME columns hold UTC,
 * written by the app, regardless of the host timezone.
 */
export function createDb(databaseUrl: string, connectionLimit = 10): DbHandle {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit,
    timezone: 'Z',
    // DECIMAL comes back as string (exact); BIGINT as number — safe for a
    // virtual-coins economy (see schema.ts money note).
    decimalNumbers: false,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
