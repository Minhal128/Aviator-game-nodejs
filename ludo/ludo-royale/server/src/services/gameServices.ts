/**
 * Shared service container (ARQUITECTURA §2.2 [DECISIÓN ARQ]): both
 * processes build the SAME service graph over one Drizzle pool — the game
 * server writes match results and prizes directly through WalletService/
 * MatchService, no internal HTTP hop.
 *
 * The game process treats persistence as OPTIONAL: without DATABASE_URL,
 * getGameServices() stays null and LudoRoom plays exactly like Sprint 2
 * (prizes 0, nothing persisted) — that is what keeps the 26 multiplayer
 * tests DB-free. Tests with a database inject their own container through
 * setGameServices() (module registries are per-file under vitest, so no
 * cross-suite bleed).
 */
import { createDb, type Db } from '../db/client.js';
import { DailyBonusService } from './DailyBonusService.js';
import { FriendsService } from './FriendsService.js';
import { InventoryService } from './InventoryService.js';
import { LeaderboardService } from './LeaderboardService.js';
import { MailService } from './MailService.js';
import { MatchService } from './MatchService.js';
import { MissionService } from './MissionService.js';
import { SettingsService } from './SettingsService.js';
import { ShopService } from './ShopService.js';
import { WalletService } from './WalletService.js';
import { XpService } from './XpService.js';

export interface GameServices {
  db: Db;
  settings: SettingsService;
  wallet: WalletService;
  xp: XpService;
  missions: MissionService;
  dailyBonus: DailyBonusService;
  shop: ShopService;
  inventory: InventoryService;
  leaderboard: LeaderboardService;
  mail: MailService;
  friends: FriendsService;
  matches: MatchService;
  close: () => Promise<void>;
}

/** Build the full service graph over an existing Db (shared by api + tests). */
export function buildGameServices(db: Db, close: () => Promise<void> = async () => {}): GameServices {
  const settings = new SettingsService(db);
  const wallet = new WalletService(db);
  const xp = new XpService(db, wallet);
  const missions = new MissionService(db, wallet);
  const dailyBonus = new DailyBonusService(db, wallet, settings);
  const shop = new ShopService(db, wallet);
  const inventory = new InventoryService(db);
  const leaderboard = new LeaderboardService(db, settings);
  const mail = new MailService(db, wallet);
  const friends = new FriendsService(db, mail);
  const matches = new MatchService(db, { wallet, settings, xp, missions, leaderboard, mail });
  return {
    db,
    settings,
    wallet,
    xp,
    missions,
    dailyBonus,
    shop,
    inventory,
    leaderboard,
    mail,
    friends,
    matches,
    close,
  };
}

let current: GameServices | null = null;

/** Boot-time init for the ludo-game process (game.entry.ts). */
export function initGameServices(databaseUrl: string): GameServices {
  const handle = createDb(databaseUrl);
  current = buildGameServices(handle.db, handle.close);
  return current;
}

/** null = persistence disabled — rooms play with prizes 0 (Sprint 2 mode). */
export function getGameServices(): GameServices | null {
  return current;
}

/** Test hook: inject a suite-owned container (or null to disable). */
export function setGameServices(services: GameServices | null): void {
  current = services;
}
