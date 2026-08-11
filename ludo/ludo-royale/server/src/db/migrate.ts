/**
 * Applies drizzle/0000_init.sql (the 41-table §7 baseline) to the database.
 *
 * The baseline uses CREATE TABLE IF NOT EXISTS, so this is idempotent — safe
 * for the installer (step 2 of the wizard, §11.2), for dev bootstrap and for
 * the test harness. Future drizzle-kit migrations (0001_*.sql…) run in
 * filename order after it.
 *
 * CLI: npm run db:migrate  (uses DATABASE_URL, .env files respected)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/** Run every drizzle/*.sql file, in filename order, against `databaseUrl`. */
export async function applyMigrations(
  databaseUrl: string,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // multipleStatements only here: migration files are trusted local assets,
  // never user input.
  const conn = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
  try {
    for (const file of files) {
      await conn.query(readFileSync(join(migrationsDir, file), 'utf8'));
    }
  } finally {
    await conn.end();
  }
  return files;
}

// -- CLI entrypoint ---------------------------------------------------------
// Path-suffix check instead of comparing import.meta.url: robust under both
// tsx (src/db/migrate.ts) and compiled node (dist/db/migrate.js) on Windows
// and POSIX.

const isCli = process.argv[1]
  ? resolve(process.argv[1]).replace(/\\/g, '/').endsWith('/db/migrate.ts') ||
    resolve(process.argv[1]).replace(/\\/g, '/').endsWith('/db/migrate.js')
  : false;

if (isCli) {
  const { loadEnvFiles } = await import('../config/envFile.js');
  loadEnvFiles();
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('db:migrate — DATABASE_URL is not set (env or .env file)\n');
    process.exit(1);
  }
  const applied = await applyMigrations(url);
  process.stdout.write(`db:migrate — applied ${applied.length} file(s): ${applied.join(', ')}\n`);
}
