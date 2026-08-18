/**
 * END-TO-END Sprint 3b: a REAL 2P Colyseus match over a REAL MySQL database.
 * The room resolves the guests' deviceIds, collects the Beginner entry fee
 * at countdown→PLAYING, and the matchEnd broadcast carries the REAL
 * coins/XP earned per seat — verified against the wallet afterwards.
 *
 * Uses the same @colyseus/testing boot as the Sprint 2 suites plus
 * setGameServices() to hand the room a suite-owned service container
 * (vitest isolates module registries per file, so nothing leaks).
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import { eq } from 'drizzle-orm';
import type { MatchEndMessage } from '@ludo/shared';
import appConfig from '../src/app.config.js';
import { lrMatches, lrMatchPlayers, lrRoomTiers, lrUsers } from '../src/db/schema.js';
import { buildGameServices, setGameServices, type GameServices } from '../src/services/gameServices.js';
import type { LudoRoom } from '../src/rooms/LudoRoom.js';
import { connectClient, playUntilEnd, tuneFast, type Quick2 } from './helpers.js';
import { describeDb, setupDbSuite, TEST_DB_URL } from './apiHelpers.js';

describeDb('LudoRoom + MatchService end-to-end (Sprint 3b)', () => {
  const suite = setupDbSuite();
  let colyseus: ColyseusTestServer;
  let services: GameServices;

  beforeAll(async () => {
    if (!TEST_DB_URL) throw new Error('DATABASE_URL_TEST required');
    colyseus = await boot(appConfig);
  });
  afterAll(async () => {
    setGameServices(null);
    await colyseus.shutdown();
  });
  beforeEach(async () => {
    // Fresh container over the suite db AFTER the truncate+seed of
    // setupDbSuite (hooks run in registration order).
    services = buildGameServices(suite.db());
    setGameServices(services);
    await colyseus.cleanup();
  });

  async function createGuest(deviceId: string, coins: number): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `flow_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
      deviceId,
      coins,
    });
    return header.insertId;
  }

  async function beginnerTierId(): Promise<number> {
    const rows = await suite.db()
      .select({ id: lrRoomTiers.id })
      .from(lrRoomTiers)
      .where(eq(lrRoomTiers.name, 'Beginner'));
    return rows[0]!.id;
  }

  /** Seat 0 always rolls exactly what its lead piece needs — it must win. */
  function riggedDice(room: LudoRoom): void {
    room.rollDie = () => {
      const match = room.matchState;
      if (!match || match.currentSeat !== 0) return 2;
      const mine = match.pieces.filter((p) => p.seat === 0 && p.steps < 57);
      const lead = mine.reduce((best, p) => (p.steps > best ? p.steps : best), -1);
      if (lead < 0) return 6;
      const remaining: number = 57 - lead;
      return remaining < 6 ? remaining : 6;
    };
  }

  it('2P quick match with a tier: fees debited, matchEnd carries REAL rewards, DB settled', async () => {
    const tierId = await beginnerTierId();
    // deviceIds must match test/helpers identity(tag) → `test-device-${tag}`.
    const winner = await createGuest('test-device-aaa1', 5000);
    const loser = await createGuest('test-device-bbb2', 5000);

    const room = (await colyseus.createRoom('quick', { size: 2, tierId })) as unknown as LudoRoom;
    tuneFast(room);
    riggedDice(room);
    const c1 = await connectClient(colyseus, room, 'aaa1');
    const c2 = await connectClient(colyseus, room, 'bbb2');
    const rig: Quick2 = { room, c1, c2 };
    await c1.log.next('turn');

    const end: MatchEndMessage = await playUntilEnd(rig);

    // Beginner 2P: pot 10, winner nets 1.4×5 − 5 = +2, 100 XP.
    expect(end.rewardsPending).toBeUndefined();
    expect(end.potTotal).toBe(10);
    const first = end.ranking.find((r) => r.place === 1)!;
    const second = end.ranking.find((r) => r.place === 2)!;
    expect(first.seat).toBe(0);
    expect(first.coinsDelta).toBe(2);
    expect(first.xpEarned).toBe(100);
    expect(second.coinsDelta).toBe(-5);
    expect(second.xpEarned).toBe(60);

    // Wallets: 4995 + 7 prize + 200 level-up = 5202 / loser keeps 4995.
    expect((await services.wallet.getBalances(winner)).coins).toBe(5202);
    expect((await services.wallet.getBalances(loser)).coins).toBe(4995);

    // The match row was opened at startPlaying and closed at FINISHED —
    // matchEnd is only broadcast AFTER persistAndReward committed, so the
    // database is already settled here.
    const matches = await suite.db().select().from(lrMatches);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.state).toBe('finished');
    expect(matches[0]!.tierId).toBe(tierId);
    expect(matches[0]!.winnerUserId).toBe(winner);
    expect(matches[0]!.seedHash).toHaveLength(64);
    expect(matches[0]!.rngRolls).toBeGreaterThan(0);

    const players = await suite.db()
      .select()
      .from(lrMatchPlayers)
      .where(eq(lrMatchPlayers.matchId, matches[0]!.id));
    expect(players).toHaveLength(2);
    expect(players.find((p) => p.seat === 0)!.userId).toBe(winner);
    expect(players.find((p) => p.seat === 0)!.piecesHome).toBe(4);

    // Missions progressed through the same transaction.
    const missions = await services.missions.getMissions(winner);
    expect(missions.find((m) => m.code === 'daily_play_3')!.progress).toBe(1);
    expect(missions.find((m) => m.code === 'daily_win_1')!.completed).toBe(true);
  }, 90000);

  it('without a tier the match persists as a FREE table (prizes 0, no fees)', async () => {
    const winner = await createGuest('test-device-aaa1', 5000);
    await createGuest('test-device-bbb2', 5000);

    const room = (await colyseus.createRoom('quick', { size: 2 })) as unknown as LudoRoom;
    tuneFast(room);
    riggedDice(room);
    const c1 = await connectClient(colyseus, room, 'aaa1');
    const c2 = await connectClient(colyseus, room, 'bbb2');
    await c1.log.next('turn');

    const end = await playUntilEnd({ room, c1, c2 });
    expect(end.potTotal).toBe(0);
    expect(end.ranking.find((r) => r.place === 1)!.coinsDelta).toBe(0);
    expect(end.ranking.find((r) => r.place === 1)!.xpEarned).toBe(100); // XP still flows

    // No fee, no prize — but 100 XP reaches level 2, whose reward pays 200.
    expect((await services.wallet.getBalances(winner)).coins).toBe(5200);
    const matches = await suite.db().select().from(lrMatches);
    expect(matches[0]!.entryFee).toBe(0);
    expect(matches[0]!.state).toBe('finished');
  }, 90000);
});
