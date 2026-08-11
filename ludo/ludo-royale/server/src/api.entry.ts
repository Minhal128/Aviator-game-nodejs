/**
 * PROCESS #1 of the product: ludo-api (ARQUITECTURA §2.1).
 *
 * REST /api/* + (Sprint 3c) admin + webhooks. Binds to 127.0.0.1:8110 by
 * default in dev; the installer writes PORT 3000 for production behind
 * nginx (§11.4). Runs beside ludo-game (game.entry.ts) sharing db/ and
 * services/ — same package, two processes (§2.2 [DECISIÓN ARQ]).
 *
 * HOUSEKEEPING SCHEDULER (Sprint 3b): the hourly interval below is THE cron
 * seed of the api process — inventory expiration (§7.5 "cron de expiración
 * cada hora") and the weekly leaderboard snapshot (§7.6, freezes the last
 * finished ISO week on the first run after Monday 00:00 UTC; idempotent).
 * The §7.14 retention/archival jobs join this same interval in Sprint 3c.
 */
import { createApiApp } from './api.app.js';
import { loadApiEnv } from './config/apiEnv.js';
import { loadEnvFiles } from './config/envFile.js';
import { createDb } from './db/client.js';
import { log } from './logger.js';

loadEnvFiles();
const env = loadApiEnv();

const { db, close } = createDb(env.databaseUrl);
const { app, services } = createApiApp({
  db,
  jwtSecret: env.jwtSecret,
  allowedOrigins: env.allowedOrigins,
});

const server = app.listen(env.apiPort, env.apiHost, () => {
  log.info('ludo-api listening', {
    host: env.apiHost,
    port: env.apiPort,
    cors: env.allowedOrigins.length > 0 ? env.allowedOrigins : 'same-origin',
  });
});

// -- housekeeping (see file header) ------------------------------------------

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

async function runHousekeeping(): Promise<void> {
  try {
    const swept = await services.inventory.sweepExpired();
    if (swept > 0) log.info('inventory sweep', { expiredRemoved: swept });
    const frozen = await services.leaderboard.snapshotIfDue();
    if (frozen > 0) log.info('leaderboard weekly snapshot written', { rows: frozen });
  } catch (err) {
    log.error('housekeeping run failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const housekeeping = setInterval(() => void runHousekeeping(), HOUSEKEEPING_INTERVAL_MS);
housekeeping.unref();
void runHousekeeping(); // once at boot (catches a snapshot missed downtime)

// Graceful shutdown: stop accepting, drain the pool, exit. PM2/systemd send
// SIGINT/SIGTERM on restart (§11.3).
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('ludo-api shutting down', { signal });
  clearInterval(housekeeping);
  server.close(() => {
    void close().finally(() => process.exit(0));
  });
  // Hard exit if a keep-alive socket refuses to die.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
