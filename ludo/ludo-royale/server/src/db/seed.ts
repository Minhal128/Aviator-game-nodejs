/**
 * Core seed (installer step 2, ARQUITECTURA §11.2): settings defaults, the
 * §10.2 feature-flag matrix, the 50-level XP curve, the 7-day daily-bonus
 * calendar, 6 default emotes, 4 room tiers, 5 default daily missions and a
 * DEV-ONLY placeholder admin.
 *
 * Idempotent by design: rows with a natural key upsert as a no-op on
 * duplicate (admin edits are never clobbered by re-running the seed); tiers
 * insert only into an empty table. The installer wizard (Sprint 3c) calls
 * seedCore() right after applyMigrations(); the demo dataset is a separate
 * seed (demo.seed.ts, Sprint 3c).
 *
 * CLI: npm run db:seed  (uses DATABASE_URL)
 */
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createDb, type Db } from './client.js';
import {
  lrAdminUsers,
  lrDailyBonusConfig,
  lrEmotes,
  lrFeatureFlags,
  lrLuckyWheelConfig,
  lrLuckyWheelSegments,
  lrMissions,
  lrRoomTiers,
  lrSettings,
  lrShopItems,
  lrXpLevels,
} from './schema.js';

// ---------------------------------------------------------------------------
// Settings catalog — every setting cited across ARQUITECTURA, grouped as in
// §7.10 (rules / economy / matchmaking / ads / leaderboard / retention /
// general). value is TEXT: bools are '1'/'0', json is serialized.
// ---------------------------------------------------------------------------

type SettingSeed = { key: string; value: string; type: 'string' | 'int' | 'bool' | 'json'; grp: string };

const SETTINGS: SettingSeed[] = [
  // rules (§5.2.9)
  { key: 'rule_block_enabled', value: '1', type: 'bool', grp: 'rules' },
  { key: 'rule_extra_turn_on_capture', value: '1', type: 'bool', grp: 'rules' },
  { key: 'rule_triple_six_forfeit', value: '1', type: 'bool', grp: 'rules' },
  { key: 'rule_play_for_second', value: '1', type: 'bool', grp: 'rules' },
  { key: 'turn_timer_s', value: '15', type: 'int', grp: 'rules' },
  { key: 'auto_move_on_timeout', value: '1', type: 'bool', grp: 'rules' },
  // economy
  { key: 'initial_coins', value: '5000', type: 'int', grp: 'economy' },
  { key: 'initial_gems', value: '50', type: 'int', grp: 'economy' },
  { key: 'private_room_fee', value: '0', type: 'int', grp: 'economy' },
  { key: 'referral_qualify_level', value: '3', type: 'int', grp: 'economy' },
  { key: 'forfeit_penalty_enabled', value: '0', type: 'bool', grp: 'economy' },
  // XP by final placement (index 0 = 1st place) — MatchService (§6.2).
  { key: 'match_xp_place', value: JSON.stringify([100, 60, 40, 25]), type: 'json', grp: 'economy' },
  // matchmaking (§6.3 / §6.6 / §5.6)
  { key: 'matchmaking_bot_after_s', value: '25', type: 'int', grp: 'matchmaking' },
  { key: 'reconnect_grace_s', value: '60', type: 'int', grp: 'matchmaking' },
  { key: 'ai_auto_level', value: '1', type: 'int', grp: 'matchmaking' },
  {
    key: 'bot_names',
    value: JSON.stringify([
      'Ravi', 'Amara', 'Diego', 'Priya', 'Kwame', 'Lucia', 'Arjun', 'Fatima',
      'Mateo', 'Zainab', 'Tunde', 'Ines', 'Rahul', 'Chioma', 'Pablo', 'Ananya',
    ]),
    type: 'json',
    grp: 'matchmaking',
  },
  // ads (§8.4)
  { key: 'ad_reward_daily_cap', value: '5', type: 'int', grp: 'ads' },
  // leaderboard (§7.6) — trophy deltas of the v1.0 score metric
  {
    key: 'leaderboard_rewards',
    value: JSON.stringify({ '1': { coins: 5000 }, '2': { coins: 2500 }, '3': { coins: 1000 } }),
    type: 'json',
    grp: 'leaderboard',
  },
  { key: 'leaderboard_score_win', value: '30', type: 'int', grp: 'leaderboard' },
  { key: 'leaderboard_score_second', value: '10', type: 'int', grp: 'leaderboard' },
  { key: 'leaderboard_score_leave', value: '-10', type: 'int', grp: 'leaderboard' },
  // retention (§7.14 + engagement mails)
  { key: 'ledger_retention_days', value: '180', type: 'int', grp: 'retention' },
  { key: 'sessions_purge_days', value: '30', type: 'int', grp: 'retention' },
  { key: 'matches_archive_days', value: '365', type: 'int', grp: 'retention' },
  // First win of the day → system mail with a coin attachment (MatchService).
  { key: 'first_win_mail_enabled', value: '1', type: 'bool', grp: 'retention' },
  { key: 'first_win_mail_coins', value: '250', type: 'int', grp: 'retention' },
  // Lucky Wheel (§7.8, v1.0 by owner request) — free spins per UTC day.
  { key: 'wheel_free_spins_per_day', value: '3', type: 'int', grp: 'retention' },
  // general
  { key: 'daily_reset_tz', value: 'UTC', type: 'string', grp: 'general' },
  { key: 'streak_reset_grace_h', value: '0', type: 'int', grp: 'general' },
  { key: 'support_feedback_url', value: '', type: 'string', grp: 'general' },
  { key: 'min_client_version', value: '1.0.0', type: 'string', grp: 'general' },
  {
    key: 'blocked_words',
    value: JSON.stringify(['admin', 'moderator', 'system', 'support']),
    type: 'json',
    grp: 'general',
  },
];

// Feature flags — §10.2 seed matrix verbatim.
type FlagSeed = { flag: string; enabled: boolean; phase: 'v1.0' | 'v1.1' | 'v2'; description: string };

const FLAGS: FlagSeed[] = [
  { flag: 'power_mode', enabled: false, phase: 'v1.1', description: 'POWER mode rooms with power-ups' },
  { flag: 'minimap_mode', enabled: false, phase: 'v1.1', description: 'Mini Map short-track mode' },
  { flag: 'lucky_wheel', enabled: false, phase: 'v1.1', description: 'Lucky Wheel daily spins' },
  { flag: 'events', enabled: false, phase: 'v1.1', description: 'Timed collect/offer events' },
  { flag: 'friends', enabled: false, phase: 'v1.1', description: 'Friends list and requests' },
  { flag: 'referrals', enabled: false, phase: 'v1.1', description: 'Referral rewards program' },
  { flag: 'shop_rotation', enabled: false, phase: 'v1.1', description: 'Time-windowed shop rotation' },
  { flag: 'weekly_missions', enabled: false, phase: 'v1.1', description: 'Weekly mission period' },
  { flag: 'push_notifications', enabled: false, phase: 'v1.1', description: 'FCM push + mail-to-push bridge' },
  { flag: 'item_expiration_ui', enabled: false, phase: 'v1.1', description: 'Expiring items UI (backend live since v1.0)' },
  { flag: 'world_chat', enabled: false, phase: 'v2', description: 'Global chat with moderation' },
  { flag: 'tournaments', enabled: false, phase: 'v2', description: 'Bracket tournaments (virtual coins only)' },
  { flag: 'bot_backfill', enabled: true, phase: 'v1.0', description: 'Fill quick rooms with bots after wait timeout' },
  { flag: 'guest_login', enabled: true, phase: 'v1.0', description: 'Guest-first auth' },
  { flag: 'iap_enabled', enabled: false, phase: 'v1.0', description: 'In-app purchases (installer decides)' },
  { flag: 'ads_enabled', enabled: false, phase: 'v1.0', description: 'Rewarded ads via AdMob SSV (installer decides)' },
];

/**
 * 50-level curve: cumulative XP `50·(n−1)·n` (level 2 = 100, level 10 =
 * 4,500, level 50 = 122,500) — early levels pop fast, later ones stretch.
 * Rewards: 100·level coins per level-up, +5 gems every 5th level.
 */
function buildXpCurve(): Array<{ level: number; xpRequired: number; rewardCoins: number; rewardGems: number }> {
  const rows = [];
  for (let level = 1; level <= 50; level++) {
    rows.push({
      level,
      xpRequired: 50 * (level - 1) * level,
      rewardCoins: level === 1 ? 0 : 100 * level,
      rewardGems: level === 1 ? 0 : level % 5 === 0 ? 5 : 0,
    });
  }
  return rows;
}

const DAILY_BONUS: Array<{ day: number; rewardType: 'coins' | 'gems'; amount: number }> = [
  { day: 1, rewardType: 'coins', amount: 500 },
  { day: 2, rewardType: 'coins', amount: 750 },
  { day: 3, rewardType: 'gems', amount: 5 },
  { day: 4, rewardType: 'coins', amount: 1000 },
  { day: 5, rewardType: 'coins', amount: 1500 },
  { day: 6, rewardType: 'gems', amount: 10 },
  { day: 7, rewardType: 'coins', amount: 2500 },
];

const EMOTES = ['laugh', 'cry', 'angry', 'cool', 'heart', 'thumbs_up'].map((code, i) => ({
  code,
  assetKey: `ui:emote_${code}`,
  isDefault: true,
  sortOrder: i,
  isActive: true,
}));

const TIERS = [
  { name: 'Beginner', entryFeeCoins: 5, minLevel: 1, sortOrder: 0 },
  { name: 'Bronze', entryFeeCoins: 10, minLevel: 1, sortOrder: 1 },
  { name: 'Silver', entryFeeCoins: 10000, minLevel: 5, sortOrder: 2 },
  { name: 'Gold', entryFeeCoins: 50000, minLevel: 10, sortOrder: 3 },
].map((t) => ({
  ...t,
  mode: 'classic' as const,
  // §7.2 example: winner-heavy split, 2nd place paid in 3P/4P.
  // House keeps 30% of the pot (same rule as Aviator PoolCrashEngine::HOUSE_PCT):
  // the multipliers of each row sum to 0.70 x playerCount.
  prizeTable: { '2': [1.4, 0], '3': [1.68, 0.42, 0], '4': [1.96, 0.84, 0, 0] },
  isActive: true,
}));

const MISSIONS = [
  { code: 'daily_play_3', metric: 'play_matches', target: 3, rewardAmount: 500, sortOrder: 0 },
  { code: 'daily_win_1', metric: 'win_matches', target: 1, rewardAmount: 750, sortOrder: 1 },
  { code: 'daily_capture_5', metric: 'capture_pieces', target: 5, rewardAmount: 500, sortOrder: 2 },
  { code: 'daily_sixes_10', metric: 'roll_sixes', target: 10, rewardAmount: 400, sortOrder: 3 },
  { code: 'daily_home_4', metric: 'pieces_home', target: 4, rewardAmount: 500, sortOrder: 4 },
] as const;

/**
 * Lucky Wheel default (§7.8, promoted to v1.0): one active wheel with 8
 * segments. Weights are RELATIVE (here they sum 100, so weight == percent):
 * winner is crypto.randomInt over the sum — WheelService. The "nothing"
 * slice is coins/amount-0 (the reward_type enum has no 'none'); the jackpot
 * is deliberately rare at 1/100. Daily free spins come from the
 * `wheel_free_spins_per_day` setting, not free_spins_daily (v1.1 field).
 */
const WHEEL = {
  name: 'Lucky Wheel',
  freeSpinsDaily: 3,
  isActive: true,
} as const;

type WheelSegmentSeed = {
  labelKey: string;
  rewardType: 'coins' | 'gems';
  amount: number;
  weight: number;
  color: string;
};

const WHEEL_SEGMENTS: WheelSegmentSeed[] = [
  { labelKey: 'wheel_seg_coins_100', rewardType: 'coins', amount: 100, weight: 30, color: '#4CAF50' },
  { labelKey: 'wheel_seg_coins_250', rewardType: 'coins', amount: 250, weight: 22, color: '#2196F3' },
  { labelKey: 'wheel_seg_coins_500', rewardType: 'coins', amount: 500, weight: 15, color: '#FF9800' },
  { labelKey: 'wheel_seg_coins_1000', rewardType: 'coins', amount: 1000, weight: 8, color: '#9C27B0' },
  { labelKey: 'wheel_seg_gems_5', rewardType: 'gems', amount: 5, weight: 10, color: '#00BCD4' },
  { labelKey: 'wheel_seg_gems_20', rewardType: 'gems', amount: 20, weight: 4, color: '#E91E63' },
  { labelKey: 'wheel_seg_nothing', rewardType: 'coins', amount: 0, weight: 10, color: '#9E9E9E' },
  { labelKey: 'wheel_seg_jackpot_5000', rewardType: 'coins', amount: 5000, weight: 1, color: '#FFD700' },
];

/**
 * Default shop catalog (§7.5). Dice skins are PROCEDURAL client bakes keyed
 * by asset_key (no art files needed); coin packs convert gems → coins so the
 * Coins tab works day 1; gem packs are IAP placeholders the client renders
 * disabled until the §8.3 store flow ships. Upsert by sku is a no-op, so
 * admin price edits survive re-seeding.
 */
type ShopItemSeed = {
  sku: string;
  category: 'dice_skin' | 'token_skin' | 'bubble_skin' | 'board_theme' | 'coin_pack' | 'gem_pack' | 'booster';
  nameKey: string;
  assetKey?: string;
  priceCurrency: 'coins' | 'gems' | 'iap';
  priceAmount?: number;
  iapProductId?: string;
  grantsCurrency?: 'coins' | 'gems';
  grantsAmount?: number;
  isFeatured?: boolean;
  sortOrder: number;
};

const SHOP_ITEMS: ShopItemSeed[] = [
  // Skins tab — dice (equip in the backpack, used by the in-match die).
  { sku: 'dice_gold', category: 'dice_skin', nameKey: 'dice_gold', assetKey: 'gold', priceCurrency: 'coins', priceAmount: 2500, sortOrder: 0 },
  { sku: 'dice_mint', category: 'dice_skin', nameKey: 'dice_mint', assetKey: 'mint', priceCurrency: 'coins', priceAmount: 2000, sortOrder: 1 },
  { sku: 'dice_ruby', category: 'dice_skin', nameKey: 'dice_ruby', assetKey: 'ruby', priceCurrency: 'coins', priceAmount: 4000, sortOrder: 2 },
  { sku: 'dice_galaxy', category: 'dice_skin', nameKey: 'dice_galaxy', assetKey: 'galaxy', priceCurrency: 'gems', priceAmount: 30, isFeatured: true, sortOrder: 3 },
  // Pawn skins — procedural composites over the current piece art.
  { sku: 'pawn_face', category: 'token_skin', nameKey: 'pawn_face', assetKey: 'face', priceCurrency: 'coins', priceAmount: 3000, sortOrder: 0 },
  { sku: 'pawn_crown', category: 'token_skin', nameKey: 'pawn_crown', assetKey: 'crown', priceCurrency: 'coins', priceAmount: 6000, sortOrder: 1 },
  { sku: 'pawn_aura', category: 'token_skin', nameKey: 'pawn_aura', assetKey: 'aura', priceCurrency: 'gems', priceAmount: 35, isFeatured: true, sortOrder: 2 },
  // Chat-bubble skins — palettes the AvatarChip bubbles wear.
  { sku: 'bubble_gold', category: 'bubble_skin', nameKey: 'bubble_gold', assetKey: 'gold', priceCurrency: 'coins', priceAmount: 1500, sortOrder: 0 },
  { sku: 'bubble_candy', category: 'bubble_skin', nameKey: 'bubble_candy', assetKey: 'candy', priceCurrency: 'coins', priceAmount: 1500, sortOrder: 1 },
  { sku: 'bubble_ink', category: 'bubble_skin', nameKey: 'bubble_ink', assetKey: 'ink', priceCurrency: 'gems', priceAmount: 15, sortOrder: 2 },
  // Board themes — full board re-bakes (client bakeBoard palettes).
  { sku: 'theme_ocean', category: 'board_theme', nameKey: 'theme_ocean', assetKey: 'ocean', priceCurrency: 'coins', priceAmount: 8000, sortOrder: 0 },
  { sku: 'theme_night', category: 'board_theme', nameKey: 'theme_night', assetKey: 'night', priceCurrency: 'gems', priceAmount: 45, isFeatured: true, sortOrder: 1 },
  // Coins tab — gems → coins conversion packs.
  { sku: 'coins_small', category: 'coin_pack', nameKey: 'coins_small', priceCurrency: 'gems', priceAmount: 10, grantsCurrency: 'coins', grantsAmount: 3000, sortOrder: 0 },
  { sku: 'coins_medium', category: 'coin_pack', nameKey: 'coins_medium', priceCurrency: 'gems', priceAmount: 35, grantsCurrency: 'coins', grantsAmount: 12000, isFeatured: true, sortOrder: 1 },
  { sku: 'coins_large', category: 'coin_pack', nameKey: 'coins_large', priceCurrency: 'gems', priceAmount: 80, grantsCurrency: 'coins', grantsAmount: 30000, sortOrder: 2 },
  // Gems tab — IAP placeholders (§8.3): visible, buy button disabled.
  { sku: 'gems_small', category: 'gem_pack', nameKey: 'gems_small', priceCurrency: 'iap', iapProductId: 'lr_gems_small', grantsCurrency: 'gems', grantsAmount: 50, sortOrder: 0 },
  { sku: 'gems_large', category: 'gem_pack', nameKey: 'gems_large', priceCurrency: 'iap', iapProductId: 'lr_gems_large', grantsCurrency: 'gems', grantsAmount: 300, sortOrder: 1 },
  // Powers tab — the BATTLE set only (hybrid economy): the classic four
  // (plus/double/pick/shield) drop on the board and are NOT sold. Bought
  // with gold, stacked as booster qty, max 2 uses of each per match.
  // Convention: sku = power_<PowerType>, assetKey = <PowerType>.
  { sku: 'power_bomb', category: 'booster', nameKey: 'power_bomb', assetKey: 'bomb', priceCurrency: 'coins', priceAmount: 1000, isFeatured: true, sortOrder: 0 },
  { sku: 'power_bolt', category: 'booster', nameKey: 'power_bolt', assetKey: 'bolt', priceCurrency: 'coins', priceAmount: 1200, isFeatured: true, sortOrder: 1 },
  { sku: 'power_freeze', category: 'booster', nameKey: 'power_freeze', assetKey: 'freeze', priceCurrency: 'coins', priceAmount: 1000, sortOrder: 2 },
  { sku: 'power_portal', category: 'booster', nameKey: 'power_portal', assetKey: 'portal', priceCurrency: 'coins', priceAmount: 1500, sortOrder: 3 },
];

/**
 * Placeholder `lr_admin_users` row for the admin panel planned in a future
 * release (that panel — and the installer step that would let you set this
 * interactively — is NOT part of this v1.0 build; `lr_admin_users` has no
 * consumer yet). No code path in this version authenticates against it.
 *
 * Credentials are sourced from the environment so nothing here is a fixed,
 * guessable literal: set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD before
 * running `npm run db:seed` if you want a predictable login for later;
 * otherwise a random password is generated and printed once to the console.
 */
function resolveDevAdmin(): { email: string; password: string; name: string; generated: boolean } {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  const password = envPassword && envPassword.length >= 10 ? envPassword : randomBytes(9).toString('base64url');
  return { email, password, name: 'Admin', generated: !envPassword };
}

// ---------------------------------------------------------------------------

/** Seed core data. Safe to run any number of times. */
export async function seedCore(db: Db): Promise<void> {
  for (const s of SETTINGS) {
    await db
      .insert(lrSettings)
      .values({ ...s, updatedAt: new Date() })
      // No-op on duplicate: never clobber admin-edited values.
      .onDuplicateKeyUpdate({ set: { key: sql`\`key\`` } });
  }

  for (const f of FLAGS) {
    await db
      .insert(lrFeatureFlags)
      .values({ ...f, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { flag: sql`\`flag\`` } });
  }

  for (const row of buildXpCurve()) {
    await db
      .insert(lrXpLevels)
      .values(row)
      .onDuplicateKeyUpdate({ set: { level: sql`\`level\`` } });
  }

  for (const d of DAILY_BONUS) {
    await db
      .insert(lrDailyBonusConfig)
      .values({ ...d, doubleWithAd: true })
      .onDuplicateKeyUpdate({ set: { day: sql`\`day\`` } });
  }

  for (const e of EMOTES) {
    await db
      .insert(lrEmotes)
      .values(e)
      .onDuplicateKeyUpdate({ set: { code: sql`\`code\`` } });
  }

  // Tiers have no natural unique key — only seed an empty table.
  const tierCount = await db.select({ id: lrRoomTiers.id }).from(lrRoomTiers).limit(1);
  if (tierCount.length === 0) {
    await db.insert(lrRoomTiers).values(TIERS.map((t) => ({ ...t, createdAt: new Date() })));
  }
  // Live tables were seeded at ₹500/₹2500; drop Beginner/Bronze so play starts at ₹5/₹10.
  await db.update(lrRoomTiers).set({ entryFeeCoins: 5, minLevel: 1 }).where(eq(lrRoomTiers.name, 'Beginner'));
  await db.update(lrRoomTiers).set({ entryFeeCoins: 10, minLevel: 1 }).where(eq(lrRoomTiers.name, 'Bronze'));

  // Lucky Wheel: like tiers, no natural unique key — only seed an empty
  // table (admin edits to segments/weights are never clobbered).
  const wheelCount = await db
    .select({ id: lrLuckyWheelConfig.id })
    .from(lrLuckyWheelConfig)
    .limit(1);
  if (wheelCount.length === 0) {
    const [wheelHeader] = await db.insert(lrLuckyWheelConfig).values({ ...WHEEL });
    await db.insert(lrLuckyWheelSegments).values(
      WHEEL_SEGMENTS.map((s, i) => ({ ...s, wheelId: wheelHeader.insertId, sortOrder: i })),
    );
  }

  for (const item of SHOP_ITEMS) {
    await db
      .insert(lrShopItems)
      .values({
        sku: item.sku,
        category: item.category,
        nameKey: item.nameKey,
        assetKey: item.assetKey ?? null,
        priceCurrency: item.priceCurrency,
        priceAmount: item.priceAmount ?? 0,
        iapProductId: item.iapProductId ?? null,
        grantsCurrency: item.grantsCurrency ?? null,
        grantsAmount: item.grantsAmount ?? null,
        minLevel: 1,
        isActive: true,
        isFeatured: item.isFeatured ?? false,
        sortOrder: item.sortOrder,
        createdAt: new Date(),
      })
      .onDuplicateKeyUpdate({ set: { sku: sql`\`sku\`` } });
  }

  for (const m of MISSIONS) {
    await db
      .insert(lrMissions)
      .values({
        code: m.code,
        period: 'daily',
        metric: m.metric,
        target: m.target,
        rewardType: 'coins',
        rewardAmount: m.rewardAmount,
        minLevel: 1,
        isActive: true,
        sortOrder: m.sortOrder,
        createdAt: new Date(),
      })
      .onDuplicateKeyUpdate({ set: { code: sql`\`code\`` } });
  }

  const devAdmin = resolveDevAdmin();
  await db
    .insert(lrAdminUsers)
    .values({
      email: devAdmin.email,
      passwordHash: bcrypt.hashSync(devAdmin.password, 12),
      name: devAdmin.name,
      role: 'superadmin',
      isActive: true,
      createdAt: new Date(),
    })
    // No-op on duplicate: only takes effect on the very first seed run, so a
    // freshly-generated password below is never silently rotated later.
    .onDuplicateKeyUpdate({ set: { email: sql`\`email\`` } });

  if (devAdmin.generated) {
    // Only meaningful the first time this table is empty (see no-op above).
    process.stdout.write(
      `[seed] lr_admin_users placeholder row: ${devAdmin.email} / ${devAdmin.password}\n` +
        '[seed] Not used by this v1.0 build (no admin panel yet) — set SEED_ADMIN_EMAIL / ' +
        'SEED_ADMIN_PASSWORD to control it instead of relying on this generated value.\n',
    );
  }
}

// -- CLI entrypoint ---------------------------------------------------------

const isCli = process.argv[1]
  ? resolve(process.argv[1]).replace(/\\/g, '/').endsWith('/db/seed.ts') ||
    resolve(process.argv[1]).replace(/\\/g, '/').endsWith('/db/seed.js')
  : false;

if (isCli) {
  const { loadEnvFiles } = await import('../config/envFile.js');
  loadEnvFiles();
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('db:seed — DATABASE_URL is not set (env or .env file)\n');
    process.exit(1);
  }
  const handle = createDb(url, 2);
  try {
    await seedCore(handle.db);
    process.stdout.write('db:seed — core seed applied (idempotent)\n');
  } finally {
    await handle.close();
  }
}
