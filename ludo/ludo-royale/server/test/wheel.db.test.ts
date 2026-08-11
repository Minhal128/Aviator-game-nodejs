/**
 * WheelService — Lucky Wheel against REAL MySQL: seeded 8-segment wheel,
 * settings-driven daily quota (wheel_free_spins_per_day = 3), SERVER-side
 * weighted pick (rng injected like LudoRoom.rollDie), UTC-day reset, the
 * "nothing" slice, and the wheel_spin ledger refs (§7.2 origin-table rule).
 */
import { asc, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  lrLuckyWheelConfig,
  lrLuckyWheelSegments,
  lrLuckyWheelSpins,
  lrUsers,
  lrWalletTransactions,
} from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { utcDayStart } from '../src/services/period.js';
import { SettingsService } from '../src/services/SettingsService.js';
import { WalletService } from '../src/services/WalletService.js';
import { WheelService } from '../src/services/WheelService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describeDb('WheelService (§7.8)', () => {
  const suite = setupDbSuite();

  function build() {
    const db = suite.db();
    const wallet = new WalletService(db);
    const settings = new SettingsService(db);
    return { db, wallet, settings, wheel: new WheelService(db, wallet, settings) };
  }

  async function createUser(): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `wheel_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
      coins: 0,
      gems: 0,
    });
    return header.insertId;
  }

  /** FIFO rng script (mirrors helpers.scriptDice); `fallback` beyond it. */
  function scriptRng(wheel: WheelService, values: number[], fallback = 0): void {
    const queue = [...values];
    wheel.rng = () => queue.shift() ?? fallback;
  }

  /**
   * Seeded segments in pick order with each one's inclusive winning range
   * [start, end] over the cumulative weight line — rng rolls inside the
   * range MUST win that segment.
   */
  async function segmentTable() {
    const rows = await suite.db()
      .select()
      .from(lrLuckyWheelSegments)
      .orderBy(asc(lrLuckyWheelSegments.sortOrder), asc(lrLuckyWheelSegments.id));
    let acc = 0;
    return rows.map((r) => {
      const start = acc;
      acc += r.weight;
      return { ...r, start, end: acc - 1 };
    });
  }

  async function rollFor(labelKey: string): Promise<number> {
    const table = await segmentTable();
    const seg = table.find((t) => t.labelKey === labelKey);
    if (!seg) throw new Error(`segment ${labelKey} not seeded`);
    return seg.start;
  }

  it('initial state: 3 free spins, 8 visual segments, weights NOT exposed', async () => {
    const { wheel } = build();
    const userId = await createUser();

    const state = await wheel.getState(userId);
    expect(state.freeSpinsPerDay).toBe(3);
    expect(state.spinsUsedToday).toBe(0);
    expect(state.spinsLeft).toBe(3);
    expect(state.segments).toHaveLength(8);
    for (const seg of state.segments) {
      expect(seg).not.toHaveProperty('weight');
    }
    // The coins/amount-0 slice surfaces as 'nothing' to the client.
    const nothing = state.segments.find((s) => s.label === 'wheel_seg_nothing');
    expect(nothing?.type).toBe('nothing');
    expect(nothing?.amount).toBe(0);
    // Quota refills at the next 00:00 UTC.
    expect(state.nextResetAt.endsWith('T00:00:00.000Z')).toBe(true);
    expect(new Date(state.nextResetAt).getTime()).toBe(utcDayStart().getTime() + DAY_MS);
  });

  it('happy spin: credits the prize and burns a spin (ledger ref wheel_spin/id)', async () => {
    const { wheel, wallet } = build();
    const userId = await createUser();
    scriptRng(wheel, [await rollFor('wheel_seg_coins_100')]);

    const result = await wheel.spin(userId);
    expect(result.prize).toEqual({ type: 'coins', amount: 100, itemId: null });
    expect(result.spinsLeft).toBe(2);

    expect((await wallet.getBalances(userId)).coins).toBe(100);
    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.type).toBe('wheel_prize');
    expect(ledger.entries[0]!.refType).toBe('wheel_spin');
    expect(ledger.entries[0]!.refId).toBe(result.spinId);

    const after = await wheel.getState(userId);
    expect(after.spinsUsedToday).toBe(1);
    expect(after.spinsLeft).toBe(2);
  });

  it('weighted pick honors every segment boundary (server-side rng)', async () => {
    const { wheel, wallet, settings } = build();
    const userId = await createUser();
    const table = await segmentTable();

    // Both edges of every winning range → 16 deterministic spins.
    await settings.set('wheel_free_spins_per_day', '40', 'int', 'retention');
    const rolls: number[] = [];
    const expected: string[] = [];
    for (const seg of table) {
      rolls.push(seg.start, seg.end);
      expected.push(seg.labelKey, seg.labelKey);
    }
    scriptRng(wheel, rolls);

    const won: string[] = [];
    for (let i = 0; i < rolls.length; i++) {
      const result = await wheel.spin(userId);
      won.push(table.find((t) => t.id === result.segmentId)!.labelKey);
    }
    expect(won).toEqual(expected);

    // Every segment paid exactly twice — including the 5000-coin jackpot.
    const balances = await wallet.getBalances(userId);
    expect(balances.coins).toBe(2 * (100 + 250 + 500 + 1000 + 0 + 5000));
    expect(balances.gems).toBe(2 * (5 + 20));
  });

  it('daily limit: the 4th spin is rejected with ERR_NO_SPINS_LEFT and pays NOTHING', async () => {
    const { wheel, wallet } = build();
    const userId = await createUser();
    scriptRng(wheel, [], await rollFor('wheel_seg_coins_100'));

    for (let i = 0; i < 3; i++) await wheel.spin(userId);
    await expect(wheel.spin(userId)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.NO_SPINS_LEFT),
    );

    expect((await wallet.getBalances(userId)).coins).toBe(300);
    const spins = await suite.db()
      .select()
      .from(lrLuckyWheelSpins)
      .where(eq(lrLuckyWheelSpins.userId, userId));
    expect(spins).toHaveLength(3);
    expect((await wheel.getState(userId)).spinsLeft).toBe(0);
  });

  it('quota resets on the next UTC day (yesterday\'s spins do not count)', async () => {
    const { wheel } = build();
    const userId = await createUser();
    scriptRng(wheel, [], await rollFor('wheel_seg_coins_100'));

    // Exhaust YESTERDAY: 3 spin rows dated now − 24h, straight into the table.
    const wheelRow = (await suite.db().select().from(lrLuckyWheelConfig).limit(1))[0]!;
    const segment = (await segmentTable())[0]!;
    const yesterday = new Date(Date.now() - DAY_MS);
    await suite.db().insert(lrLuckyWheelSpins).values(
      Array.from({ length: 3 }, () => ({
        userId,
        wheelId: wheelRow.id,
        segmentId: segment.id,
        costType: 'free' as const,
        createdAt: yesterday,
      })),
    );

    const state = await wheel.getState(userId);
    expect(state.spinsUsedToday).toBe(0);
    expect(state.spinsLeft).toBe(3);

    const result = await wheel.spin(userId);
    expect(result.spinsLeft).toBe(2);
  });

  it('"nothing" consumes the spin but never touches the wallet', async () => {
    const { wheel, wallet } = build();
    const userId = await createUser();
    scriptRng(wheel, [await rollFor('wheel_seg_nothing')]);

    const result = await wheel.spin(userId);
    expect(result.prize).toEqual({ type: 'nothing', amount: 0, itemId: null });
    expect(result.spinsLeft).toBe(2);

    expect(await wallet.getBalances(userId)).toEqual({ coins: 0, gems: 0 });
    const ledger = await suite.db()
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, userId));
    expect(ledger).toHaveLength(0);
    // The spin row IS there — the quota was spent.
    const spins = await suite.db()
      .select()
      .from(lrLuckyWheelSpins)
      .where(eq(lrLuckyWheelSpins.userId, userId));
    expect(spins).toHaveLength(1);
    expect(spins[0]!.segmentId).toBe(result.segmentId);
  });

  it('ledger dedupe: exactly one wheel_prize per spin, refId = the spin row', async () => {
    const { wheel } = build();
    const userId = await createUser();
    scriptRng(wheel, [
      await rollFor('wheel_seg_coins_100'),
      await rollFor('wheel_seg_gems_5'),
      await rollFor('wheel_seg_coins_500'),
    ]);

    const spinIds: number[] = [];
    for (let i = 0; i < 3; i++) spinIds.push((await wheel.spin(userId)).spinId);

    const entries = await suite.db()
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, userId));
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.type).toBe('wheel_prize');
      expect(entry.refType).toBe('wheel_spin');
    }
    // One ledger row per ORIGIN spin row — ids match 1:1, no double-pay.
    const byId = (a: number, b: number) => a - b;
    expect(entries.map((e) => e.refId ?? -1).sort(byId)).toEqual([...spinIds].sort(byId));
    expect(new Set(entries.map((e) => e.refId)).size).toBe(3);
  });

  it('CONCURRENCY: 5 parallel spins with 3 free — exactly 3 win', async () => {
    const { wheel, wallet } = build();
    const userId = await createUser();
    scriptRng(wheel, [], await rollFor('wheel_seg_coins_100'));

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => wheel.spin(userId)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    for (const r of rejected) {
      expect(isApiError((r as PromiseRejectedResult).reason, API_ERR.NO_SPINS_LEFT)).toBe(true);
    }

    expect((await wallet.getBalances(userId)).coins).toBe(300);
    const spins = await suite.db()
      .select()
      .from(lrLuckyWheelSpins)
      .where(eq(lrLuckyWheelSpins.userId, userId));
    expect(spins).toHaveLength(3);
  });
});
