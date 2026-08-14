/**
 * AuthService — guest-first auth (ARQUITECTURA §8.2).
 *
 * Access token: JWT HS256, 15 min, claims { sub, aud: 'player' }. Both
 * processes verify with the same JWT_SECRET; only THIS service ever signs.
 *
 * Refresh token: opaque 256-bit random, stored as SHA-256 hex in
 * lr_user_sessions, TTL 30 days, ROTATED on every use. Token-family pattern:
 * every session row carries family_id = id of the root session of its chain.
 * Presenting an already-rotated/revoked refresh = reuse (theft signal) →
 * the WHOLE family is revoked and the caller gets ERR_REFRESH_REUSED.
 *
 * Guest-first: POST /auth/guest {deviceId} creates a playable account with
 * zero friction; the same deviceId recovers the same guest account. The
 * starter grant (initial_coins/initial_gems settings) flows through
 * WalletService (type 'signup_bonus') so SUM(ledger) == balance holds from
 * the very first row.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Db, Tx } from '../db/client.js';
import { lrUsers, lrUserSessions } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import type { SettingsService } from './SettingsService.js';
import { parseSiteUserId } from './SiteWallet.js';
import type { WalletService } from './WalletService.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** §9.7 whitelist. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface TokenPair {
  access: string;
  refresh: string;
  /** Access token lifetime in seconds (client schedules its refresh). */
  expiresIn: number;
}

export interface PublicUser {
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
  createdAt: Date;
}

export interface RequestContext {
  ip?: string;
  deviceInfo?: string;
}

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
    jwtSecret: string,
  ) {
    this.secret = new TextEncoder().encode(jwtSecret);
  }

  // -------------------------------------------------------------------------
  // Guest login (create or recover by deviceId)
  // -------------------------------------------------------------------------

  async guestLogin(
    params: { deviceId: string; name?: string },
    ctx: RequestContext = {},
  ): Promise<{ user: PublicUser; tokens: TokenPair; created: boolean }> {
    const existing = await this.db
      .select()
      .from(lrUsers)
      .where(and(eq(lrUsers.deviceId, params.deviceId), eq(lrUsers.isGuest, true)))
      .limit(1);

    let userId: number;
    let created = false;

    const found = existing[0];
    if (found) {
      if (found.status === 'banned') throw new ApiError(403, API_ERR.BANNED, found.banReason ?? undefined);
      if (found.status === 'deleted') throw new ApiError(401, API_ERR.USER_NOT_FOUND);
      userId = found.id;
      await this.db
        .update(lrUsers)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(lrUsers.id, userId));
    } else {
      userId = await this.createGuest(params.deviceId, params.name);
      created = true;
    }

    const tokens = await this.issueTokens(userId, ctx);
    const user = await this.publicUser(userId);
    return { user, tokens, created };
  }

  // -------------------------------------------------------------------------
  // Email accounts (§8.1 register/login — the guest upgrades IN PLACE, so
  // level/pet/wallet/inventory survive; login binds this device to an
  // existing account with a fresh token family)
  // -------------------------------------------------------------------------

  async registerEmail(userId: number, emailRaw: string, password: string): Promise<PublicUser> {
    const email = emailRaw.trim().toLowerCase();
    const rows = await this.db.select().from(lrUsers).where(eq(lrUsers.id, userId)).limit(1);
    const u = rows[0];
    if (!u || u.status === 'deleted') throw new ApiError(404, API_ERR.USER_NOT_FOUND);
    if (!u.isGuest) {
      throw new ApiError(400, API_ERR.VALIDATION, 'account already registered');
    }
    const taken = await this.db
      .select({ id: lrUsers.id })
      .from(lrUsers)
      .where(eq(lrUsers.email, email))
      .limit(1);
    if (taken[0] && taken[0].id !== userId) {
      throw new ApiError(409, API_ERR.EMAIL_TAKEN, 'email already registered');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.db
      .update(lrUsers)
      .set({ email, passwordHash, isGuest: false, updatedAt: new Date() })
      .where(eq(lrUsers.id, userId));
    return this.publicUser(userId);
  }

  async loginEmail(
    emailRaw: string,
    password: string,
    ctx: RequestContext = {},
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const email = emailRaw.trim().toLowerCase();
    const rows = await this.db.select().from(lrUsers).where(eq(lrUsers.email, email)).limit(1);
    const u = rows[0];
    // One generic error for wrong email OR password (no account probing).
    if (!u || u.isGuest || !u.passwordHash || u.status === 'deleted') {
      throw new ApiError(401, API_ERR.INVALID_CREDENTIALS, 'invalid email or password');
    }
    if (u.status === 'banned') {
      throw new ApiError(403, API_ERR.BANNED, u.banReason ?? undefined);
    }
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) throw new ApiError(401, API_ERR.INVALID_CREDENTIALS, 'invalid email or password');
    await this.db
      .update(lrUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(lrUsers.id, u.id));
    const tokens = await this.issueTokens(u.id, ctx);
    const user = await this.publicUser(u.id);
    return { user, tokens };
  }

  // -------------------------------------------------------------------------
  // Refresh rotation + reuse detection (§8.2)
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string, ctx: RequestContext = {}): Promise<TokenPair> {
    const hash = sha256(refreshToken);
    const rows = await this.db
      .select()
      .from(lrUserSessions)
      .where(eq(lrUserSessions.refreshTokenHash, hash))
      .limit(1);
    const session = rows[0];
    if (!session) throw new ApiError(401, API_ERR.INVALID_REFRESH);

    if (session.revokedAt !== null) {
      // Reuse of a rotated/revoked token — assume theft, kill the family.
      await this.revokeFamily(session.familyId ?? session.id);
      throw new ApiError(401, API_ERR.REFRESH_REUSED);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(401, API_ERR.REFRESH_EXPIRED);
    }

    const user = await this.db
      .select({ status: lrUsers.status })
      .from(lrUsers)
      .where(eq(lrUsers.id, session.userId))
      .limit(1);
    if (!user[0] || user[0].status === 'deleted') throw new ApiError(401, API_ERR.INVALID_REFRESH);
    if (user[0].status === 'banned') throw new ApiError(403, API_ERR.BANNED);

    // Atomic claim + rotation. On claim failure the tx returns null (NOT a
    // throw — a throw would roll back and undo any family revocation), and
    // the family is revoked OUTSIDE the transaction so it sticks.
    const rotated = await this.db.transaction(async (tx) => {
      // A concurrent rotation of the same token loses this UPDATE and is
      // treated as reuse (two racers with one token = one of them stolen).
      const [claimed] = await tx
        .update(lrUserSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(lrUserSessions.id, session.id), isNull(lrUserSessions.revokedAt)));
      if (claimed.affectedRows === 0) return null;
      return this.issueTokensIn(tx, session.userId, ctx, {
        familyId: session.familyId ?? session.id,
        rotatedFrom: session.id,
      });
    });
    if (rotated === null) {
      await this.revokeFamily(session.familyId ?? session.id);
      throw new ApiError(401, API_ERR.REFRESH_REUSED);
    }
    return rotated;
  }

  /** Revoke ONE session (logout of this device); family stays valid. */
  async logout(refreshToken: string): Promise<void> {
    await this.db
      .update(lrUserSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(lrUserSessions.refreshTokenHash, sha256(refreshToken)),
          isNull(lrUserSessions.revokedAt),
        ),
      );
  }

  // -------------------------------------------------------------------------
  // Access token verification (requireAuth middleware + game onAuth in 3b)
  // -------------------------------------------------------------------------

  async verifyAccess(token: string): Promise<{ userId: number }> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        audience: 'player',
        algorithms: ['HS256'],
      });
      const userId = Number(payload.sub);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new ApiError(401, API_ERR.INVALID_TOKEN);
      }
      return { userId };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, API_ERR.INVALID_TOKEN);
    }
  }

  // -------------------------------------------------------------------------
  // Profile (GET /api/v1/profile)
  // -------------------------------------------------------------------------

  async publicUser(userId: number): Promise<PublicUser> {
    const rows = await this.db.select().from(lrUsers).where(eq(lrUsers.id, userId)).limit(1);
    const u = rows[0];
    if (!u || u.status === 'deleted') throw new ApiError(404, API_ERR.USER_NOT_FOUND);
    const bal = await this.wallet.getBalances(userId);
    return {
      id: u.id,
      username: u.username,
      isGuest: u.isGuest,
      email: u.email,
      avatarKey: u.avatarKey,
      frameKey: u.frameKey,
      country: u.country,
      locale: u.locale,
      xp: u.xp,
      level: u.level,
      coins: bal.coins,
      gems: bal.gems,
      gamesPlayed: u.gamesPlayed,
      gamesWon: u.gamesWon,
      winStreak: u.winStreak,
      referralCode: u.referralCode,
      createdAt: u.createdAt,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Create the guest account + starter grant in ONE transaction: a crash
   * can never produce a user whose balance disagrees with the ledger.
   */
  private async createGuest(deviceId: string, name?: string): Promise<number> {
    // site-linked guests (tl{userId}) use the Turbo Legends wallet — no starter coins
    const siteLinked = parseSiteUserId(deviceId) !== null;
    const initialCoins = siteLinked ? 0 : await this.settings.getInt('initial_coins', 5000);
    const initialGems = await this.settings.getInt('initial_gems', 50);
    const wantedName = name !== undefined && USERNAME_RE.test(name) ? name : null;

    // Retry username/referral collisions (unique indexes are the authority).
    for (let attempt = 0; attempt < 5; attempt++) {
      const username = wantedName && attempt === 0 ? wantedName : generateGuestName();
      const referralCode = generateReferralCode();
      try {
        return await this.db.transaction(async (tx) => {
          const [header] = await tx.insert(lrUsers).values({
            username,
            isGuest: true,
            deviceId,
            referralCode,
            status: 'active',
            lastLoginAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const userId = header.insertId;
          if (initialCoins > 0) {
            await this.wallet.creditIn(tx, userId, 'coins', initialCoins, 'signup_bonus');
          }
          if (initialGems > 0) {
            await this.wallet.creditIn(tx, userId, 'gems', initialGems, 'signup_bonus');
          }
          return userId;
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) continue;
        throw err;
      }
    }
    throw new ApiError(409, API_ERR.USERNAME_TAKEN, 'could not allocate a unique username');
  }

  private issueTokens(
    userId: number,
    ctx: RequestContext,
    family?: { familyId: number; rotatedFrom: number },
  ): Promise<TokenPair> {
    return this.db.transaction((tx) => this.issueTokensIn(tx, userId, ctx, family));
  }

  private async issueTokensIn(
    tx: Tx,
    userId: number,
    ctx: RequestContext,
    family?: { familyId: number; rotatedFrom: number },
  ): Promise<TokenPair> {
    const access = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(userId))
      .setAudience('player')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TTL_S)
      .sign(this.secret);

    const refresh = randomBytes(32).toString('base64url');
    const [header] = await tx.insert(lrUserSessions).values({
      userId,
      refreshTokenHash: sha256(refresh),
      familyId: family?.familyId ?? null,
      rotatedFrom: family?.rotatedFrom ?? null,
      deviceInfo: ctx.deviceInfo ?? null,
      ip: ctx.ip ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      createdAt: new Date(),
    });
    if (!family) {
      // Root of a new family points at itself.
      await tx
        .update(lrUserSessions)
        .set({ familyId: header.insertId })
        .where(eq(lrUserSessions.id, header.insertId));
    }
    return { access, refresh, expiresIn: ACCESS_TTL_S };
  }

  private async revokeFamily(familyId: number): Promise<void> {
    await this.db
      .update(lrUserSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(lrUserSessions.familyId, familyId), isNull(lrUserSessions.revokedAt)));
  }
}

// -- helpers ------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** `Player_x7k2q` style — fits the §9.7 whitelist and the 24-char column. */
function generateGuestName(): string {
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]!.toLowerCase();
  }
  return `Player_${suffix}`;
}

function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]!;
  }
  return code;
}

/**
 * mysql2 surfaces ER_DUP_ENTRY as { code: 'ER_DUP_ENTRY', errno: 1062 };
 * drizzle may wrap it (DrizzleQueryError with `cause`), so walk the chain.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; errno?: number; cause?: unknown };
  if (e.code === 'ER_DUP_ENTRY' || e.errno === 1062) return true;
  return e.cause !== undefined && e.cause !== err && isDuplicateKeyError(e.cause);
}
