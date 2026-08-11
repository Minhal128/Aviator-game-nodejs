/**
 * LeaderboardService — trophies ranking (ARQUITECTURA §7.6).
 *
 * Score metric v1.0 = trophies, configurable via settings (seeded):
 *   leaderboard_score_win    (+30) · winner of any match
 *   leaderboard_score_second (+10) · 2nd place in 3P/4P
 *   leaderboard_score_leave  (−10) · leaving/forfeiting without winning
 * Scores floor at 0 (GREATEST in the upsert). MatchService pushes deltas via
 * bumpIn() inside its FINISHED transaction, into BOTH period rows: the ISO
 * week ('2026-W27') and 'alltime'.
 *
 * Reads ride idx_rank (scope, period_key, score DESC): top-N without
 * filesort, "my rank" as COUNT(score > mine) + 1.
 *
 * Weekly snapshot: snapshotIfDue() runs from the hourly housekeeping
 * interval (api.entry.ts). Once the ISO week rolls over (Monday 00:00 UTC),
 * the first run freezes the finished week's top-100 into
 * lr_leaderboard_snapshots — idempotent by the existence check + the
 * UNIQUE(scope, country, period, period_key, rank) index. Paying the
 * `leaderboard_rewards` prizes on top of the snapshot is admin/live-ops
 * territory and lands with the admin panel sprint (3c).
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Db, DbConn, Tx } from '../db/client.js';
import { lrLeaderboardLive, lrLeaderboardSnapshots, lrUsers } from '../db/schema.js';
import { previousWeeklyKey, weeklyKey } from './period.js';
import type { SettingsService } from './SettingsService.js';

export const ALLTIME_KEY = 'alltime';

export interface ScoreDeltas {
  win: number;
  second: number;
  leave: number;
}

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

export class LeaderboardService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** The §7.6 trophy deltas, admin-tunable through lr_settings. */
  async scoreDeltas(): Promise<ScoreDeltas> {
    return {
      win: await this.settings.getInt('leaderboard_score_win', 30),
      second: await this.settings.getInt('leaderboard_score_second', 10),
      leave: await this.settings.getInt('leaderboard_score_leave', -10),
    };
  }

  /**
   * Apply a score delta to the weekly AND alltime live rows, inside the
   * caller's transaction. Floors at 0 (§7.6).
   */
  async bumpIn(tx: Tx, userId: number, delta: number, now: Date = new Date()): Promise<void> {
    if (delta === 0) return;
    for (const periodKey of [weeklyKey(now), ALLTIME_KEY]) {
      await tx
        .insert(lrLeaderboardLive)
        .values({
          scope: 'global',
          periodKey,
          userId,
          score: Math.max(0, delta),
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            score: sql`GREATEST(0, score + ${delta})`,
            updatedAt: now,
          },
        });
    }
  }

  /** Top-N + the caller's own rank for a period ('weekly' | 'alltime'). */
  async getView(
    period: 'weekly' | 'alltime',
    userId?: number,
    limit = 100,
    now: Date = new Date(),
  ): Promise<LeaderboardView> {
    const periodKey = period === 'weekly' ? weeklyKey(now) : ALLTIME_KEY;
    const capped = Math.min(Math.max(limit, 1), 100);

    const rows = await this.db
      .select({
        userId: lrLeaderboardLive.userId,
        score: lrLeaderboardLive.score,
        username: lrUsers.username,
        avatarKey: lrUsers.avatarKey,
        level: lrUsers.level,
      })
      .from(lrLeaderboardLive)
      .innerJoin(lrUsers, eq(lrLeaderboardLive.userId, lrUsers.id))
      .where(and(eq(lrLeaderboardLive.scope, 'global'), eq(lrLeaderboardLive.periodKey, periodKey)))
      .orderBy(desc(lrLeaderboardLive.score), asc(lrLeaderboardLive.id))
      .limit(capped);

    const entries = rows.map((r, i) => ({ rank: i + 1, ...r }));

    let me: LeaderboardView['me'] = null;
    if (userId !== undefined) {
      me = await this.myRank(this.db, periodKey, userId);
    }
    return { periodKey, entries, me };
  }

  /**
   * Freeze the LAST FINISHED ISO week's top-100 (global scope) into
   * lr_leaderboard_snapshots. No-op when already snapshotted or when the
   * week has no rows yet. Safe to call any number of times.
   */
  async snapshotIfDue(now: Date = new Date()): Promise<number> {
    return this.snapshotWeek(previousWeeklyKey(now), now);
  }

  /** Snapshot one specific weekly period key. Returns rows written. */
  async snapshotWeek(periodKey: string, now: Date = new Date()): Promise<number> {
    const existing = await this.db
      .select({ id: lrLeaderboardSnapshots.id })
      .from(lrLeaderboardSnapshots)
      .where(
        and(
          eq(lrLeaderboardSnapshots.scope, 'global'),
          eq(lrLeaderboardSnapshots.period, 'weekly'),
          eq(lrLeaderboardSnapshots.periodKey, periodKey),
        ),
      )
      .limit(1);
    if (existing.length > 0) return 0;

    const top = await this.db
      .select({ userId: lrLeaderboardLive.userId, score: lrLeaderboardLive.score })
      .from(lrLeaderboardLive)
      .where(and(eq(lrLeaderboardLive.scope, 'global'), eq(lrLeaderboardLive.periodKey, periodKey)))
      .orderBy(desc(lrLeaderboardLive.score), asc(lrLeaderboardLive.id))
      .limit(100);
    if (top.length === 0) return 0;

    await this.db.insert(lrLeaderboardSnapshots).values(
      top.map((row, i) => ({
        scope: 'global' as const,
        country: null,
        period: 'weekly' as const,
        periodKey,
        rank: i + 1,
        userId: row.userId,
        score: row.score,
        snapshotAt: now,
      })),
    );
    return top.length;
  }

  private async myRank(
    conn: DbConn,
    periodKey: string,
    userId: number,
  ): Promise<{ rank: number; score: number } | null> {
    const mine = await conn
      .select({ score: lrLeaderboardLive.score })
      .from(lrLeaderboardLive)
      .where(
        and(
          eq(lrLeaderboardLive.scope, 'global'),
          eq(lrLeaderboardLive.periodKey, periodKey),
          eq(lrLeaderboardLive.userId, userId),
        ),
      )
      .limit(1);
    const score = mine[0]?.score;
    if (score === undefined) return null;

    const above = await conn
      .select({ n: sql<number>`COUNT(*)` })
      .from(lrLeaderboardLive)
      .where(
        and(
          eq(lrLeaderboardLive.scope, 'global'),
          eq(lrLeaderboardLive.periodKey, periodKey),
          gt(lrLeaderboardLive.score, score),
        ),
      );
    return { rank: (above[0]?.n ?? 0) + 1, score };
  }
}
