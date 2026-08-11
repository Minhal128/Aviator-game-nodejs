/**
 * XpService against the seeded 50-level curve (level n at 50·(n−1)·n XP:
 * L2=100, L3=300, L4=600) with level-up rewards paid through WalletService.
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrUsers, lrWalletTransactions } from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { WalletService } from '../src/services/WalletService.js';
import { XpService } from '../src/services/XpService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('XpService (curve + level-up rewards)', () => {
  const suite = setupDbSuite();

  function services(): { wallet: WalletService; xp: XpService } {
    const wallet = new WalletService(suite.db());
    return { wallet, xp: new XpService(suite.db(), wallet) };
  }

  async function createUser(): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `xp_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
    });
    return header.insertId;
  }

  it('accumulates XP below the next threshold without leveling', async () => {
    const { xp } = services();
    const userId = await createUser();

    const result = await xp.addXp(userId, 99);

    expect(result).toMatchObject({ xp: 99, level: 1, leveledUp: false });
    expect(result.rewards).toEqual({ coins: 0, gems: 0 });
  });

  it('crossing a threshold levels up and credits the level reward via the ledger', async () => {
    const { xp, wallet } = services();
    const userId = await createUser();

    await xp.addXp(userId, 60);
    const result = await xp.addXp(userId, 60); // 120 XP ≥ 100 → level 2

    expect(result.leveledUp).toBe(true);
    expect(result.level).toBe(2);
    // Seed: reward_coins = 100·level.
    expect(result.rewards.coins).toBe(200);

    expect((await wallet.getBalances(userId)).coins).toBe(200);
    const ledger = await suite
      .db()
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, userId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('level_up');
    expect(ledger[0]!.refType).toBeNull();

    // lr_users.level cached column updated too.
    const rows = await suite.db().select().from(lrUsers).where(eq(lrUsers.id, userId));
    expect(rows[0]!.level).toBe(2);
    expect(rows[0]!.xp).toBe(120);
  });

  it('a big XP drop crossing SEVERAL levels pays every crossed level', async () => {
    const { xp, wallet } = services();
    const userId = await createUser();

    // 700 XP → past L2 (100), L3 (300), L4 (600).
    const result = await xp.addXp(userId, 700);

    expect(result.level).toBe(4);
    // 100·2 + 100·3 + 100·4 = 900 coins; no gem levels crossed (first at L5).
    expect(result.rewards.coins).toBe(900);
    expect(result.rewards.gems).toBe(0);
    expect((await wallet.getBalances(userId)).coins).toBe(900);
  });

  it('gem milestone levels (every 5th) also pay gems', async () => {
    const { xp, wallet } = services();
    const userId = await createUser();

    // L5 threshold = 50·4·5 = 1000 XP.
    const result = await xp.addXp(userId, 1000);

    expect(result.level).toBe(5);
    expect(result.rewards.gems).toBe(5);
    expect((await wallet.getBalances(userId)).gems).toBe(5);
  });

  it('rejects non-positive XP and unknown users', async () => {
    const { xp } = services();
    const userId = await createUser();

    await expect(xp.addXp(userId, 0)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.INVALID_AMOUNT),
    );
    await expect(xp.addXp(999_999, 10)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.USER_NOT_FOUND),
    );
  });

  it('nextLevelAt exposes the next threshold and null at the cap', async () => {
    const { xp } = services();
    expect(await xp.nextLevelAt(1)).toBe(100);
    expect(await xp.nextLevelAt(4)).toBe(1000);
    expect(await xp.nextLevelAt(50)).toBeNull();
  });
});
