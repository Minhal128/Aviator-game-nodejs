/**
 * Express app factory for the ludo-api process. Mirrors app.config.ts on the
 * game side: api.entry.ts boots it for production, tests boot it on an
 * ephemeral port with their own Db and tuned rate limits.
 *
 * Wiring (ARQUITECTURA §8): helmet → CORS (ALLOWED_ORIGINS) → JSON 100kb →
 * global rate umbrella (+ per-bucket auth/claim limits) → routes → 404 →
 * error handler. The service graph is the SAME container the game process
 * uses (buildGameServices) plus AuthService and DailyBonus/Shop-facing
 * routers — one place where economy rules live (§2.2).
 */
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { errorHandler } from './middleware/errorHandler.js';
import { buildRateLimiters, type RateLimitConfig } from './middleware/rateLimit.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createDailyBonusRouter } from './routes/dailyBonus.routes.js';
import { createInventoryRouter } from './routes/inventory.routes.js';
import { createLeaderboardRouter } from './routes/leaderboard.routes.js';
import { createFriendsRouter } from './routes/friends.routes.js';
import { createMailRouter } from './routes/mail.routes.js';
import { createMatchesRouter } from './routes/matches.routes.js';
import { createMissionsRouter } from './routes/missions.routes.js';
import { createProfileRouter } from './routes/profile.routes.js';
import { createShopRouter } from './routes/shop.routes.js';
import { createWheelRouter } from './routes/wheel.routes.js';
import { AuthService } from './services/AuthService.js';
import type { DailyBonusService } from './services/DailyBonusService.js';
import { API_ERR } from './services/errors.js';
import { buildGameServices } from './services/gameServices.js';
import type { InventoryService } from './services/InventoryService.js';
import type { LeaderboardService } from './services/LeaderboardService.js';
import type { MailService } from './services/MailService.js';
import type { MatchService } from './services/MatchService.js';
import type { MissionService } from './services/MissionService.js';
import type { SettingsService } from './services/SettingsService.js';
import type { ShopService } from './services/ShopService.js';
import type { WalletService } from './services/WalletService.js';
import { WheelService } from './services/WheelService.js';
import type { XpService } from './services/XpService.js';

export interface ApiAppOptions {
  db: Db;
  jwtSecret: string;
  /** Exact browser origins allowed via CORS; empty = same-origin only. */
  allowedOrigins?: string[];
  /** false disables rate limiting (tests); partial overrides tune buckets. */
  rateLimits?: false | Partial<RateLimitConfig>;
  /** Express trust-proxy value; nginx runs on the same box (§11.4). */
  trustProxy?: boolean | number | string;
}

export interface ApiServices {
  settings: SettingsService;
  wallet: WalletService;
  xp: XpService;
  auth: AuthService;
  missions: MissionService;
  dailyBonus: DailyBonusService;
  shop: ShopService;
  inventory: InventoryService;
  leaderboard: LeaderboardService;
  mail: MailService;
  matches: MatchService;
  wheel: WheelService;
}

export function createApiApp(options: ApiAppOptions): { app: Express; services: ApiServices } {
  const { db } = options;

  const core = buildGameServices(db);
  const auth = new AuthService(db, core.wallet, core.settings, options.jwtSecret);
  // API-only service (the game process never spins the wheel) — built here
  // instead of buildGameServices so the shared container stays untouched.
  const wheel = new WheelService(db, core.wallet, core.settings);
  const services: ApiServices = {
    settings: core.settings,
    wallet: core.wallet,
    xp: core.xp,
    auth,
    missions: core.missions,
    dailyBonus: core.dailyBonus,
    shop: core.shop,
    inventory: core.inventory,
    leaderboard: core.leaderboard,
    mail: core.mail,
    matches: core.matches,
    wheel,
  };

  const app = express();
  app.set('trust proxy', options.trustProxy ?? 'loopback');
  app.use(helmet());

  const origins = options.allowedOrigins ?? [];
  if (origins.length > 0) {
    app.use(
      cors({
        origin: (origin, cb) => {
          // No Origin header = same-origin/native (Capacitor WebView) — allow.
          if (!origin || origins.includes(origin) || origins.includes('*')) {
            cb(null, true);
          } else {
            cb(null, false);
          }
        },
        credentials: false,
        maxAge: 600,
      }),
    );
  }

  app.use(express.json({ limit: '100kb' }));

  // Health first and unthrottled — the installer and PM2 probe it (§8.1).
  app.get('/api/health', async (_req, res) => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk, uptime: process.uptime() });
  });

  if (options.rateLimits !== false) {
    const limiters = buildRateLimiters(options.rateLimits ?? {});
    app.use('/api', limiters.global);
    app.use('/api/v1/auth/guest', limiters.guest);
    app.use('/api/v1/auth/refresh', limiters.refresh);
    app.use('/api/v1/auth/login', limiters.guest);
    app.use('/api/v1/auth/register', limiters.guest);
    // §8.6: purchase/claim buckets (30/min) — real dedupe is the UNIQUEs.
    app.use('/api/v1/shop/purchase', limiters.claims);
    app.use('/api/v1/daily-bonus/claim', limiters.claims);
    app.use('/api/v1/daily-bonus/claim-double', limiters.claims);
    app.use('/api/v1/missions/:id/claim', limiters.claims);
    app.use('/api/v1/mail/:id/claim', limiters.claims);
    app.use('/api/v1/wheel/spin', limiters.claims);
    app.use('/api/v1/friends/gift', limiters.claims);
    app.use('/api/v1/matches/local-result', limiters.claims);
  }

  app.use('/api/v1/auth', createAuthRouter(auth));
  app.use('/api/v1/profile', createProfileRouter(auth, core.xp));
  app.use('/api/v1/daily-bonus', createDailyBonusRouter(auth, core.dailyBonus));
  app.use('/api/v1/missions', createMissionsRouter(auth, core.missions));
  app.use('/api/v1/shop', createShopRouter(auth, core.shop));
  app.use('/api/v1/inventory', createInventoryRouter(auth, core.inventory));
  app.use('/api/v1/leaderboard', createLeaderboardRouter(auth, core.leaderboard));
  app.use('/api/v1/mail', createMailRouter(auth, core.mail));
  app.use('/api/v1/wheel', createWheelRouter(auth, wheel));
  app.use('/api/v1/friends', createFriendsRouter(auth, core.friends));
  app.use('/api/v1/matches', createMatchesRouter(auth, core.settings, core.wallet, core.xp));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: API_ERR.NOT_FOUND, message: 'not found' } });
  });
  app.use(errorHandler);

  return { app, services };
}
