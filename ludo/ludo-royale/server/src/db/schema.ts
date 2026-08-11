/**
 * Drizzle schema — the COMPLETE 41-table blueprint of ARQUITECTURA §7.
 *
 * Non-negotiable rule (PROMPT-V3 §2): every table of the blueprint exists
 * from v1.0 even when its UI ships in v1.1/v2. Activating a phase is a
 * feature flag + UI, never a destructive migration.
 *
 * Conventions (§7): prefix `lr_` · InnoDB · utf8mb4_unicode_ci · PK
 * `id BIGINT UNSIGNED AUTO_INCREMENT` unless stated · created_at/updated_at
 * DATETIME in UTC (the app writes them; DEFAULT CURRENT_TIMESTAMP is only a
 * safety net) · explicit ON DELETE on every FK · virtual money in BIGINT
 * (never FLOAT).
 *
 * [DECISIÓN] money columns use drizzle `mode: 'number'` — a coins economy
 * stays far below Number.MAX_SAFE_INTEGER (9e15); the mysql2 pool would
 * return exotic > 2^53 values as imprecise numbers, which the audit job
 * (SUM(ledger) == balance) would flag long before precision matters.
 *
 * [DECISIÓN] two additive deltas over the literal §7 text, both documented
 * in drizzle/0000_init.sql as well:
 *   1. lr_user_sessions.family_id — §8.2 mandates the token-family pattern
 *      ("reuso de refresh rotado → revocar toda la cadena"); a family root id
 *      makes "revoke the whole family" one indexed UPDATE instead of a
 *      recursive walk over rotated_from.
 *   2. lr_wallet_transactions.type gains 'signup_bonus' — guests start with
 *      initial_coins/initial_gems (settings) and the §7.2 audit invariant
 *      (SUM(ledger) == balance) requires that grant to live in the ledger.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  tinyint,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';

// ---------------------------------------------------------------------------
// Column helpers (keep the 41 tables terse and uniform)
// ---------------------------------------------------------------------------

const pk = () =>
  bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

const ubigint = (name: string) => bigint(name, { mode: 'number', unsigned: true });

const createdAt = () =>
  datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

const updatedAt = () =>
  datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`);

// ===========================================================================
// §7.1 Identity & sessions
// ===========================================================================

export const lrUsers = mysqlTable(
  'lr_users',
  {
    id: pk(),
    username: varchar('username', { length: 24 }).notNull(),
    email: varchar('email', { length: 190 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    isGuest: boolean('is_guest').notNull().default(true),
    deviceId: varchar('device_id', { length: 64 }),
    avatarKey: varchar('avatar_key', { length: 40 }).notNull().default('av_default'),
    frameKey: varchar('frame_key', { length: 40 }),
    country: char('country', { length: 2 }),
    locale: char('locale', { length: 2 }).notNull().default('en'),
    xp: int('xp', { unsigned: true }).notNull().default(0),
    level: smallint('level', { unsigned: true }).notNull().default(1),
    coins: ubigint('coins').notNull().default(0),
    gems: int('gems', { unsigned: true }).notNull().default(0),
    gamesPlayed: int('games_played', { unsigned: true }).notNull().default(0),
    gamesWon: int('games_won', { unsigned: true }).notNull().default(0),
    winStreak: smallint('win_streak', { unsigned: true }).notNull().default(0),
    referralCode: varchar('referral_code', { length: 12 }),
    referredBy: ubigint('referred_by').references((): AnyMySqlColumn => lrUsers.id, {
      onDelete: 'set null',
    }),
    status: mysqlEnum('status', ['active', 'banned', 'deleted']).notNull().default('active'),
    banReason: varchar('ban_reason', { length: 190 }),
    bannedUntil: datetime('banned_until'),
    lastLoginAt: datetime('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_username').on(t.username),
    uniqueIndex('uq_email').on(t.email),
    uniqueIndex('uq_referral_code').on(t.referralCode),
    index('idx_device').on(t.deviceId),
    index('idx_status').on(t.status),
    index('idx_level').on(t.level),
    index('idx_created').on(t.createdAt),
  ],
);

export const lrUserSessions = mysqlTable(
  'lr_user_sessions',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    refreshTokenHash: char('refresh_token_hash', { length: 64 }).notNull(),
    /** Root session id of the rotation chain (§8.2 token-family). */
    familyId: ubigint('family_id'),
    deviceInfo: varchar('device_info', { length: 190 }),
    ip: varchar('ip', { length: 45 }),
    expiresAt: datetime('expires_at').notNull(),
    revokedAt: datetime('revoked_at'),
    rotatedFrom: ubigint('rotated_from'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_refresh_hash').on(t.refreshTokenHash),
    index('idx_sessions_user').on(t.userId),
    index('idx_sessions_family').on(t.familyId),
    index('idx_sessions_expires').on(t.expiresAt),
  ],
);

// ===========================================================================
// §7.2 Economy
// ===========================================================================

/** All `type` values the append-only ledger accepts (§7.2 + signup_bonus). */
export const WALLET_TX_TYPES = [
  'match_entry',
  'match_prize',
  'daily_bonus',
  'mission_reward',
  'shop_purchase',
  'iap_grant',
  'ad_reward',
  'wheel_prize',
  'event_reward',
  'referral_bonus',
  'mail_attachment',
  'level_up',
  'admin_adjust',
  'refund',
  'signup_bonus',
] as const;

export const lrWalletTransactions = mysqlTable(
  'lr_wallet_transactions',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    currency: mysqlEnum('currency', ['coins', 'gems']).notNull(),
    /** Signed: debits are negative. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: ubigint('balance_after').notNull(),
    type: mysqlEnum('type', WALLET_TX_TYPES).notNull(),
    // Polymorphic reference WITHOUT a global unique index (Gate 1 fix):
    // MySQL 8 has no partial indexes and repeated purchases of the same SKU
    // are legal — dedupe lives in the ORIGIN tables (lr_user_missions,
    // lr_user_mail, lr_iap_receipts, lr_ad_rewards).
    refType: varchar('ref_type', { length: 32 }),
    refId: ubigint('ref_id'),
    note: varchar('note', { length: 190 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_wallet_user_created').on(t.userId, t.createdAt),
    index('idx_wallet_type').on(t.type),
    index('idx_wallet_ref').on(t.refType, t.refId),
    // Admin Dashboard/Economy global queries by date window (Gate 1 fix).
    index('idx_created_type').on(t.createdAt, t.type),
  ],
);

export const lrRoomTiers = mysqlTable('lr_room_tiers', {
  id: pk(),
  name: varchar('name', { length: 40 }).notNull(),
  mode: mysqlEnum('mode', ['classic', 'power', 'minimap']).notNull().default('classic'),
  entryFeeCoins: ubigint('entry_fee_coins').notNull(),
  /** Payout multipliers over the fee, keyed by player count (§7.2). */
  prizeTable: json('prize_table').$type<Record<string, number[]>>().notNull(),
  minLevel: smallint('min_level', { unsigned: true }).notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const lrXpLevels = mysqlTable('lr_xp_levels', {
  /** Not auto-increment: the curve is seeded/edited as explicit rows. */
  level: smallint('level', { unsigned: true }).primaryKey(),
  /** Cumulative XP required to reach this level. */
  xpRequired: int('xp_required', { unsigned: true }).notNull(),
  rewardCoins: ubigint('reward_coins').notNull().default(0),
  rewardGems: int('reward_gems', { unsigned: true }).notNull().default(0),
  rewardItemId: ubigint('reward_item_id').references(() => lrShopItems.id, {
    onDelete: 'set null',
  }),
});

// ===========================================================================
// §7.3 Matches
// ===========================================================================

export const lrMatches = mysqlTable(
  'lr_matches',
  {
    id: pk(),
    mode: mysqlEnum('mode', ['classic', 'power', 'minimap']).notNull(),
    type: mysqlEnum('type', ['quick', 'private', 'cpu', 'local']).notNull(),
    tierId: ubigint('tier_id').references(() => lrRoomTiers.id, { onDelete: 'set null' }),
    roomId: varchar('room_id', { length: 12 }),
    privateCode: char('private_code', { length: 6 }),
    maxPlayers: tinyint('max_players', { unsigned: true }).notNull(),
    entryFee: ubigint('entry_fee').notNull().default(0),
    pot: ubigint('pot').notNull().default(0),
    state: mysqlEnum('state', ['playing', 'finished', 'aborted']).notNull(),
    winnerUserId: ubigint('winner_user_id').references(() => lrUsers.id, {
      onDelete: 'set null',
    }),
    /** SHA-256(matchId + rngLog) — post-hoc dice audit (§5.5). */
    seedHash: char('seed_hash', { length: 64 }),
    rngRolls: smallint('rng_rolls', { unsigned: true }).notNull().default(0),
    startedAt: datetime('started_at'),
    endedAt: datetime('ended_at'),
    durationS: int('duration_s', { unsigned: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_private_code').on(t.privateCode),
    index('idx_state').on(t.state),
    index('idx_started').on(t.startedAt),
    // Orphan-match watchdog scan (§6.2).
    index('idx_state_started').on(t.state, t.startedAt),
  ],
);

export const lrMatchPlayers = mysqlTable(
  'lr_match_players',
  {
    id: pk(),
    matchId: ubigint('match_id')
      .notNull()
      .references(() => lrMatches.id, { onDelete: 'cascade' }),
    /** NULL = bot or local hot-seat guest. */
    userId: ubigint('user_id').references(() => lrUsers.id, { onDelete: 'set null' }),
    seat: tinyint('seat', { unsigned: true }).notNull(),
    color: mysqlEnum('color', ['red', 'blue', 'yellow', 'green']).notNull(),
    isBot: boolean('is_bot').notNull().default(false),
    place: tinyint('place', { unsigned: true }),
    piecesHome: tinyint('pieces_home', { unsigned: true }).notNull().default(0),
    captures: tinyint('captures', { unsigned: true }).notNull().default(0),
    sixes: tinyint('sixes', { unsigned: true }).notNull().default(0),
    /** Net fee + prize, signed. */
    coinsDelta: bigint('coins_delta', { mode: 'number' }).notNull().default(0),
    xpEarned: int('xp_earned', { unsigned: true }).notNull().default(0),
    leftEarly: boolean('left_early').notNull().default(false),
    disconnects: tinyint('disconnects', { unsigned: true }).notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_match_seat').on(t.matchId, t.seat),
    // Cursor-paginated per-user match history (§8.1). The reference SQL
    // declares (user_id, id DESC); ascending here — InnoDB backward scans
    // serve the DESC cursor equally.
    index('idx_user_history').on(t.userId, t.id),
  ],
);

// ===========================================================================
// §7.4 Retention (missions, daily bonus, streaks)
// ===========================================================================

export const lrMissions = mysqlTable('lr_missions', {
  id: pk(),
  code: varchar('code', { length: 40 }).notNull().unique('uq_mission_code'),
  period: mysqlEnum('period', ['daily', 'weekly', 'event']).notNull().default('daily'),
  metric: mysqlEnum('metric', [
    'play_matches',
    'win_matches',
    'capture_pieces',
    'roll_sixes',
    'pieces_home',
    'watch_ads',
    'spend_coins',
    'use_emotes',
  ]).notNull(),
  target: int('target', { unsigned: true }).notNull(),
  rewardType: mysqlEnum('reward_type', ['coins', 'gems', 'item']).notNull(),
  rewardAmount: ubigint('reward_amount').notNull().default(0),
  rewardItemId: ubigint('reward_item_id').references(() => lrShopItems.id, {
    onDelete: 'set null',
  }),
  minLevel: smallint('min_level', { unsigned: true }).notNull().default(1),
  eventId: ubigint('event_id').references(() => lrEvents.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const lrUserMissions = mysqlTable(
  'lr_user_missions',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    missionId: ubigint('mission_id')
      .notNull()
      .references(() => lrMissions.id, { onDelete: 'cascade' }),
    /** '2026-07-02' for daily · '2026-W27' for weekly (§7.4). */
    periodKey: varchar('period_key', { length: 16 }).notNull(),
    progress: int('progress', { unsigned: true }).notNull().default(0),
    completedAt: datetime('completed_at'),
    claimedAt: datetime('claimed_at'),
  },
  // Reward dedupe lives HERE, not in the ledger (§7.2 Gate 1 fix).
  (t) => [uniqueIndex('uq_user_mission_period').on(t.userId, t.missionId, t.periodKey)],
);

export const lrDailyBonusConfig = mysqlTable(
  'lr_daily_bonus_config',
  {
    id: pk(),
    day: tinyint('day', { unsigned: true }).notNull(),
    rewardType: mysqlEnum('reward_type', ['coins', 'gems', 'item']).notNull(),
    amount: ubigint('amount').notNull().default(0),
    itemId: ubigint('item_id').references(() => lrShopItems.id, { onDelete: 'set null' }),
    /** Expiring items ("Cat (1d)"): column lives today, UI arrives v1.1. */
    itemDurationH: int('item_duration_h', { unsigned: true }),
    doubleWithAd: boolean('double_with_ad').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_day').on(t.day)],
);

export const lrUserStreaks = mysqlTable('lr_user_streaks', {
  userId: ubigint('user_id')
    .primaryKey()
    .references(() => lrUsers.id, { onDelete: 'cascade' }),
  currentDay: tinyint('current_day', { unsigned: true }).notNull().default(1),
  streakCount: int('streak_count', { unsigned: true }).notNull().default(0),
  lastClaimDate: date('last_claim_date', { mode: 'string' }),
  totalClaims: int('total_claims', { unsigned: true }).notNull().default(0),
});

// ===========================================================================
// §7.5 Shop & inventory
// ===========================================================================

export const lrShopItems = mysqlTable('lr_shop_items', {
  id: pk(),
  sku: varchar('sku', { length: 40 }).notNull().unique('uq_sku'),
  category: mysqlEnum('category', [
    'dice_skin',
    'token_skin',
    'board_theme',
    'avatar',
    'avatar_frame',
    'emote_pack',
    'coin_pack',
    'gem_pack',
    'booster',
    'bubble_skin',
  ]).notNull(),
  nameKey: varchar('name_key', { length: 80 }).notNull(),
  descKey: varchar('desc_key', { length: 80 }),
  /** `atlas:frame_prefix` convention (§4.3). */
  assetKey: varchar('asset_key', { length: 80 }),
  priceCurrency: mysqlEnum('price_currency', ['coins', 'gems', 'iap', 'free']).notNull(),
  priceAmount: ubigint('price_amount').notNull().default(0),
  iapProductId: varchar('iap_product_id', { length: 80 }),
  grantsCurrency: mysqlEnum('grants_currency', ['coins', 'gems']),
  grantsAmount: ubigint('grants_amount'),
  /** NULL = permanent. */
  durationH: int('duration_h', { unsigned: true }),
  minLevel: smallint('min_level', { unsigned: true }).notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  isFeatured: boolean('is_featured').notNull().default(false),
  availableFrom: datetime('available_from'),
  availableUntil: datetime('available_until'),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const lrUserInventory = mysqlTable(
  'lr_user_inventory',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    itemId: ubigint('item_id')
      .notNull()
      .references(() => lrShopItems.id, { onDelete: 'cascade' }),
    qty: int('qty', { unsigned: true }).notNull().default(1),
    acquiredVia: mysqlEnum('acquired_via', [
      'shop',
      'daily_bonus',
      'wheel',
      'event',
      'mail',
      'referral',
      'admin',
      'iap',
      'level_up',
    ]).notNull(),
    isEquipped: boolean('is_equipped').notNull().default(false),
    expiresAt: datetime('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // Non-consumables: one row per user+item (consumables bump qty).
    uniqueIndex('uq_user_item').on(t.userId, t.itemId),
    index('idx_inventory_user').on(t.userId),
    index('idx_inventory_expires').on(t.expiresAt),
  ],
);

// ===========================================================================
// §7.6 Leaderboard, mail, emotes
// ===========================================================================

export const lrLeaderboardLive = mysqlTable(
  'lr_leaderboard_live',
  {
    id: pk(),
    scope: mysqlEnum('scope', ['global', 'country']).notNull(),
    periodKey: varchar('period_key', { length: 10 }).notNull(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    score: bigint('score', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_scope_period_user').on(t.scope, t.periodKey, t.userId),
    // Reference SQL: (scope, period_key, score DESC) — top-N without filesort.
    index('idx_rank').on(t.scope, t.periodKey, t.score),
  ],
);

export const lrLeaderboardSnapshots = mysqlTable(
  'lr_leaderboard_snapshots',
  {
    id: pk(),
    scope: mysqlEnum('scope', ['global', 'country']).notNull(),
    country: char('country', { length: 2 }),
    period: mysqlEnum('period', ['weekly', 'alltime']).notNull(),
    periodKey: varchar('period_key', { length: 10 }).notNull(),
    rank: int('rank', { unsigned: true }).notNull(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    score: bigint('score', { mode: 'number' }).notNull(),
    snapshotAt: datetime('snapshot_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_snapshot_rank').on(t.scope, t.country, t.period, t.periodKey, t.rank),
  ],
);

export const lrMailMessages = mysqlTable('lr_mail_messages', {
  id: pk(),
  audience: mysqlEnum('audience', ['all', 'user']).notNull(),
  userId: ubigint('user_id').references(() => lrUsers.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 120 }).notNull(),
  body: text('body').notNull(),
  attachmentType: mysqlEnum('attachment_type', ['none', 'coins', 'gems', 'item'])
    .notNull()
    .default('none'),
  attachmentAmount: ubigint('attachment_amount'),
  attachmentItemId: ubigint('attachment_item_id').references(() => lrShopItems.id, {
    onDelete: 'set null',
  }),
  attachmentItemDurationH: int('attachment_item_duration_h', { unsigned: true }),
  expiresAt: datetime('expires_at'),
  createdByAdminId: ubigint('created_by_admin_id').references(() => lrAdminUsers.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
});

export const lrUserMail = mysqlTable(
  'lr_user_mail',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    mailId: ubigint('mail_id')
      .notNull()
      .references(() => lrMailMessages.id, { onDelete: 'cascade' }),
    readAt: datetime('read_at'),
    claimedAt: datetime('claimed_at'),
    deletedAt: datetime('deleted_at'),
  },
  // audience='all' rows materialize lazily on inbox open; claim dedupe here.
  (t) => [uniqueIndex('uq_user_mail').on(t.userId, t.mailId)],
);

export const lrEmotes = mysqlTable('lr_emotes', {
  id: pk(),
  code: varchar('code', { length: 24 }).notNull().unique('uq_emote_code'),
  assetKey: varchar('asset_key', { length: 80 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

// ===========================================================================
// §7.7 Social (v1.1 — schema day 1)
// ===========================================================================

export const lrFriends = mysqlTable(
  'lr_friends',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    friendId: ubigint('friend_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  // Double row A→B and B→A for cheap "my friends" queries (§7.7).
  (t) => [uniqueIndex('uq_user_friend').on(t.userId, t.friendId)],
);

export const lrFriendRequests = mysqlTable(
  'lr_friend_requests',
  {
    id: pk(),
    fromUserId: ubigint('from_user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    toUserId: ubigint('to_user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    status: mysqlEnum('status', ['pending', 'accepted', 'declined', 'cancelled'])
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
    resolvedAt: datetime('resolved_at'),
  },
  (t) => [index('idx_to_status').on(t.toUserId, t.status)],
);

export const lrReferrals = mysqlTable(
  'lr_referrals',
  {
    id: pk(),
    referrerUserId: ubigint('referrer_user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    referredUserId: ubigint('referred_user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    codeUsed: varchar('code_used', { length: 12 }).notNull(),
    /** qualified = referred reaches referral_qualify_level (anti-farm). */
    status: mysqlEnum('status', ['registered', 'qualified', 'rewarded'])
      .notNull()
      .default('registered'),
    rewardedAt: datetime('rewarded_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_referrer').on(t.referrerUserId),
    uniqueIndex('uq_referred').on(t.referredUserId),
  ],
);

export const lrFriendGifts = mysqlTable(
  'lr_friend_gifts',
  {
    id: pk(),
    fromUserId: ubigint('from_user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    toUserId: ubigint('to_user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    /** UTC day 'YYYY-MM-DD' — the UNIQUE key IS the daily-gift dedupe. */
    dayKey: char('day_key', { length: 10 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_gift_day').on(t.fromUserId, t.toUserId, t.dayKey),
    index('idx_gift_to').on(t.toUserId),
  ],
);

// ===========================================================================
// §7.8 Lucky Wheel (v1.1 — schema day 1)
// ===========================================================================

export const lrLuckyWheelConfig = mysqlTable('lr_lucky_wheel_config', {
  id: pk(),
  name: varchar('name', { length: 40 }).notNull(),
  freeSpinsDaily: tinyint('free_spins_daily', { unsigned: true }).notNull().default(1),
  extraSpinCostType: mysqlEnum('extra_spin_cost_type', ['gems', 'ad']),
  extraSpinCostAmount: int('extra_spin_cost_amount', { unsigned: true }),
  maxSpinsDaily: tinyint('max_spins_daily', { unsigned: true }),
  isActive: boolean('is_active').notNull().default(false),
});

export const lrLuckyWheelSegments = mysqlTable('lr_lucky_wheel_segments', {
  id: pk(),
  wheelId: ubigint('wheel_id')
    .notNull()
    .references(() => lrLuckyWheelConfig.id, { onDelete: 'cascade' }),
  labelKey: varchar('label_key', { length: 80 }).notNull(),
  rewardType: mysqlEnum('reward_type', ['coins', 'gems', 'item']).notNull(),
  amount: ubigint('amount').notNull().default(0),
  itemId: ubigint('item_id').references(() => lrShopItems.id, { onDelete: 'set null' }),
  /** Relative probability; server picks with crypto.randomInt over the sum. */
  weight: int('weight', { unsigned: true }).notNull(),
  color: char('color', { length: 7 }),
  sortOrder: int('sort_order').notNull().default(0),
});

export const lrLuckyWheelSpins = mysqlTable(
  'lr_lucky_wheel_spins',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    wheelId: ubigint('wheel_id')
      .notNull()
      .references(() => lrLuckyWheelConfig.id, { onDelete: 'cascade' }),
    segmentId: ubigint('segment_id')
      .notNull()
      .references(() => lrLuckyWheelSegments.id, { onDelete: 'cascade' }),
    costType: mysqlEnum('cost_type', ['free', 'gems', 'ad']).notNull(),
    createdAt: createdAt(),
  },
  // Daily spin caps count rows in (user, day) windows.
  (t) => [index('idx_spins_user_created').on(t.userId, t.createdAt)],
);

// ===========================================================================
// §7.9 Events (v1.1) & tournaments (v2) — schema day 1
// ===========================================================================

export const lrEvents = mysqlTable(
  'lr_events',
  {
    id: pk(),
    code: varchar('code', { length: 40 }).notNull().unique('uq_event_code'),
    /** collect = accumulate metric · offer = IAP offer with countdown. */
    type: mysqlEnum('type', ['collect', 'offer']).notNull(),
    titleKey: varchar('title_key', { length: 80 }).notNull(),
    assetKey: varchar('asset_key', { length: 80 }),
    config: json('config').$type<Record<string, unknown>>(),
    startsAt: datetime('starts_at').notNull(),
    endsAt: datetime('ends_at').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('idx_ends').on(t.endsAt)],
);

export const lrEventRewards = mysqlTable('lr_event_rewards', {
  id: pk(),
  eventId: ubigint('event_id')
    .notNull()
    .references(() => lrEvents.id, { onDelete: 'cascade' }),
  /** Progress threshold that unlocks this reward. */
  milestone: int('milestone', { unsigned: true }).notNull(),
  rewardType: mysqlEnum('reward_type', ['coins', 'gems', 'item']).notNull(),
  amount: ubigint('amount').notNull().default(0),
  itemId: ubigint('item_id').references(() => lrShopItems.id, { onDelete: 'set null' }),
  sortOrder: int('sort_order').notNull().default(0),
});

export const lrUserEventProgress = mysqlTable(
  'lr_user_event_progress',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    eventId: ubigint('event_id')
      .notNull()
      .references(() => lrEvents.id, { onDelete: 'cascade' }),
    progress: int('progress', { unsigned: true }).notNull().default(0),
    claimedMilestones: json('claimed_milestones')
      .$type<number[]>()
      .notNull()
      .default(sql`(json_array())`),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uq_user_event').on(t.userId, t.eventId)],
);

export const lrTournaments = mysqlTable('lr_tournaments', {
  id: pk(),
  name: varchar('name', { length: 80 }).notNull(),
  mode: mysqlEnum('mode', ['classic', 'power']).notNull().default('classic'),
  entryFeeCoins: ubigint('entry_fee_coins').notNull().default(0),
  /** 16/64/256 — brackets of 4-player tables. Virtual coins ONLY (Envato AUP). */
  maxPlayers: smallint('max_players', { unsigned: true }).notNull(),
  state: mysqlEnum('state', ['registration', 'running', 'finished', 'cancelled'])
    .notNull()
    .default('registration'),
  prizeTable: json('prize_table').$type<Record<string, number>>(),
  registrationEndsAt: datetime('registration_ends_at'),
  startsAt: datetime('starts_at'),
  createdAt: createdAt(),
});

export const lrTournamentPlayers = mysqlTable(
  'lr_tournament_players',
  {
    id: pk(),
    tournamentId: ubigint('tournament_id')
      .notNull()
      .references(() => lrTournaments.id, { onDelete: 'cascade' }),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    seed: int('seed', { unsigned: true }),
    eliminatedRound: tinyint('eliminated_round', { unsigned: true }),
    finalPlace: int('final_place', { unsigned: true }),
  },
  (t) => [uniqueIndex('uq_tournament_user').on(t.tournamentId, t.userId)],
);

export const lrTournamentMatches = mysqlTable(
  'lr_tournament_matches',
  {
    id: pk(),
    tournamentId: ubigint('tournament_id')
      .notNull()
      .references(() => lrTournaments.id, { onDelete: 'cascade' }),
    round: tinyint('round', { unsigned: true }).notNull(),
    slot: int('slot', { unsigned: true }).notNull(),
    /** The 4 seats of the table. */
    playerIds: json('player_ids').$type<Array<number | null>>(),
    matchId: ubigint('match_id').references(() => lrMatches.id, { onDelete: 'set null' }),
    winnerUserId: ubigint('winner_user_id').references(() => lrUsers.id, {
      onDelete: 'set null',
    }),
    state: mysqlEnum('state', ['pending', 'playing', 'finished']).notNull().default('pending'),
  },
  (t) => [uniqueIndex('uq_tournament_round_slot').on(t.tournamentId, t.round, t.slot)],
);

// ===========================================================================
// §7.10 Configuration, admin & monetization
// ===========================================================================

export const lrSettings = mysqlTable('lr_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: text('value').notNull(),
  type: mysqlEnum('type', ['string', 'int', 'bool', 'json']).notNull().default('string'),
  /** rules · economy · matchmaking · ads · leaderboard · retention · general */
  grp: varchar('grp', { length: 32 }).notNull().default('general'),
  updatedAt: updatedAt(),
});

export const lrFeatureFlags = mysqlTable('lr_feature_flags', {
  flag: varchar('flag', { length: 48 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  description: varchar('description', { length: 190 }),
  phase: mysqlEnum('phase', ['v1.0', 'v1.1', 'v2']).notNull().default('v1.0'),
  updatedAt: updatedAt(),
});

export const lrAdminUsers = mysqlTable('lr_admin_users', {
  id: pk(),
  email: varchar('email', { length: 190 }).notNull().unique('uq_admin_email'),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  role: mysqlEnum('role', ['superadmin', 'ops', 'support', 'viewer'])
    .notNull()
    .default('viewer'),
  totpSecret: varchar('totp_secret', { length: 64 }),
  lastLoginAt: datetime('last_login_at'),
  failedAttempts: tinyint('failed_attempts', { unsigned: true }).notNull().default(0),
  lockedUntil: datetime('locked_until'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const lrAdminAuditLog = mysqlTable(
  'lr_admin_audit_log',
  {
    id: pk(),
    adminId: ubigint('admin_id').references(() => lrAdminUsers.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    entity: varchar('entity', { length: 48 }).notNull(),
    entityId: varchar('entity_id', { length: 48 }),
    beforeJson: json('before_json'),
    afterJson: json('after_json'),
    ip: varchar('ip', { length: 45 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_admin_created').on(t.adminId, t.createdAt),
    index('idx_entity').on(t.entity, t.entityId),
  ],
);

export const lrIapProducts = mysqlTable(
  'lr_iap_products',
  {
    id: pk(),
    storeSku: varchar('store_sku', { length: 80 }).notNull(),
    platform: mysqlEnum('platform', ['android', 'ios']).notNull(),
    shopItemId: ubigint('shop_item_id')
      .notNull()
      .references(() => lrShopItems.id, { onDelete: 'cascade' }),
    /** Reference price for admin KPIs only. */
    priceUsd: decimal('price_usd', { precision: 8, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_store_sku_platform').on(t.storeSku, t.platform)],
);

export const lrIapReceipts = mysqlTable(
  'lr_iap_receipts',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    platform: mysqlEnum('platform', ['android', 'ios']).notNull(),
    provider: mysqlEnum('provider', ['revenuecat', 'google', 'apple']).notNull(),
    storeSku: varchar('store_sku', { length: 80 }).notNull(),
    /** Webhook dedupe (§7.2 Gate 1 fix — dedupe in origin table). */
    eventId: varchar('event_id', { length: 120 }),
    transactionId: varchar('transaction_id', { length: 120 }),
    status: mysqlEnum('status', ['granted', 'refunded', 'invalid', 'pending']).notNull(),
    amountUsd: decimal('amount_usd', { precision: 8, scale: 2 }),
    rawPayload: json('raw_payload'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_iap_user').on(t.userId),
    uniqueIndex('uq_event_id').on(t.eventId),
    uniqueIndex('uq_transaction_id').on(t.transactionId),
  ],
);

export const lrAdRewards = mysqlTable(
  'lr_ad_rewards',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    network: mysqlEnum('network', ['admob']).notNull().default('admob'),
    placement: mysqlEnum('placement', [
      'daily_double',
      'wheel_spin',
      'coin_boost',
      'mission_skip',
    ]).notNull(),
    /** AdMob SSV dedupe (§8.4). */
    ssvTransactionId: varchar('ssv_transaction_id', { length: 120 }).notNull(),
    rewardType: mysqlEnum('reward_type', ['coins', 'gems', 'x2_bonus']).notNull(),
    amount: ubigint('amount').notNull().default(0),
    verified: boolean('verified').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_ssv_transaction').on(t.ssvTransactionId),
    // Daily cap window (`ad_reward_daily_cap`).
    index('idx_ads_user_created').on(t.userId, t.createdAt),
  ],
);

export const lrI18nStrings = mysqlTable(
  'lr_i18n_strings',
  {
    id: pk(),
    locale: char('locale', { length: 2 }).notNull(),
    namespace: varchar('namespace', { length: 32 }).notNull(),
    strKey: varchar('str_key', { length: 80 }).notNull(),
    value: text('value').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uq_locale_ns_key').on(t.locale, t.namespace, t.strKey)],
);

// ===========================================================================
// §7.11 Push notifications (v1.1 — schema day 1, Gate 1 decision)
// ===========================================================================

export const lrPushTokens = mysqlTable(
  'lr_push_tokens',
  {
    id: pk(),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    platform: mysqlEnum('platform', ['android', 'ios', 'web']).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: datetime('last_seen_at'),
  },
  (t) => [uniqueIndex('uq_token').on(t.token), index('idx_push_user').on(t.userId)],
);

// ===========================================================================
// §7.12 World chat (v2 — schema day 1, Gate 1 fix)
// ===========================================================================

export const lrChatMessages = mysqlTable(
  'lr_chat_messages',
  {
    id: pk(),
    scope: mysqlEnum('scope', ['global', 'match']).notNull(),
    matchId: ubigint('match_id').references(() => lrMatches.id, { onDelete: 'set null' }),
    userId: ubigint('user_id')
      .notNull()
      .references(() => lrUsers.id, { onDelete: 'cascade' }),
    body: varchar('body', { length: 200 }).notNull(),
    flagged: boolean('flagged').notNull().default(false),
    deletedAt: datetime('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('idx_chat_created').on(t.createdAt)],
);

export const lrChatMutes = mysqlTable('lr_chat_mutes', {
  id: pk(),
  userId: ubigint('user_id')
    .notNull()
    .references(() => lrUsers.id, { onDelete: 'cascade' }),
  mutedUntil: datetime('muted_until').notNull(),
  reason: varchar('reason', { length: 190 }),
  createdByAdminId: ubigint('created_by_admin_id').references(() => lrAdminUsers.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
});
