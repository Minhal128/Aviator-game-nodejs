/**
 * PROCESS #2 of the product: ludo-game (ARQUITECTURA §2.1).
 *
 * Binds to 127.0.0.1:8107 by default — nginx terminates TLS and proxies the
 * WebSocket upgrade (§11.4). The REST/admin process (ludo-api) is a separate
 * entrypoint so this event-loop never competes with uploads or admin
 * reports (§2.3 "why two processes").
 *
 * Persistence (Sprint 3b): with DATABASE_URL set, the shared GameServices
 * container is initialized and LudoRoom persists matches + pays prizes
 * through MatchService (§2.2 — direct services, no internal HTTP hop).
 * Without it the game server still boots and plays free matches with
 * prizes 0 (dev/test mode) — loudly, so a misconfigured production install
 * is visible in the PM2 logs.
 */
import server from './app.config.js';
import { env } from './config/env.js';
import { loadEnvFiles } from './config/envFile.js';
import { initGameServices } from './services/gameServices.js';
import { log } from './logger.js';

// Note: env.ts (GAME_PORT/GAME_HOST) is evaluated at import time, BEFORE this
// call — unchanged Sprint 2 behavior. loadEnvFiles here feeds DATABASE_URL.
loadEnvFiles();

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  initGameServices(databaseUrl);
  log.info('ludo-game persistence enabled (shared services over DATABASE_URL)');
} else {
  log.warn(
    'ludo-game running WITHOUT DATABASE_URL — matches are not persisted and prizes are 0',
  );
}

await server.listen(env.gamePort, env.gameHost);
log.info('ludo-game listening', { host: env.gameHost, port: env.gamePort });
