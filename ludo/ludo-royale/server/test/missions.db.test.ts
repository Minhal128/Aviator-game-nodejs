/**
 * MissionService — event-driven progress + claim dedupe against REAL MySQL:
 * the UNIQUE(user_id, mission_id, period_key) upsert, completion detection
 * inside the ON DUPLICATE update, and the §7.2 claim transaction.
 */
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrMissions, lrUsers, lrWalletTransactions } from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { MissionService } from '../src/services/MissionService.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('MissionService (§7.4)', () => {
  const suite = setupDbSuite();

  function build() {
    const db = suite.db();
    const wallet = new WalletService(db);
    return { db, wallet, missions: new MissionService(db, wallet) };
  }

  async function createUser(): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `mission_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
    });
    return header.insertId;
  }

  async function missionByCode(code: string) {
    const rows = await suite.db().select().from(lrMissions).where(eq(lrMissions.code, code));
    return rows[0]!;
  }

  it('recordEvent accumulates progress on the matching daily mission', async () => {
    const { missions } = build();
    const userId = await createUser();

    await missions.recordEvent(userId, 'play_matches', 1);
    await missions.recordEvent(userId, 'play_matches', 1);

    const view = await missions.getMissions(userId);
    const play3 = view.find((m) => m.code === 'daily_play_3')!;
    expect(play3.progress).toBe(2);
    expect(play3.completed).toBe(false);
    // Other metrics untouched.
    expect(view.find((m) => m.code === 'daily_win_1')!.progress).toBe(0);
  });

  it('reaching the target marks the mission completed', async () => {
    const { missions } = build();
    const userId = await createUser();

    await missions.recordEvent(userId, 'win_matches', 1); // target 1
    const view = await missions.getMissions(userId);
    const win = view.find((m) => m.code === 'daily_win_1')!;
    expect(win.completed).toBe(true);
    expect(win.claimed).toBe(false);
  });

  it('claim pays the reward once; a second claim is rejected (UNIQUE origin)', async () => {
    const { missions, wallet, db } = build();
    const userId = await createUser();
    const mission = await missionByCode('daily_win_1');

    await missions.recordEvent(userId, 'win_matches', 1);
    const result = await missions.claim(userId, mission.id);
    expect(result.amount).toBe(750);
    expect(result.balanceAfter).toBe(750);

    await expect(missions.claim(userId, mission.id)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.ALREADY_CLAIMED),
    );

    expect((await wallet.getBalances(userId)).coins).toBe(750);
    const ledger = await db
      .select()
      .from(lrWalletTransactions)
      .where(
        and(eq(lrWalletTransactions.userId, userId), eq(lrWalletTransactions.type, 'mission_reward')),
      );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.refType).toBe('user_mission');
  });

  it('claiming an uncompleted mission is rejected with ERR_NOT_COMPLETED', async () => {
    const { missions } = build();
    const userId = await createUser();
    const mission = await missionByCode('daily_play_3');

    await missions.recordEvent(userId, 'play_matches', 1); // 1 of 3
    await expect(missions.claim(userId, mission.id)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.NOT_COMPLETED),
    );
  });

  it('progress is isolated per period_key (yesterday never leaks into today)', async () => {
    const { missions, db } = build();
    const userId = await createUser();

    // Simulate yesterday's completed run through the composition API.
    await db.transaction((tx) =>
      missions.recordEventsIn(tx, userId, { play_matches: 3 }, '2020-01-01'),
    );

    const view = await missions.getMissions(userId);
    expect(view.find((m) => m.code === 'daily_play_3')!.progress).toBe(0);
  });

  it('overshooting the target still counts every event (progress uncapped)', async () => {
    const { missions } = build();
    const userId = await createUser();
    await missions.recordEvent(userId, 'capture_pieces', 9); // target 5

    const view = await missions.getMissions(userId);
    const capture = view.find((m) => m.code === 'daily_capture_5')!;
    expect(capture.progress).toBe(9);
    expect(capture.completed).toBe(true);
  });
});
