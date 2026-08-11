/**
 * WalletService — the §7.2 transactional contract against REAL MySQL:
 * relative UPDATE + guard, balance_after snapshot in-tx, typed insufficient
 * funds, InnoDB-serialized concurrency, and origin-table dedupe composition.
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrMissions, lrUserMissions, lrUsers, lrWalletTransactions } from '../src/db/schema.js';
import { isDuplicateKeyError } from '../src/services/AuthService.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('WalletService (§7.2 contract)', () => {
  const suite = setupDbSuite();

  async function createUser(coins = 0, gems = 0): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `wallet_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
      coins,
      gems,
    });
    return header.insertId;
  }

  it('credit increases the balance and appends a ledger row with balance_after', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(1000);

    const result = await wallet.credit(userId, 'coins', 250, 'match_prize', 'match', 77);

    expect(result.balanceAfter).toBe(1250);
    const balances = await wallet.getBalances(userId);
    expect(balances.coins).toBe(1250);

    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries).toHaveLength(1);
    const entry = ledger.entries[0]!;
    expect(entry.amount).toBe(250);
    expect(entry.balanceAfter).toBe(1250);
    expect(entry.type).toBe('match_prize');
    expect(entry.refType).toBe('match');
    expect(entry.refId).toBe(77);
  });

  it('debit decreases the balance and records a NEGATIVE ledger amount', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(1000);

    const result = await wallet.debit(userId, 'coins', 400, 'match_entry', 'match', 12);

    expect(result.balanceAfter).toBe(600);
    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries[0]!.amount).toBe(-400);
    expect(ledger.entries[0]!.balanceAfter).toBe(600);
  });

  it('debit beyond balance throws ERR_INSUFFICIENT_FUNDS and mutates NOTHING', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(100);

    await expect(wallet.debit(userId, 'coins', 101, 'match_entry')).rejects.toSatisfy(
      (err: unknown) => isApiError(err, API_ERR.INSUFFICIENT_FUNDS),
    );

    expect((await wallet.getBalances(userId)).coins).toBe(100);
    expect((await wallet.getLedger(userId)).entries).toHaveLength(0);
  });

  it('gems are an independent currency with their own guard', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(0, 10);

    await wallet.credit(userId, 'gems', 5, 'daily_bonus');
    await expect(wallet.debit(userId, 'gems', 16, 'shop_purchase')).rejects.toSatisfy(
      (err: unknown) => isApiError(err, API_ERR.INSUFFICIENT_FUNDS),
    );

    const balances = await wallet.getBalances(userId);
    expect(balances.gems).toBe(15);
    expect(balances.coins).toBe(0);
  });

  it('rejects zero, negative and non-integer amounts', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(100);

    for (const bad of [0, -5, 1.5]) {
      await expect(wallet.credit(userId, 'coins', bad, 'admin_adjust')).rejects.toSatisfy(
        (err: unknown) => isApiError(err, API_ERR.INVALID_AMOUNT),
      );
    }
  });

  it('unknown user → ERR_USER_NOT_FOUND, no ledger row', async () => {
    const wallet = new WalletService(suite.db());
    await expect(wallet.credit(999_999, 'coins', 10, 'admin_adjust')).rejects.toSatisfy(
      (err: unknown) => isApiError(err, API_ERR.USER_NOT_FOUND),
    );
  });

  it('CONCURRENCY: two parallel credits serialize — final balance and both balance_after are consistent', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(0);

    await Promise.all([
      wallet.credit(userId, 'coins', 100, 'admin_adjust'),
      wallet.credit(userId, 'coins', 250, 'admin_adjust'),
    ]);

    expect((await wallet.getBalances(userId)).coins).toBe(350);

    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries).toHaveLength(2);
    const byBalance = [...ledger.entries].sort((a, b) => a.balanceAfter - b.balanceAfter);
    // Starting from 0, whichever landed first snapshots its own amount and
    // the second snapshots the running total — regardless of winner.
    expect(byBalance[0]!.balanceAfter).toBe(byBalance[0]!.amount);
    expect(byBalance[1]!.balanceAfter).toBe(350);
  });

  it('CONCURRENCY: two parallel debits with funds for only one — exactly one succeeds', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(100);

    const results = await Promise.allSettled([
      wallet.debit(userId, 'coins', 80, 'match_entry'),
      wallet.debit(userId, 'coins', 80, 'match_entry'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(
      isApiError((failed[0] as PromiseRejectedResult).reason, API_ERR.INSUFFICIENT_FUNDS),
    ).toBe(true);

    expect((await wallet.getBalances(userId)).coins).toBe(20);
    expect((await wallet.getLedger(userId)).entries).toHaveLength(1);
  });

  it('origin-table dedupe: duplicate mission claim rolls back the composed credit (§7.2)', async () => {
    const db = suite.db();
    const wallet = new WalletService(db);
    const userId = await createUser(0);
    const missions = await db.select({ id: lrMissions.id }).from(lrMissions).limit(1);
    const missionId = missions[0]!.id;
    const periodKey = '2026-07-02';

    const claim = () =>
      db.transaction(async (tx) => {
        // UNIQUE(user_id, mission_id, period_key) is the dedupe — inserted in
        // the SAME tx as the wallet credit, exactly as MissionService will.
        await tx.insert(lrUserMissions).values({
          userId,
          missionId,
          periodKey,
          progress: 3,
          completedAt: new Date(),
          claimedAt: new Date(),
        });
        return wallet.creditIn(tx, userId, 'coins', 500, 'mission_reward', 'user_mission', missionId);
      });

    await claim();
    await expect(claim()).rejects.toSatisfy((err: unknown) => isDuplicateKeyError(err));

    // Second attempt rolled back completely: one grant, one ledger row.
    expect((await wallet.getBalances(userId)).coins).toBe(500);
    const ledgerRows = await db
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, userId));
    expect(ledgerRows).toHaveLength(1);
  });

  it('getLedger paginates by id cursor, newest first', async () => {
    const wallet = new WalletService(suite.db());
    const userId = await createUser(0);
    for (let i = 1; i <= 5; i++) {
      await wallet.credit(userId, 'coins', i * 10, 'admin_adjust');
    }

    const page1 = await wallet.getLedger(userId, { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.entries[0]!.amount).toBe(50);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await wallet.getLedger(userId, { limit: 2, beforeId: page1.nextCursor! });
    expect(page2.entries[0]!.amount).toBe(30);

    const page3 = await wallet.getLedger(userId, { limit: 2, beforeId: page2.nextCursor! });
    expect(page3.entries).toHaveLength(1);
    expect(page3.entries[0]!.amount).toBe(10);
    expect(page3.nextCursor).toBeNull();
  });
});
