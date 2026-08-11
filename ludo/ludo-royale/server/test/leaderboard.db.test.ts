/**
 * LeaderboardService against REAL MySQL: the GREATEST(0, …) upsert into both
 * period rows, top-N + my-rank reads over idx_rank, and the idempotent
 * weekly snapshot.
 */
import { expect, it } from 'vitest';
import { lrUsers } from '../src/db/schema.js';
import { ALLTIME_KEY, LeaderboardService } from '../src/services/LeaderboardService.js';
import { weeklyKey } from '../src/services/period.js';
import { SettingsService } from '../src/services/SettingsService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('LeaderboardService (§7.6)', () => {
  const suite = setupDbSuite();

  function build() {
    const db = suite.db();
    return { db, board: new LeaderboardService(db, new SettingsService(db)) };
  }

  async function createUser(name: string): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `lb_${name}_${Math.random().toString(36).slice(2, 8)}`,
      isGuest: true,
    });
    return header.insertId;
  }

  async function bump(board: LeaderboardService, userId: number, delta: number): Promise<void> {
    await suite.db().transaction((tx) => board.bumpIn(tx, userId, delta));
  }

  it('bumpIn upserts BOTH weekly and alltime rows and accumulates', async () => {
    const { board } = build();
    const userId = await createUser('acc');

    await bump(board, userId, 30);
    await bump(board, userId, 10);

    const weekly = await board.getView('weekly', userId);
    const alltime = await board.getView('alltime', userId);
    expect(weekly.periodKey).toBe(weeklyKey());
    expect(alltime.periodKey).toBe(ALLTIME_KEY);
    expect(weekly.me).toEqual({ rank: 1, score: 40 });
    expect(alltime.me).toEqual({ rank: 1, score: 40 });
  });

  it('scores floor at 0 (leave penalty cannot go negative)', async () => {
    const { board } = build();
    const userId = await createUser('floor');

    await bump(board, userId, 30);
    await bump(board, userId, -10);
    await bump(board, userId, -10);
    await bump(board, userId, -10);
    await bump(board, userId, -10); // would be -10 without the floor

    const view = await board.getView('weekly', userId);
    expect(view.me).toEqual({ rank: 1, score: 0 });
  });

  it('top-N is score-descending with correct ranks and my position', async () => {
    const { board } = build();
    const gold = await createUser('gold');
    const silver = await createUser('silver');
    const bronze = await createUser('bronze');
    await bump(board, gold, 90);
    await bump(board, silver, 60);
    await bump(board, bronze, 30);

    const view = await board.getView('weekly', bronze, 2);
    expect(view.entries.map((e) => e.userId)).toEqual([gold, silver]); // limit 2
    expect(view.entries[0]!.rank).toBe(1);
    expect(view.entries[1]!.rank).toBe(2);
    expect(view.me).toEqual({ rank: 3, score: 30 });
  });

  it('snapshotWeek freezes the top-100 once; re-running adds nothing', async () => {
    const { board } = build();
    const a = await createUser('snapA');
    const b = await createUser('snapB');
    await bump(board, a, 50);
    await bump(board, b, 20);

    const periodKey = weeklyKey(); // freeze the live week directly
    const first = await board.snapshotWeek(periodKey);
    expect(first).toBe(2);
    const second = await board.snapshotWeek(periodKey);
    expect(second).toBe(0); // idempotent

    // snapshotIfDue targets LAST week — empty live rows there → no-op.
    expect(await board.snapshotIfDue()).toBe(0);
  });
});
