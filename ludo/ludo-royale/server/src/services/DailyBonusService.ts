/**
 * DailyBonusService — 7-day claim calendar with streak (ARQUITECTURA §7.4).
 *
 * Streak rule (blueprint default, STRICT): lr_user_streaks.last_claim_date is
 * a UTC calendar date. Claiming on the day after the last claim advances the
 * cycle (day 1→2→…→7→1) and streak_count; letting a full UTC day pass resets
 * to day 1 at the 00:00 UTC cutoff. `streak_reset_grace_h` (settings, default
 * 0, max 48) pushes that cutoff forward: the streak survives while
 * now < startOfDay(last_claim + 2 days) + grace hours.
 *
 * Dedupe: one claim per UTC day, enforced by an atomic guarded UPDATE on the
 * lr_user_streaks row (`last_claim_date <> today`) in the SAME transaction as
 * the WalletService credit (§7.2 — ledger ref user_streak/user_id).
 *
 * Double-with-ad: v1 accepts the client's `adCompleted` flag and records the
 * grant in lr_ad_rewards with a DETERMINISTIC ssv_transaction_id
 * (`daily-double:<userId>:<date>`) so the UNIQUE index makes the double
 * idempotent per day. >>> SSV INTEGRATION POINT (Sprint 3c, §8.4): when the
 * AdMob server-side-verification callback lands, it calls claimDouble() with
 * the REAL ssvTransactionId + verified=true and the client flag is ignored —
 * nothing else in this service changes. <<<
 */
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { lrAdRewards, lrDailyBonusConfig, lrUserInventory, lrUserStreaks } from '../db/schema.js';
import { isDuplicateKeyError } from './AuthService.js';
import { API_ERR, ApiError } from './errors.js';
import { dailyKey, daysBetween, utcDayStart } from './period.js';
import type { SettingsService } from './SettingsService.js';
import type { WalletService } from './WalletService.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface DailyBonusDay {
  day: number;
  rewardType: 'coins' | 'gems' | 'item';
  amount: number;
  itemId: number | null;
  doubleWithAd: boolean;
}

export interface DailyBonusState {
  calendar: DailyBonusDay[];
  /** Day (1-7) already claimed today, or the day the NEXT claim will grant. */
  currentDay: number;
  streakCount: number;
  claimedToday: boolean;
  doubledToday: boolean;
  canDouble: boolean;
}

export interface DailyClaimResult {
  day: number;
  streakCount: number;
  rewardType: 'coins' | 'gems' | 'item';
  amount: number;
  doubled: boolean;
}

export class DailyBonusService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
  ) {}

  async getState(userId: number, now: Date = new Date()): Promise<DailyBonusState> {
    const today = dailyKey(now);
    const graceH = await this.settings.getInt('streak_reset_grace_h', 0);

    const calendar = await this.loadCalendar();
    const rows = await this.db
      .select()
      .from(lrUserStreaks)
      .where(eq(lrUserStreaks.userId, userId))
      .limit(1);
    const row = rows[0];

    const claimedToday = row?.lastClaimDate === today;
    const alive = row ? streakAlive(row.lastClaimDate, now, graceH) : false;
    const currentDay = !row ? 1 : claimedToday ? row.currentDay : alive ? (row.currentDay % 7) + 1 : 1;

    const doubled = await this.db
      .select({ id: lrAdRewards.id })
      .from(lrAdRewards)
      .where(
        and(
          eq(lrAdRewards.userId, userId),
          eq(lrAdRewards.placement, 'daily_double'),
          gte(lrAdRewards.createdAt, utcDayStart(now)),
        ),
      )
      .limit(1);
    const doubledToday = doubled.length > 0;
    const dayConfig = calendar.find((c) => c.day === currentDay);

    return {
      calendar,
      currentDay,
      streakCount: row && (alive || claimedToday) ? row.streakCount : 0,
      claimedToday,
      doubledToday,
      canDouble:
        claimedToday &&
        !doubledToday &&
        (dayConfig?.doubleWithAd ?? false) &&
        dayConfig?.rewardType !== 'item',
    };
  }

  /** Claim today's bonus. One per UTC day; advances or resets the streak. */
  async claim(userId: number, now: Date = new Date()): Promise<DailyClaimResult> {
    const today = dailyKey(now);
    const graceH = await this.settings.getInt('streak_reset_grace_h', 0);

    return this.db.transaction(async (tx) => {
      // Ensure the row exists (no-op on duplicate — never clobbers a claim).
      await tx
        .insert(lrUserStreaks)
        .values({ userId, currentDay: 1, streakCount: 0, lastClaimDate: null, totalClaims: 0 })
        .onDuplicateKeyUpdate({ set: { userId: sql`user_id` } });

      const rows = await tx
        .select()
        .from(lrUserStreaks)
        .where(eq(lrUserStreaks.userId, userId))
        .limit(1);
      const row = rows[0]!;
      if (row.lastClaimDate === today) {
        throw new ApiError(409, API_ERR.ALREADY_CLAIMED, 'daily bonus already claimed today');
      }

      const alive = streakAlive(row.lastClaimDate, now, graceH);
      const day = alive ? (row.currentDay % 7) + 1 : 1;
      const streakCount = alive ? row.streakCount + 1 : 1;

      // Atomic dedupe: a concurrent claim of the same day matches 0 rows.
      const [claimed] = await tx
        .update(lrUserStreaks)
        .set({
          currentDay: day,
          streakCount,
          lastClaimDate: today,
          totalClaims: sql`total_claims + 1`,
        })
        .where(
          and(
            eq(lrUserStreaks.userId, userId),
            sql`(last_claim_date IS NULL OR last_claim_date <> ${today})`,
          ),
        );
      if (claimed.affectedRows === 0) {
        throw new ApiError(409, API_ERR.ALREADY_CLAIMED, 'daily bonus already claimed today');
      }

      const config = await this.dayConfig(day);
      if (config.rewardType === 'item' && config.itemId !== null) {
        // "Cat (1d)"-style expiring item days (§7.4). UI flag item_expiration_ui
        // is v1.1 but the backend grant works from day one.
        await tx
          .insert(lrUserInventory)
          .values({
            userId,
            itemId: config.itemId,
            qty: 1,
            acquiredVia: 'daily_bonus',
            expiresAt: config.itemDurationH
              ? new Date(now.getTime() + config.itemDurationH * HOUR_MS)
              : null,
            createdAt: now,
          })
          .onDuplicateKeyUpdate({ set: { qty: sql`qty + 1` } });
      } else if (config.rewardType !== 'item') {
        await this.wallet.creditIn(
          tx,
          userId,
          config.rewardType,
          config.amount,
          'daily_bonus',
          'user_streak',
          userId,
        );
      }

      return { day, streakCount, rewardType: config.rewardType, amount: config.amount, doubled: false };
    });
  }

  /**
   * Double today's ALREADY-CLAIMED bonus after a rewarded ad. See the SSV
   * integration note in the file header — v1 trusts `adCompleted`.
   */
  async claimDouble(
    userId: number,
    opts: { adCompleted: boolean; ssvTransactionId?: string; verified?: boolean },
    now: Date = new Date(),
  ): Promise<DailyClaimResult> {
    if (!opts.adCompleted) {
      throw new ApiError(400, API_ERR.VALIDATION, 'rewarded ad was not completed');
    }
    const today = dailyKey(now);

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(lrUserStreaks)
        .where(eq(lrUserStreaks.userId, userId))
        .limit(1);
      const row = rows[0];
      if (!row || row.lastClaimDate !== today) {
        throw new ApiError(409, API_ERR.NOT_COMPLETED, 'claim the daily bonus first');
      }

      const config = await this.dayConfig(row.currentDay);
      if (!config.doubleWithAd || config.rewardType === 'item') {
        throw new ApiError(400, API_ERR.VALIDATION, 'today\'s bonus cannot be doubled');
      }

      // UNIQUE(ssv_transaction_id) = the dedupe. Deterministic id in v1.
      const ssvId = opts.ssvTransactionId ?? `daily-double:${userId}:${today}`;
      let adRewardId: number;
      try {
        const [header] = await tx.insert(lrAdRewards).values({
          userId,
          network: 'admob',
          placement: 'daily_double',
          ssvTransactionId: ssvId,
          rewardType: 'x2_bonus',
          amount: config.amount,
          verified: opts.verified ?? false,
          createdAt: now,
        });
        adRewardId = header.insertId;
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new ApiError(409, API_ERR.ALREADY_CLAIMED, 'daily bonus already doubled today');
        }
        throw err;
      }

      await this.wallet.creditIn(
        tx,
        userId,
        config.rewardType,
        config.amount,
        'ad_reward',
        'ad_reward',
        adRewardId,
      );
      return {
        day: row.currentDay,
        streakCount: row.streakCount,
        rewardType: config.rewardType,
        amount: config.amount,
        doubled: true,
      };
    });
  }

  // ---------------------------------------------------------------------------

  private async loadCalendar(): Promise<DailyBonusDay[]> {
    const rows = await this.db
      .select()
      .from(lrDailyBonusConfig)
      .orderBy(asc(lrDailyBonusConfig.day));
    return rows.map((r) => ({
      day: r.day,
      rewardType: r.rewardType,
      amount: r.amount,
      itemId: r.itemId,
      doubleWithAd: r.doubleWithAd,
    }));
  }

  private async dayConfig(day: number): Promise<typeof lrDailyBonusConfig.$inferSelect> {
    const rows = await this.db
      .select()
      .from(lrDailyBonusConfig)
      .where(eq(lrDailyBonusConfig.day, day))
      .limit(1);
    if (!rows[0]) {
      throw new ApiError(500, API_ERR.INTERNAL, `daily bonus day ${day} is not configured`);
    }
    return rows[0];
  }
}

/**
 * True while the streak survives: last claim was yesterday, OR the strict
 * cutoff (start of last_claim + 2 days) extended by the grace hours has not
 * passed yet.
 */
function streakAlive(lastClaimDate: string | null, now: Date, graceH: number): boolean {
  if (!lastClaimDate) return false;
  const today = dailyKey(now);
  const gap = daysBetween(lastClaimDate, today);
  if (gap <= 0) return true; // same day (claim guard handles the dedupe)
  if (gap === 1) return true;
  const cutoff = Date.parse(`${lastClaimDate}T00:00:00Z`) + 2 * DAY_MS + graceH * HOUR_MS;
  return now.getTime() < cutoff;
}
