/**
 * drizzle-kit config (ARQUITECTURA §3). Sprint 3a ships a hand-written
 * baseline (drizzle/0000_init.sql); `npm run db:generate` diffs schema.ts for
 * FUTURE migrations only — never regenerate the baseline.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/ludo_royale',
  },
});
