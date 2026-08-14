/**
 * Meta-game API client (ARQUITECTURA §8.1/§8.2) — same-origin `/api/v1`.
 *
 * Auth is guest-first and fully automatic: the first request triggers
 * POST /auth/guest with the stored deviceId (+ the locally chosen name when
 * it fits the server whitelist). The access JWT lives in memory only; the
 * refresh token persists in localStorage. Any 401 runs ONE recovery pass —
 * refresh rotation first, guest re-login as fallback (the deviceId recovers
 * the same account) — and retries the original request once. Concurrent
 * requests queue behind the single in-flight auth promise.
 *
 * Response types below mirror the REAL server payloads (routes/*.ts +
 * services/*.ts) with Date columns arriving as ISO strings over JSON.
 */
import { deviceId, getPlayerName } from '../game/net/identity';

const BASE = '/api/v1';
const REFRESH_KEY = 'lr_refresh_token';
/** Server-side username whitelist (AuthService §9.7). */
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

// ---------------------------------------------------------------------------
// Types — REAL server shapes
// ---------------------------------------------------------------------------

/** services/AuthService.ts PublicUser (createdAt serializes to ISO string). */
export interface ApiUser {
  id: number;
  username: string;
  isGuest: boolean;
  email: string | null;
  avatarKey: string;
  frameKey: string | null;
  country: string | null;
  locale: string;
  xp: number;
  level: number;
  coins: number;
  gems: number;
  gamesPlayed: number;
  gamesWon: number;
  winStreak: number;
  referralCode: string | null;
  createdAt: string;
}

interface TokenPair {
  access: string;
  refresh: string;
  expiresIn: number;
}

/** GET /profile */
export interface ProfileResponse {
  user: ApiUser;
  wallet: { coins: number; gems: number };
  xp: { current: number; level: number; nextLevelAt: number | null };
}

/** GET /matches/tiers */
export interface StakeTier {
  id: number;
  name: string;
  entryFee: number;
  minLevel: number;
}

/** GET /daily-bonus (DailyBonusService.getState) */
export interface DailyBonusDay {
  day: number;
  rewardType: 'coins' | 'gems' | 'item';
  amount: number;
  itemId: number | null;
  doubleWithAd: boolean;
}

export interface DailyBonusState {
  calendar: DailyBonusDay[];
  currentDay: number;
  streakCount: number;
  claimedToday: boolean;
  doubledToday: boolean;
  canDouble: boolean;
}

/** POST /daily-bonus/claim | /claim-double */
export interface DailyClaimResult {
  day: number;
  streakCount: number;
  rewardType: 'coins' | 'gems' | 'item';
  amount: number;
  doubled: boolean;
}

/** GET /missions (MissionService.UserMissionView) */
export interface MissionView {
  id: number;
  code: string;
  metric: string;
  target: number;
  rewardType: 'coins' | 'gems' | 'item';
  rewardAmount: number;
  sortOrder: number;
  periodKey: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

/** POST /missions/:id/claim */
export interface MissionClaimResult {
  missionId: number;
  rewardType: 'coins' | 'gems';
  amount: number;
  balanceAfter: number;
}

export type ShopCategory =
  | 'dice_skin'
  | 'token_skin'
  | 'bubble_skin'
  | 'board_theme'
  | 'avatar'
  | 'avatar_frame'
  | 'emote_pack'
  | 'coin_pack'
  | 'gem_pack'
  | 'booster';

/** Consumable power ids (sku `power_<id>` in the shop catalog). */
export type PowerId =
  | 'plus'
  | 'double'
  | 'pick'
  | 'shield'
  | 'bomb'
  | 'bolt'
  | 'freeze'
  | 'portal';

/** GET /shop → { items } (lr_shop_items rows). */
export interface ShopItem {
  id: number;
  sku: string;
  category: ShopCategory;
  nameKey: string;
  descKey: string | null;
  assetKey: string | null;
  priceCurrency: 'coins' | 'gems' | 'iap' | 'free';
  priceAmount: number;
  iapProductId: string | null;
  grantsCurrency: 'coins' | 'gems' | null;
  grantsAmount: number | null;
  durationH: number | null;
  minLevel: number;
  isActive: boolean;
  isFeatured: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
  sortOrder: number;
  createdAt: string;
}

/** POST /shop/purchase (ShopService.PurchaseResult) */
export interface PurchaseResult {
  itemId: number;
  sku: string;
  category: ShopCategory;
  paid: { currency: 'coins' | 'gems'; amount: number } | null;
  granted:
    | { kind: 'currency'; currency: 'coins' | 'gems'; amount: number }
    | { kind: 'inventory'; expiresAt: string | null };
}

/** GET /inventory → { items } (InventoryService.InventoryEntry) */
export interface InventoryItem {
  id: number;
  itemId: number;
  sku: string;
  category: ShopCategory;
  nameKey: string;
  assetKey: string | null;
  qty: number;
  isEquipped: boolean;
  expiresAt: string | null;
  acquiredVia: string;
}

/** GET /friends (FriendsService.FriendsOverview) */
export interface FriendEntry {
  userId: number;
  name: string;
  level: number;
  avatarKey: string;
  canGift: boolean;
}

export interface FriendRequestEntry {
  id: number;
  name: string;
  level: number;
}

export interface FriendsOverview {
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
}

/** GET /leaderboard (LeaderboardService.LeaderboardView) */
export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  avatarKey: string;
  level: number;
  score: number;
}

export interface LeaderboardView {
  periodKey: string;
  entries: LeaderboardEntry[];
  me: { rank: number; score: number } | null;
}

/** GET /mail (MailService.InboxPage) */
export interface MailEntry {
  id: number;
  title: string;
  body: string;
  attachmentType: 'none' | 'coins' | 'gems' | 'item';
  attachmentAmount: number | null;
  attachmentItemId: number | null;
  read: boolean;
  claimed: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface InboxPage {
  entries: MailEntry[];
  nextCursor: number | null;
}

/** POST /mail/:id/claim (MailService.MailClaimResult) */
export interface MailClaimResult {
  id: number;
  attachmentType: 'coins' | 'gems' | 'item';
  amount: number;
  balanceAfter: number | null;
}

/**
 * Lucky Wheel contract (landing with a parallel Sprint 3c agent; adjust at
 * integration if the real shape differs).
 */
export interface WheelSegment {
  id: number;
  label: string;
  kind: 'coins' | 'gems' | 'nothing' | 'jackpot';
  amount: number;
}

export interface WheelState {
  segments: WheelSegment[];
  spinsLeft: number;
  resetsAt: string;
}

export interface WheelSpinResult {
  spinId: number;
  segmentId: number;
  // The server sends prize.type (not .kind) and does NOT echo balances - the
  // prize IS the delta, applied to the HUD via bumpBalance.
  prize: { type: 'coins' | 'gems' | 'item' | 'nothing'; amount: number; itemId: number | null };
  spinsLeft: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Client twin of the server's { error: { code, message } } envelope. */
export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'MetaApiError';
  }
}

function toApiError(status: number, body: unknown): MetaApiError {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error: { code?: string; message?: string } }).error;
    return new MetaApiError(status, err.code ?? 'ERR_INTERNAL', err.message);
  }
  return new MetaApiError(status, status === 404 ? 'ERR_NOT_FOUND' : 'ERR_INTERNAL');
}

// ---------------------------------------------------------------------------
// Auth plumbing
// ---------------------------------------------------------------------------

let access: string | null = null;
let authFlight: Promise<void> | null = null;

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function guestLogin(): Promise<void> {
  const body: { deviceId: string; name?: string } = { deviceId: deviceId() };
  const name = getPlayerName();
  if (name !== null && USERNAME_RE.test(name)) body.name = name;
  const res = await postJson('/auth/guest', body);
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, json);
  const data = json as TokenPair & { user: ApiUser; created: boolean };
  access = data.access;
  localStorage.setItem(REFRESH_KEY, data.refresh);
}

/** Rotate the stored refresh token; false when absent/rejected. */
async function tryRefresh(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (refresh === null) return false;
  const res = await postJson('/auth/refresh', { refresh });
  if (!res.ok) {
    // Rotated-out / expired / family revoked — drop it and fall to guest.
    localStorage.removeItem(REFRESH_KEY);
    return false;
  }
  const data = (await res.json()) as TokenPair;
  access = data.access;
  localStorage.setItem(REFRESH_KEY, data.refresh);
  return true;
}

/**
 * Single-flight auth: everyone awaits the same promise, so a burst of boot
 * requests produces exactly one guest login / refresh chain.
 */
function ensureAuth(): Promise<void> {
  if (access !== null) return Promise.resolve();
  authFlight ??= (async () => {
    try {
      if (!(await tryRefresh())) await guestLogin();
    } finally {
      authFlight = null;
    }
  })();
  return authFlight;
}

// ---------------------------------------------------------------------------
// Request core
// ---------------------------------------------------------------------------

interface RequestInitLite {
  method?: 'GET' | 'POST';
  body?: unknown;
}

async function request<T>(path: string, init: RequestInitLite = {}, retried = false): Promise<T> {
  await ensureAuth();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${access ?? ''}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new MetaApiError(0, 'ERR_NETWORK');
  }
  if (res.status === 401 && !retried) {
    // Expired/revoked access — recover once (refresh → guest) and retry.
    access = null;
    await ensureAuth();
    return request<T>(path, init, true);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, json);
  return json as T;
}

// ---------------------------------------------------------------------------
// Public surface — one function per endpoint the overlay consumes
// ---------------------------------------------------------------------------

export const api = {
  /** Kick auth early (fire-and-forget at boot; errors surface on first use). */
  warmUp(): void {
    void ensureAuth().catch(() => undefined);
  },

  getProfile: () => request<ProfileResponse>('/profile'),
  /** Public stake tables — no auth (Play Online must not wait on guest login). */
  getTiers: async (): Promise<{ tiers: StakeTier[] }> => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/matches/tiers`);
    } catch {
      throw new MetaApiError(0, 'ERR_NETWORK');
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) throw toApiError(res.status, json);
    return json as { tiers: StakeTier[] };
  },

  getDailyBonus: () => request<DailyBonusState>('/daily-bonus'),
  claimDaily: () => request<DailyClaimResult>('/daily-bonus/claim', { method: 'POST', body: {} }),
  claimDailyDouble: () =>
    request<DailyClaimResult>('/daily-bonus/claim-double', {
      method: 'POST',
      body: { adCompleted: true },
    }),

  getMissions: () => request<{ missions: MissionView[] }>('/missions'),
  claimMission: (id: number) =>
    request<MissionClaimResult>(`/missions/${id}/claim`, { method: 'POST', body: {} }),

  getShop: () => request<{ items: ShopItem[] }>('/shop'),
  purchase: (sku: string) =>
    request<PurchaseResult>('/shop/purchase', { method: 'POST', body: { sku } }),

  getInventory: () => request<{ items: InventoryItem[] }>('/inventory'),
  /** POWER shop model: owned power quantities (seeds offline match charges). */
  getPowerLoadout: () =>
    request<{ powers: Partial<Record<PowerId, number>> }>('/inventory/powers'),
  /** POWER spend: one unit per successful USE_POWER in an offline match. */
  consumePower: (power: PowerId) =>
    request<{ consumed: boolean; qtyLeft: number }>('/inventory/powers/consume', {
      method: 'POST',
      body: { power },
    }),

  register: (email: string, password: string) =>
    request<{ user: ApiUser }>('/auth/register', { method: 'POST', body: { email, password } }),
  /** Email login: adopts the returned session, caller reloads the app. */
  login: async (email: string, password: string): Promise<ApiUser> => {
    const data = await request<TokenPair & { user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    access = data.access;
    localStorage.setItem(REFRESH_KEY, data.refresh);
    return data.user;
  },
  /** Logout of the account session; the caller reloads (guest re-login). */
  logoutAccount: async (): Promise<void> => {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (refresh !== null) {
      await request<{ ok: boolean }>('/auth/logout', { method: 'POST', body: { refresh } }).catch(
        () => null,
      );
    }
    localStorage.removeItem(REFRESH_KEY);
    access = null;
  },

  getFriends: () => request<FriendsOverview>('/friends'),
  friendRequest: (code: string) =>
    request<{ autoAccepted: boolean; name: string }>('/friends/request', {
      method: 'POST',
      body: { code },
    }),
  friendRespond: (requestId: number, accept: boolean) =>
    request<{ accepted: boolean }>('/friends/respond', {
      method: 'POST',
      body: { requestId, accept },
    }),
  friendRemove: (friendId: number) =>
    request<{ removed: boolean }>('/friends/remove', { method: 'POST', body: { friendId } }),
  friendGift: (friendId?: number) =>
    request<{ sent: number }>('/friends/gift', {
      method: 'POST',
      body: friendId === undefined ? {} : { friendId },
    }),
  equip: (itemId: number) =>
    request<InventoryItem>('/inventory/equip', { method: 'POST', body: { itemId } }),
  unequip: (category: ShopCategory) =>
    request<{ cleared: number }>('/inventory/unequip', { method: 'POST', body: { category } }),

  getLeaderboard: (period: 'weekly' | 'alltime') =>
    request<LeaderboardView>(`/leaderboard?period=${period}&limit=100`),

  getMail: (beforeId?: number) =>
    request<InboxPage>(`/mail?limit=50${beforeId !== undefined ? `&beforeId=${beforeId}` : ''}`),
  markMailRead: (id: number) => request<void>(`/mail/${id}/read`, { method: 'POST', body: {} }),
  claimMail: (id: number) =>
    request<MailClaimResult>(`/mail/${id}/claim`, { method: 'POST', body: {} }),

  getWheel: () => request<WheelState>('/wheel'),
  spinWheel: () => request<WheelSpinResult>('/wheel/spin', { method: 'POST', body: {} }),

  /** Credit an offline (vs CPU) match so playing earns coins + XP (leveling). */
  reportLocalMatch: (body: {
    mode: 'cpu' | 'local';
    numPlayers: number;
    powerMode: boolean;
    place: number;
    aiLevel?: 'easy' | 'medium' | 'hard';
  }) =>
    request<{
      coinsEarned: number;
      xpEarned: number;
      leveledUp: boolean;
      coins: number;
      gems: number;
      xp: number;
      level: number;
    }>('/matches/local-result', { method: 'POST', body }),
};
