/**
 * DailyBonusService — claim/streak/double against REAL MySQL: one claim per
 * UTC day (atomic guard), strict streak reset + configurable grace (§7.4),
 * and the deterministic lr_ad_rewards dedupe of the double-with-ad.
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrUsers, lrUserStreaks, lrWalletTransactions } from '../src/db/schema.js';
import { DailyBonusService } from '../src/services/DailyBonusService.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { dailyKey } from '../src/services/period.js';
import { SettingsService } from '../src/services/SettingsService.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describeDb('DailyBonusService (§7.4)', () => {
  const suite = setupDbSuite();

  function build() {
    const db = suite.db();
    const wallet = new WalletService(db);
    const settings = new SettingsService(db);
    return { db, wallet, settings, daily: new DailyBonusService(db, wallet, settings) };
  }

  async function createUser(coins = 0): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `daily_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
      coins,
    });
    return header.insertId;
  }

  /** Seed the streak row as if the last claim happened `daysAgo` days ago. */
  async function seedStreak(userId: number, daysAgo: number, currentDay: number, streak: number) {
    await suite.db().insert(lrUserStreaks).values({
      userId,
      currentDay,
      streakCount: streak,
      lastClaimDate: dailyKey(new Date(Date.now() - daysAgo * DAY_MS)),
      totalClaims: streak,
    });
  }

  it('fresh user: state shows day 1 unclaimed; claim pays the day-1 coins', async () => {
    const { daily, wallet } = build();
    const userId = await createUser();

    const before = await daily.getState(userId);
    expect(before.claimedToday).toBe(false);
    expect(before.currentDay).toBe(1);
    expect(before.calendar).toHaveLength(7);

    const result = await daily.claim(userId);
    expect(result.day).toBe(1);
    expect(result.streakCount).toBe(1);
    expect(result.amount).toBe(500); // seeded day-1 reward

    expect((await wallet.getBalances(userId)).coins).toBe(500);
    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries[0]!.type).toBe('daily_bonus');
    expect(ledger.entries[0]!.refType).toBe('user_streak');

    const after = await daily.getState(userId);
    expect(after.claimedToday).toBe(true);
    expect(after.currentDay).toBe(1);
  });

  it('second claim the same day is rejected and pays NOTHING', async () => {
    const { daily, wallet } = build();
    const userId = await createUser();
    await daily.claim(userId);

    await expect(daily.claim(userId)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.ALREADY_CLAIMED),
    );
    expect((await wallet.getBalances(userId)).coins).toBe(500);
    const rows = await suite.db()
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('claiming the day after advances the cycle and the streak', async () => {
    const { daily } = build();
    const userId = await createUser();
    await seedStreak(userId, 1, 1, 1); // claimed day 1 yesterday

    const result = await daily.claim(userId);
    expect(result.day).toBe(2);
    expect(result.streakCount).toBe(2);
    expect(result.amount).toBe(750); // seeded day-2 reward
  });

  it('day 7 wraps back to day 1 while the streak keeps counting', async () => {
    const { daily } = build();
    const userId = await createUser();
    await seedStreak(userId, 1, 7, 7);

    const result = await daily.claim(userId);
    expect(result.day).toBe(1);
    expect(result.streakCount).toBe(8);
  });

  it('STRICT default: a missed day resets to day 1, streak 1', async () => {
    const { daily } = build();
    const userId = await createUser();
    await seedStreak(userId, 3, 4, 9); // last claim 3 days ago

    const result = await daily.claim(userId);
    expect(result.day).toBe(1);
    expect(result.streakCount).toBe(1);
  });

  it('grace hours keep a barely-missed streak alive (streak_reset_grace_h)', async () => {
    const { daily, settings } = build();
    // 30h of grace: a claim 2 days ago is still alive early in the day.
    await settings.set('streak_reset_grace_h', '30', 'int', 'general');
    const userId = await createUser();
    await seedStreak(userId, 2, 3, 3);

    const result = await daily.claim(userId);
    expect(result.day).toBe(4);
    expect(result.streakCount).toBe(4);
  });

  it('claim-double doubles today, is UNIQUE-deduped, and requires claim first', async () => {
    const { daily, wallet } = build();
    const userId = await createUser();

    // Double before claiming → rejected.
    await expect(
      daily.claimDouble(userId, { adCompleted: true }),
    ).rejects.toSatisfy((err: unknown) => isApiError(err, API_ERR.NOT_COMPLETED));

    await daily.claim(userId); // day 1 → 500
    const doubled = await daily.claimDouble(userId, { adCompleted: true });
    expect(doubled.doubled).toBe(true);
    expect(doubled.amount).toBe(500);
    expect((await wallet.getBalances(userId)).coins).toBe(1000);

    // Second double the same day → lr_ad_rewards UNIQUE rejects it.
    await expect(
      daily.claimDouble(userId, { adCompleted: true }),
    ).rejects.toSatisfy((err: unknown) => isApiError(err, API_ERR.ALREADY_CLAIMED));
    expect((await wallet.getBalances(userId)).coins).toBe(1000);

    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries.map((e) => e.type).sort()).toEqual(['ad_reward', 'daily_bonus']);
  });

  it('CONCURRENCY: two parallel claims — exactly one wins', async () => {
    const { daily, wallet } = build();
    const userId = await createUser();

    const results = await Promise.allSettled([daily.claim(userId), daily.claim(userId)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect((await wallet.getBalances(userId)).coins).toBe(500);
  });
});
