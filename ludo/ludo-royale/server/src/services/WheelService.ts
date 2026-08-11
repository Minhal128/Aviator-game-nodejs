/**
 * WheelService — Lucky Wheel daily spins (ARQUITECTURA §7.8), promoted to
 * v1.0 by owner request.
 *
 * Free spins per UTC day come from the `wheel_free_spins_per_day` setting
 * (default 3) — the same admin knob surface as the rest of the v1 economy;
 * lr_lucky_wheel_config.free_spins_daily stays as the v1.1 multi-wheel field.
 * "Today" is the UTC calendar day (dailyKey/utcDayStart, §7.4 convention),
 * so the counter resets at 00:00 UTC with no cron.
 *
 * Spin transaction (§7.2 origin-table pattern):
 *
 *   BEGIN;
 *   SELECT id FROM lr_users WHERE id = :u FOR UPDATE;   -- serialize per user
 *   SELECT COUNT(*) FROM lr_lucky_wheel_spins
 *     WHERE user_id = :u AND wheel_id = :w AND created_at >= :day_start;
 *   -- count >= free_spins → ROLLBACK + ERR_NO_SPINS_LEFT
 *   INSERT INTO lr_lucky_wheel_spins (...);             -- THE origin row
 *   -- prize (if any): WalletService.creditIn ref wheel_spin/<spin id>
 *   COMMIT;
 *
 * The spin INSERT is the origin of both the daily limit and the ledger
 * dedupe: the prize creditIn commits or rolls back WITH it, and its id is
 * the ledger ref — one wheel_prize entry per spin row, never re-paid. The
 * FOR UPDATE on the user row is required because a "nothing" segment never
 * touches lr_users, so the wallet row lock alone would not serialize two
 * concurrent spins counting the same window.
 *
 * RNG is SERVER-side crypto.randomInt over the weight sum, injected as a
 * public `rng` property exactly like LudoRoom.rollDie so tests script
 * outcomes deterministically. Segment weights are NEVER exposed to the
 * client — getState() returns only the visual fields.
 */
import { randomInt } from 'node:crypto';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import {
  lrLuckyWheelConfig,
  lrLuckyWheelSegments,
  lrLuckyWheelSpins,
  lrUserInventory,
  lrUsers,
} from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import { utcDayStart } from './period.js';
import type { SettingsService } from './SettingsService.js';
import type { WalletService } from './WalletService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Settings key: free spins per UTC day (admin knob, seeded default 3). */
export const WHEEL_FREE_SPINS_KEY = 'wheel_free_spins_per_day';
const WHEEL_FREE_SPINS_DEFAULT = 3;

/** Client-facing prize kind — amount-0 currency segments render as 'nothing'. */
export type WheelPrizeType = 'coins' | 'gems' | 'item' | 'nothing';

/** Visual segment view — deliberately WITHOUT `weight` (server secret). */
export interface WheelSegmentView {
  id: number;
  /** i18n label key (lr_lucky_wheel_segments.label_key). */
  label: string;
  type: WheelPrizeType;
  amount: number;
  itemId: number | null;
  color: string | null;
}

export interface WheelState {
  wheelId: number;
  name: string;
  segments: WheelSegmentView[];
  freeSpinsPerDay: number;
  spinsUsedToday: number;
  spinsLeft: number;
  /** ISO instant of the next 00:00 UTC — when spinsLeft refills. */
  nextResetAt: string;
}

export interface WheelSpinResult {
  /** lr_lucky_wheel_spins.id — the ledger ref of the prize. */
  spinId: number;
  segmentId: number;
  prize: { type: WheelPrizeType; amount: number; itemId: number | null };
  spinsLeft: number;
}

type SegmentRow = typeof lrLuckyWheelSegments.$inferSelect;

export class WheelService {
  /**
   * Uniform int in [0, maxExclusive) — SERVER-side crypto by default;
   * public so tests script the outcome (same pattern as LudoRoom.rollDie).
   */
  rng: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive);

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly settings: SettingsService,
  ) {}

  /** Wheel view + how many free spins the user still has today (UTC). */
  async getState(userId: number, now: Date = new Date()): Promise<WheelState> {
    const { wheel, segments } = await this.loadActiveWheel();
    const freeSpins = await this.freeSpinsPerDay();
    const used = await this.countSpinsToday(this.db, userId, wheel.id, now);
    return {
      wheelId: wheel.id,
      name: wheel.name,
      segments: segments.map(toView),
      freeSpinsPerDay: freeSpins,
      spinsUsedToday: used,
      spinsLeft: Math.max(0, freeSpins - used),
      nextResetAt: new Date(utcDayStart(now).getTime() + DAY_MS).toISOString(),
    };
  }

  /**
   * Spend one free spin: weighted server-side pick, spin row + prize in ONE
   * transaction. Throws ApiError(ERR_NO_SPINS_LEFT) when today's quota is
   * gone; a "nothing" segment consumes the spin without touching the wallet.
   */
  async spin(userId: number, now: Date = new Date()): Promise<WheelSpinResult> {
    // Config reads OUTSIDE the tx (cached; §10.1) — keeps the tx short.
    const { wheel, segments } = await this.loadActiveWheel();
    const freeSpins = await this.freeSpinsPerDay();
    const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight <= 0) {
      throw new ApiError(500, API_ERR.INTERNAL, `wheel ${wheel.id} has no spinnable segments`);
    }

    return this.db.transaction(async (tx) => {
      // 1) Serialize this user's spins — see the file header for why the
      //    wallet row lock alone is not enough ("nothing" prizes).
      const locked = await tx
        .select({ id: lrUsers.id })
        .from(lrUsers)
        .where(eq(lrUsers.id, userId))
        .limit(1)
        .for('update');
      if (locked.length === 0) throw new ApiError(404, API_ERR.USER_NOT_FOUND);

      // 2) Daily limit under the lock.
      const used = await this.countSpinsToday(tx, userId, wheel.id, now);
      if (used >= freeSpins) {
        throw new ApiError(409, API_ERR.NO_SPINS_LEFT, 'no free spins left today');
      }

      // 3) Weighted pick — crypto rng over the weight sum (schema §7.8).
      const winner = pickWeighted(segments, this.rng(totalWeight));

      // 4) THE origin row: its id is the ledger ref of the prize.
      const [header] = await tx.insert(lrLuckyWheelSpins).values({
        userId,
        wheelId: wheel.id,
        segmentId: winner.id,
        costType: 'free',
        createdAt: now,
      });
      const spinId = header.insertId;

      // 5) Prize in the SAME tx (rolls back with the spin row).
      const prizeType = viewType(winner);
      if (prizeType === 'coins' || prizeType === 'gems') {
        await this.wallet.creditIn(
          tx, userId, prizeType, winner.amount, 'wheel_prize', 'wheel_spin', spinId,
        );
      } else if (prizeType === 'item' && winner.itemId !== null) {
        // Item segments (none in the core seed, admin-configurable): same
        // inventory upsert as the daily-bonus item grant.
        await tx
          .insert(lrUserInventory)
          .values({
            userId,
            itemId: winner.itemId,
            qty: 1,
            acquiredVia: 'wheel',
            createdAt: now,
          })
          .onDuplicateKeyUpdate({ set: { qty: sql`qty + 1` } });
      }

      return {
        spinId,
        segmentId: winner.id,
        prize: { type: prizeType, amount: winner.amount, itemId: winner.itemId },
        spinsLeft: Math.max(0, freeSpins - used - 1),
      };
    });
  }

  // ---------------------------------------------------------------------------

  /** Active wheel + its segments in deterministic (sort_order, id) order. */
  private async loadActiveWheel(): Promise<{
    wheel: typeof lrLuckyWheelConfig.$inferSelect;
    segments: SegmentRow[];
  }> {
    const wheels = await this.db
      .select()
      .from(lrLuckyWheelConfig)
      .where(eq(lrLuckyWheelConfig.isActive, true))
      .orderBy(asc(lrLuckyWheelConfig.id))
      .limit(1);
    const wheel = wheels[0];
    if (!wheel) throw new ApiError(404, API_ERR.WHEEL_INACTIVE, 'lucky wheel is not active');

    const segments = await this.db
      .select()
      .from(lrLuckyWheelSegments)
      .where(eq(lrLuckyWheelSegments.wheelId, wheel.id))
      .orderBy(asc(lrLuckyWheelSegments.sortOrder), asc(lrLuckyWheelSegments.id));
    // weight-0 rows can never win — keep the visible wheel == the pickable set.
    return { wheel, segments: segments.filter((s) => s.weight > 0) };
  }

  private async freeSpinsPerDay(): Promise<number> {
    const n = await this.settings.getInt(WHEEL_FREE_SPINS_KEY, WHEEL_FREE_SPINS_DEFAULT);
    return Math.max(0, Math.trunc(n));
  }

  /** Spins of this user on this wheel since 00:00 UTC of `now`'s day. */
  private async countSpinsToday(
    conn: DbConn,
    userId: number,
    wheelId: number,
    now: Date,
  ): Promise<number> {
    const rows = await conn
      .select({ n: sql<number>`COUNT(*)` })
      .from(lrLuckyWheelSpins)
      .where(
        and(
          eq(lrLuckyWheelSpins.userId, userId),
          eq(lrLuckyWheelSpins.wheelId, wheelId),
          gte(lrLuckyWheelSpins.createdAt, utcDayStart(now)),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }
}

// ---------------------------------------------------------------------------

/** Client-facing kind: an amount-0 currency segment is a "nothing" slice. */
function viewType(segment: SegmentRow): WheelPrizeType {
  if (segment.rewardType === 'item') return 'item';
  return segment.amount > 0 ? segment.rewardType : 'nothing';
}

function toView(segment: SegmentRow): WheelSegmentView {
  return {
    id: segment.id,
    label: segment.labelKey,
    type: viewType(segment),
    amount: segment.amount,
    itemId: segment.itemId,
    color: segment.color,
  };
}

/**
 * Map a roll in [0, Σweights) onto the ordered segment list: segment i owns
 * the half-open range [Σw(0..i-1), Σw(0..i)). Caller guarantees Σweights > 0.
 */
function pickWeighted(segments: SegmentRow[], roll: number): SegmentRow {
  let cursor = roll;
  for (const segment of segments) {
    if (cursor < segment.weight) return segment;
    cursor -= segment.weight;
  }
  // Unreachable with a well-formed roll; guard against a buggy injected rng.
  const last = segments[segments.length - 1];
  if (!last) throw new ApiError(500, API_ERR.INTERNAL, 'wheel has no segments');
  return last;
}
