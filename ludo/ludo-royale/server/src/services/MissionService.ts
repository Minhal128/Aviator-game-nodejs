/**
 * MissionService — daily mission progress + claims (ARQUITECTURA §7.4/§8.1).
 *
 * Progress is pushed by EVENTS, never polled: MatchService feeds the match
 * counters (play/win/captures/sixes/pieces-home) through recordEventsIn()
 * inside its FINISHED transaction, so a crash can never grant a match's
 * rewards without its mission progress (§6.8.3).
 *
 * Dedupe contract (§7.2 Gate 1 fix): the reward's origin row is
 * lr_user_missions with UNIQUE(user_id, mission_id, period_key); the claim
 * flips claimed_at with an atomic guarded UPDATE and the WalletService credit
 * runs in the SAME transaction — double-claim is impossible by construction.
 *
 * [DECISIÓN] recordEventsIn upserts progress for every ACTIVE daily mission
 * matching the metric, regardless of min_level: hidden progress on a mission
 * the user cannot see yet is harmless, and it saves a users read inside the
 * hot match-end transaction. getMissions() (the UI read) DOES apply the
 * min_level gate.
 */
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { lrMissions, lrUserMissions, lrUsers } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import { dailyKey, weeklyKey } from './period.js';
import type { WalletService } from './WalletService.js';

/** Metrics a game event can push (subset of the lr_missions enum). */
export type MissionMetric =
  | 'play_matches'
  | 'win_matches'
  | 'capture_pieces'
  | 'roll_sixes'
  | 'pieces_home'
  | 'watch_ads'
  | 'spend_coins'
  | 'use_emotes';

export type MissionCounters = Partial<Record<MissionMetric, number>>;

export interface UserMissionView {
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

export interface MissionClaimResult {
  missionId: number;
  rewardType: 'coins' | 'gems';
  amount: number;
  balanceAfter: number;
}

export class MissionService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
  ) {}

  /** Active missions of the current period visible to this user + progress. */
  async getMissions(userId: number, now: Date = new Date()): Promise<UserMissionView[]> {
    const users = await this.db
      .select({ level: lrUsers.level })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    if (!users[0]) throw new ApiError(404, API_ERR.USER_NOT_FOUND);

    const periodKey = dailyKey(now);
    const rows = await this.db
      .select({
        id: lrMissions.id,
        code: lrMissions.code,
        metric: lrMissions.metric,
        target: lrMissions.target,
        rewardType: lrMissions.rewardType,
        rewardAmount: lrMissions.rewardAmount,
        sortOrder: lrMissions.sortOrder,
        progress: lrUserMissions.progress,
        completedAt: lrUserMissions.completedAt,
        claimedAt: lrUserMissions.claimedAt,
      })
      .from(lrMissions)
      .leftJoin(
        lrUserMissions,
        and(
          eq(lrUserMissions.missionId, lrMissions.id),
          eq(lrUserMissions.userId, userId),
          eq(lrUserMissions.periodKey, periodKey),
        ),
      )
      .where(
        and(
          eq(lrMissions.isActive, true),
          eq(lrMissions.period, 'daily'),
          lte(lrMissions.minLevel, users[0].level),
        ),
      )
      .orderBy(asc(lrMissions.sortOrder), asc(lrMissions.id));

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      metric: r.metric,
      target: r.target,
      rewardType: r.rewardType,
      rewardAmount: r.rewardAmount,
      sortOrder: r.sortOrder,
      periodKey,
      progress: r.progress ?? 0,
      completed: r.completedAt !== null && r.completedAt !== undefined,
      claimed: r.claimedAt !== null && r.claimedAt !== undefined,
    }));
  }

  /** Standalone event push (non-match sources: ads watched, emotes, …). */
  async recordEvent(userId: number, metric: MissionMetric, n = 1): Promise<void> {
    await this.db.transaction((tx) => this.recordEventsIn(tx, userId, { [metric]: n }));
  }

  /**
   * Upsert progress for every active daily mission whose metric appears in
   * `counters`, inside the CALLER's transaction. MySQL evaluates the
   * ON DUPLICATE assignments left-to-right, so completed_at reads the
   * already-incremented progress.
   */
  async recordEventsIn(
    tx: Tx,
    userId: number,
    counters: MissionCounters,
    periodKey: string = dailyKey(),
    now: Date = new Date(),
  ): Promise<void> {
    const metrics = (Object.keys(counters) as MissionMetric[]).filter(
      (m) => (counters[m] ?? 0) > 0,
    );
    if (metrics.length === 0) return;

    const missions = await tx
      .select({ id: lrMissions.id, metric: lrMissions.metric, target: lrMissions.target })
      .from(lrMissions)
      .where(
        and(
          eq(lrMissions.isActive, true),
          eq(lrMissions.period, 'daily'),
          inArray(lrMissions.metric, metrics),
        ),
      );

    for (const mission of missions) {
      const n = counters[mission.metric as MissionMetric] ?? 0;
      if (n <= 0) continue;
      await tx
        .insert(lrUserMissions)
        .values({
          userId,
          missionId: mission.id,
          periodKey,
          progress: n,
          completedAt: n >= mission.target ? now : null,
        })
        .onDuplicateKeyUpdate({
          set: {
            // Unqualified column names: in ON DUPLICATE KEY UPDATE they refer
            // to the CURRENT row. Order matters (progress first).
            progress: sql`progress + ${n}`,
            completedAt: sql`IF(completed_at IS NULL AND progress >= ${mission.target}, ${now}, completed_at)`,
          },
        });
    }
  }

  /**
   * Claim a completed mission of the CURRENT period. Atomic: the guarded
   * UPDATE on the UNIQUE origin row and the wallet credit share one tx.
   */
  async claim(userId: number, missionId: number, now: Date = new Date()): Promise<MissionClaimResult> {
    return this.db.transaction(async (tx) => {
      const missions = await tx
        .select({
          id: lrMissions.id,
          period: lrMissions.period,
          rewardType: lrMissions.rewardType,
          rewardAmount: lrMissions.rewardAmount,
        })
        .from(lrMissions)
        .where(and(eq(lrMissions.id, missionId), eq(lrMissions.isActive, true)))
        .limit(1);
      const mission = missions[0];
      if (!mission) throw new ApiError(404, API_ERR.NOT_FOUND, 'mission not found');
      // Item-reward missions ship with the backpack UI wave (v1.1): the
      // acquired_via enum has no 'mission' source yet, so admin-created item
      // missions are not claimable in v1.0.
      if (mission.rewardType === 'item') {
        throw new ApiError(400, API_ERR.VALIDATION, 'item mission rewards arrive in v1.1');
      }

      const periodKey = mission.period === 'weekly' ? weeklyKey(now) : dailyKey(now);
      const rows = await tx
        .select({
          id: lrUserMissions.id,
          completedAt: lrUserMissions.completedAt,
          claimedAt: lrUserMissions.claimedAt,
        })
        .from(lrUserMissions)
        .where(
          and(
            eq(lrUserMissions.userId, userId),
            eq(lrUserMissions.missionId, missionId),
            eq(lrUserMissions.periodKey, periodKey),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row || row.completedAt === null) {
        throw new ApiError(409, API_ERR.NOT_COMPLETED, 'mission is not completed');
      }

      // Atomic claim: a concurrent claim loses this UPDATE and rolls back.
      const [claimed] = await tx
        .update(lrUserMissions)
        .set({ claimedAt: now })
        .where(and(eq(lrUserMissions.id, row.id), isNull(lrUserMissions.claimedAt)));
      if (claimed.affectedRows === 0) {
        throw new ApiError(409, API_ERR.ALREADY_CLAIMED, 'mission reward already claimed');
      }

      const { balanceAfter } = await this.wallet.creditIn(
        tx,
        userId,
        mission.rewardType,
        mission.rewardAmount,
        'mission_reward',
        'user_mission',
        row.id,
      );
      return {
        missionId,
        rewardType: mission.rewardType,
        amount: mission.rewardAmount,
        balanceAfter,
      };
    });
  }
}
