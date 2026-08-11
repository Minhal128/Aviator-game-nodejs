import type { AiLevel, PlayerColor, PowerType, RuleFlags } from './types.js';

/** Bumped only on breaking client↔server message changes (§6.5). */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Board geometry (ARQUITECTURA §5.1)
// ---------------------------------------------------------------------------

export const TRACK_SIZE = 52;
/** Last color-relative step that is still on the shared ring. */
export const LAST_TRACK_STEP = 50;
/** First step of the private home lane (6 cells: 51..56). */
export const LANE_START = 51;
/** Reaching exactly this steps value puts the piece in HOME. */
export const HOME_STEPS = 57;
export const BASE_STEPS = -1;
export const PIECES_PER_PLAYER = 4;

/** Seat order is turn order; colors are fixed to board corners. */
export const PLAYER_COLORS: readonly PlayerColor[] = ['red', 'blue', 'yellow', 'green'];

export const ENTRY_CELLS: Readonly<Record<PlayerColor, number>> = {
  red: 0,
  blue: 13,
  yellow: 26,
  green: 39,
};

/** The 4 entry cells + 4 star cells. Never a capture here (§5.2.3). */
export const SAFE_CELLS: ReadonlySet<number> = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// ---------------------------------------------------------------------------
// Turn defaults
// ---------------------------------------------------------------------------

export const MAX_CONSECUTIVE_SIXES = 3;
export const DEFAULT_TURN_TIMER_S = 15;
/** How long the client shows a wasted roll before the auto-skip (§5.2.7). */
export const SKIP_DISPLAY_MS = 800;

export const DEFAULT_RULES: Readonly<RuleFlags> = {
  blockEnabled: true,
  extraTurnOnCapture: true,
  tripleSixForfeit: true,
  playForSecond: true,
  autoMoveOnTimeout: true,
};

// ---------------------------------------------------------------------------
// POWER mode (Ludo World parity — token drops + collectible powers)
// ---------------------------------------------------------------------------

/** Max tokens on the board at once (Ludo World shows ~6-7). */
export const POWER_MAX_TOKENS = 6;
/** Tokens seeded at match start. */
export const POWER_INITIAL_TOKENS = 3;
/** Per-roll spawn chance, percent (deterministic hash decides, not RNG). */
export const POWER_SPAWN_PCT = 38;
/** Per-type charge cap — extra pickups beyond it are wasted. */
export const POWER_CHARGE_CAP = 3;
/** Spawn weights (sum 100): plus is common, shield is the rare one. */
export const POWER_WEIGHTS: ReadonlyArray<{ power: 'plus' | 'double' | 'pick' | 'shield'; w: number }> = [
  { power: 'plus', w: 40 },
  { power: 'double', w: 25 },
  { power: 'pick', w: 20 },
  { power: 'shield', w: 15 },
];

// ---------------------------------------------------------------------------
// POWER economy (inventory model — powers are bought with gold and consumed)
// ---------------------------------------------------------------------------

/** Every power type, in shop / in-match HUD display order. */
export const POWER_TYPES: readonly PowerType[] = [
  'plus',
  'double',
  'pick',
  'shield',
  'bomb',
  'bolt',
  'freeze',
  'portal',
];

/**
 * The BATTLE set — the only powers sold in the shop (hybrid economy): the
 * classic four keep dropping on the board; these four are bought with gold,
 * seeded from the inventory at match start and consumed on use.
 */
export const BATTLE_POWERS: ReadonlySet<PowerType> = new Set([
  'bomb',
  'bolt',
  'freeze',
  'portal',
] as PowerType[]);

/** Max uses of EACH battle power within a single match (inventory model). */
export const POWER_MATCH_CAP = 2;

/** Bolt: cells an enemy piece is knocked back (below 0 = back to BASE). */
export const BOLT_KNOCKBACK = 6;

/**
 * CPU loadouts by difficulty for POWER vs CPU — the charges each CPU seat
 * opens the match with (humans seed theirs from the shop inventory).
 */
export const AI_POWER_LOADOUTS: Readonly<
  Record<AiLevel, Readonly<Partial<Record<PowerType, number>>>>
> = {
  // BATTLE set only — the classic four the CPU earns from board drops,
  // exactly like the human player.
  easy: {},
  medium: { bolt: 1, freeze: 1 },
  hard: { bomb: 1, bolt: 1, freeze: 1, portal: 1 },
};

/**
 * Shop price in gold (coins) per power. The per-match charge is seeded from
 * the owned qty (clamped to POWER_MATCH_CAP), so price is the main balance
 * lever. Tunable during balance / by the future admin panel.
 */
export const POWER_PRICES: Record<PowerType, number> = {
  plus: 400,
  double: 600,
  pick: 700,
  shield: 900,
  bomb: 1000,
  bolt: 1200,
  freeze: 1000,
  portal: 1500,
};

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

/** Hard AI scoring weights (§5.6) — tunable during Sprint 1 balance. */
export const AI_WEIGHTS = {
  capture: 100,
  reachHome: 90,
  exitBase: 60,
  safeCell: 40,
  progress: 25,
  threatPenalty: 80,
  formWall: 30,
  breakWallPenalty: 15,
} as const;
