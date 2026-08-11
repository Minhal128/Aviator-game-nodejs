/**
 * XpService — minimal Sprint 3a version: accumulate XP, resolve the level
 * from the lr_xp_levels curve (cumulative xp_required, seeded 50 levels,
 * admin-editable), and pay level-up rewards through WalletService (ledger
 * type 'level_up', ref NULL — §7.2 reference table).
 *
 * MATCH-END HOOK (live since Sprint 3b): when a match reaches FINISHED,
 * MatchService.persistAndReward calls `addXpIn(tx, userId, xpEarned)` for
 * each human player inside the SAME transaction that persists the match,
 * with xpEarned resolved from placement (`match_xp_place` setting).
 */
import { asc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { lrUsers, lrXpLevels } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import type { WalletService } from './WalletService.js';

interface CurveRow {
  level: number;
  xpRequired: number;
  rewardCoins: number;
  rewardGems: number;
}

export interface AddXpResult {
  xp: number;
  level: number;
  leveledUp: boolean;
  /** Sum of level-up rewards credited by this call. */
  rewards: { coins: number; gems: number };
}

export class XpService {
  private curve: CurveRow[] | null = null;
  private curveFetchedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly curveTtlMs = 60_000,
  ) {}

  /**
   * Add `amount` XP (positive integer). Level ups are resolved against the
   * curve and their rewards credited in the SAME transaction as the XP/level
   * write — a crash never leaves a leveled user without their reward.
   */
  async addXp(userId: number, amount: number): Promise<AddXpResult> {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ApiError(400, API_ERR.INVALID_AMOUNT, `invalid xp amount: ${amount}`);
    }
    const curve = await this.getCurve();
    return this.db.transaction((tx) => this.applyXpIn(tx, userId, amount, curve));
  }

  /**
   * Composition variant (Sprint 3b): runs inside the CALLER's transaction so
   * MatchService can persist the match, pay prizes and add XP atomically
   * (§6.2 FINISHED = one MySQL transaction). Same contract as addXp.
   */
  async addXpIn(tx: Tx, userId: number, amount: number): Promise<AddXpResult> {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ApiError(400, API_ERR.INVALID_AMOUNT, `invalid xp amount: ${amount}`);
    }
    const curve = await this.getCurve();
    return this.applyXpIn(tx, userId, amount, curve);
  }

  private async applyXpIn(
    tx: Tx,
    userId: number,
    amount: number,
    curve: CurveRow[],
  ): Promise<AddXpResult> {
    const [header] = await tx
      .update(lrUsers)
      .set({ xp: sql`${lrUsers.xp} + ${amount}`, updatedAt: new Date() })
      .where(eq(lrUsers.id, userId));
    if (header.affectedRows === 0) throw new ApiError(404, API_ERR.USER_NOT_FOUND);

    const rows = await tx
      .select({ xp: lrUsers.xp, level: lrUsers.level })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) throw new ApiError(404, API_ERR.USER_NOT_FOUND);

    const newLevel = resolveLevel(curve, user.xp);
    const rewards = { coins: 0, gems: 0 };
    if (newLevel <= user.level) {
      return { xp: user.xp, level: user.level, leveledUp: false, rewards };
    }

    await tx
      .update(lrUsers)
      .set({ level: newLevel, updatedAt: new Date() })
      .where(eq(lrUsers.id, userId));

    // One ledger entry per currency per level gained (multi-level jumps
    // pay EVERY crossed level — the curve editor may stack small levels).
    for (const row of curve) {
      if (row.level <= user.level || row.level > newLevel) continue;
      if (row.rewardCoins > 0) {
        await this.wallet.creditIn(
          tx, userId, 'coins', row.rewardCoins, 'level_up',
          undefined, undefined, `level ${row.level}`,
        );
        rewards.coins += row.rewardCoins;
      }
      if (row.rewardGems > 0) {
        await this.wallet.creditIn(
          tx, userId, 'gems', row.rewardGems, 'level_up',
          undefined, undefined, `level ${row.level}`,
        );
        rewards.gems += row.rewardGems;
      }
    }

    return { xp: user.xp, level: newLevel, leveledUp: true, rewards };
  }

  /** XP threshold of the next level, or null at cap — for the profile bar. */
  async nextLevelAt(currentLevel: number): Promise<number | null> {
    const curve = await this.getCurve();
    const next = curve.find((r) => r.level === currentLevel + 1);
    return next ? next.xpRequired : null;
  }

  /** Cached curve, ordered by level ascending. */
  private async getCurve(conn: Db | Tx = this.db): Promise<CurveRow[]> {
    const now = Date.now();
    if (!this.curve || now - this.curveFetchedAt > this.curveTtlMs) {
      this.curve = await conn
        .select({
          level: lrXpLevels.level,
          xpRequired: lrXpLevels.xpRequired,
          rewardCoins: lrXpLevels.rewardCoins,
          rewardGems: lrXpLevels.rewardGems,
        })
        .from(lrXpLevels)
        .orderBy(asc(lrXpLevels.level));
      this.curveFetchedAt = now;
    }
    return this.curve;
  }
}

/** Highest curve level whose cumulative xp_required is within `xp`. */
function resolveLevel(curve: CurveRow[], xp: number): number {
  let level = 1;
  for (const row of curve) {
    if (xp >= row.xpRequired) level = row.level;
    else break;
  }
  return level;
}
