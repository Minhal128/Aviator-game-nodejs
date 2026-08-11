/**
 * MatchService against REAL MySQL — the Sprint 3b core:
 *   · startMatch: fee collection into the pot + the "tier free" fallback
 *   · persistAndReward: ONE transaction paying pot/XP/stats/missions/
 *     leaderboard/first-win mail
 *   · IDEMPOTENCY: UNIQUE(match_id, seat) on lr_match_players is the origin
 *     dedupe — a second settle call pays NOTHING.
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  lrMatches,
  lrMatchPlayers,
  lrRoomTiers,
  lrUsers,
  lrWalletTransactions,
} from '../src/db/schema.js';
import { buildGameServices, type GameServices } from '../src/services/gameServices.js';
import type { SeatOutcome } from '../src/services/MatchService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('MatchService (§6.2/§7.3)', () => {
  const suite = setupDbSuite();

  function build(): GameServices {
    return buildGameServices(suite.db());
  }

  async function createUser(coins: number, deviceId: string): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `match_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
      deviceId,
      coins,
    });
    return header.insertId;
  }

  /** Seeded Beginner tier: fee 500, prize_table 2P [1.8, 0]. */
  async function beginnerTierId(): Promise<number> {
    const rows = await suite.db()
      .select({ id: lrRoomTiers.id })
      .from(lrRoomTiers)
      .where(eq(lrRoomTiers.name, 'Beginner'));
    return rows[0]!.id;
  }

  function outcome(over: Partial<SeatOutcome> & { seat: number; place: number }): SeatOutcome {
    return {
      isBot: false,
      color: over.seat === 0 ? 'red' : 'yellow',
      leftEarly: false,
      piecesHome: over.place === 1 ? 4 : 1,
      captures: 0,
      sixes: 0,
      disconnects: 0,
      ...over,
    };
  }

  it('startMatch debits the entry fee from every resolved seat into the pot', async () => {
    const services = build();
    const tierId = await beginnerTierId();
    const u1 = await createUser(5000, 'dev-fee-1-aaaaaaaa');
    const u2 = await createUser(5000, 'dev-fee-2-bbbbbbbb');

    const started = await services.matches.startMatch({
      mode: 'classic',
      type: 'quick',
      tierId,
      roomId: 'room_fee',
      maxPlayers: 2,
      seats: [
        { seat: 0, deviceId: 'dev-fee-1-aaaaaaaa' },
        { seat: 1, deviceId: 'dev-fee-2-bbbbbbbb' },
      ],
    });

    expect(started.entryFee).toBe(500);
    expect(started.pot).toBe(1000);
    expect(started.usedFreeFallback).toBe(false);
    expect(started.userBySeat.get(0)).toBe(u1);
    expect(started.userBySeat.get(1)).toBe(u2);

    expect((await services.wallet.getBalances(u1)).coins).toBe(4500);
    expect((await services.wallet.getBalances(u2)).coins).toBe(4500);

    const matches = await suite.db().select().from(lrMatches).where(eq(lrMatches.id, started.matchId));
    expect(matches[0]!.state).toBe('playing');
    expect(matches[0]!.pot).toBe(1000);
    const ledger = await services.wallet.getLedger(u1);
    expect(ledger.entries[0]!.type).toBe('match_entry');
    expect(ledger.entries[0]!.refId).toBe(started.matchId);
  });

  it('a seat that cannot pay downgrades the whole match to FREE (rollback of every debit)', async () => {
    const services = build();
    const tierId = await beginnerTierId();
    const rich = await createUser(5000, 'dev-free-1-aaaaaaaa');
    const broke = await createUser(100, 'dev-free-2-bbbbbbbb'); // fee is 500

    const started = await services.matches.startMatch({
      mode: 'classic',
      type: 'quick',
      tierId,
      maxPlayers: 2,
      seats: [
        { seat: 0, deviceId: 'dev-free-1-aaaaaaaa' },
        { seat: 1, deviceId: 'dev-free-2-bbbbbbbb' },
      ],
    });

    expect(started.usedFreeFallback).toBe(true);
    expect(started.entryFee).toBe(0);
    expect(started.pot).toBe(0);
    // Nobody paid anything — the rich seat's debit rolled back with the tx.
    expect((await services.wallet.getBalances(rich)).coins).toBe(5000);
    expect((await services.wallet.getBalances(broke)).coins).toBe(100);
  });

  it('persistAndReward: full 2P settle — pot, XP, stats, missions, leaderboard, first-win mail', async () => {
    const services = build();
    const tierId = await beginnerTierId();
    const winner = await createUser(5000, 'dev-full-1-aaaaaaaa');
    const loser = await createUser(5000, 'dev-full-2-bbbbbbbb');

    const started = await services.matches.startMatch({
      mode: 'classic',
      type: 'quick',
      tierId,
      maxPlayers: 2,
      seats: [
        { seat: 0, deviceId: 'dev-full-1-aaaaaaaa' },
        { seat: 1, deviceId: 'dev-full-2-bbbbbbbb' },
      ],
    });

    const lines = await services.matches.persistAndReward({
      matchId: started.matchId,
      entryFee: started.entryFee,
      pot: started.pot,
      tierId: started.tierId,
      numPlayers: 2,
      seats: [
        outcome({ seat: 0, place: 1, userId: winner, captures: 3, sixes: 5 }),
        outcome({ seat: 1, place: 2, userId: loser, captures: 1, sixes: 2 }),
      ],
      rngRolls: 42,
      seedHash: 'a'.repeat(64),
    });

    // Reward lines: winner nets 1.8×500 − 500 = +400; loser −500.
    expect(lines).toEqual([
      { seat: 0, coinsDelta: 400, xpEarned: 100 },
      { seat: 1, coinsDelta: -500, xpEarned: 60 },
    ]);

    // Wallets: winner 4500 + 900 prize + 200 level-2 reward (100 XP levels up).
    expect((await services.wallet.getBalances(winner)).coins).toBe(5600);
    expect((await services.wallet.getBalances(loser)).coins).toBe(4500);

    // Match row closed with winner + audit fields.
    const match = (await suite.db().select().from(lrMatches).where(eq(lrMatches.id, started.matchId)))[0]!;
    expect(match.state).toBe('finished');
    expect(match.winnerUserId).toBe(winner);
    expect(match.rngRolls).toBe(42);
    expect(match.endedAt).not.toBeNull();

    // lr_match_players persisted with counters and net deltas.
    const players = await suite.db()
      .select()
      .from(lrMatchPlayers)
      .where(eq(lrMatchPlayers.matchId, started.matchId));
    expect(players).toHaveLength(2);
    const p0 = players.find((p) => p.seat === 0)!;
    expect(p0.place).toBe(1);
    expect(p0.captures).toBe(3);
    expect(p0.sixes).toBe(5);
    expect(p0.coinsDelta).toBe(400);
    expect(p0.xpEarned).toBe(100);

    // Profile stats + streaks.
    const users = await suite.db().select().from(lrUsers).where(eq(lrUsers.id, winner));
    expect(users[0]!.gamesPlayed).toBe(1);
    expect(users[0]!.gamesWon).toBe(1);
    expect(users[0]!.winStreak).toBe(1);
    expect(users[0]!.level).toBe(2);
    const loserRow = (await suite.db().select().from(lrUsers).where(eq(lrUsers.id, loser)))[0]!;
    expect(loserRow.gamesWon).toBe(0);
    expect(loserRow.winStreak).toBe(0);

    // Missions progressed from the match events.
    const winnerMissions = await services.missions.getMissions(winner);
    expect(winnerMissions.find((m) => m.code === 'daily_play_3')!.progress).toBe(1);
    expect(winnerMissions.find((m) => m.code === 'daily_win_1')!.completed).toBe(true);
    expect(winnerMissions.find((m) => m.code === 'daily_capture_5')!.progress).toBe(3);
    expect(winnerMissions.find((m) => m.code === 'daily_sixes_10')!.progress).toBe(5);

    // Leaderboard: +30 trophies for the winner, both periods.
    const board = await services.leaderboard.getView('weekly', winner);
    expect(board.me).toEqual({ rank: 1, score: 30 });

    // First win of the day → system mail with the 250-coin attachment.
    const inbox = await services.mail.getInbox(winner);
    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]!.attachmentAmount).toBe(250);
  });

  it('IDEMPOTENT: settling the same matchId twice pays NOTHING the second time', async () => {
    const services = build();
    const tierId = await beginnerTierId();
    const winner = await createUser(5000, 'dev-idem-1-aaaaaaaa');
    const loser = await createUser(5000, 'dev-idem-2-bbbbbbbb');

    const started = await services.matches.startMatch({
      mode: 'classic',
      type: 'quick',
      tierId,
      maxPlayers: 2,
      seats: [
        { seat: 0, deviceId: 'dev-idem-1-aaaaaaaa' },
        { seat: 1, deviceId: 'dev-idem-2-bbbbbbbb' },
      ],
    });
    const settle = () =>
      services.matches.persistAndReward({
        matchId: started.matchId,
        entryFee: started.entryFee,
        pot: started.pot,
        tierId: started.tierId,
        numPlayers: 2,
        seats: [
          outcome({ seat: 0, place: 1, userId: winner }),
          outcome({ seat: 1, place: 2, userId: loser }),
        ],
      });

    const first = await settle();
    expect(first).not.toBeNull();
    const balanceAfterFirst = (await services.wallet.getBalances(winner)).coins;
    const ledgerCount = (
      await suite.db()
        .select()
        .from(lrWalletTransactions)
        .where(eq(lrWalletTransactions.userId, winner))
    ).length;

    const second = await settle();
    expect(second).toBeNull(); // already settled — signalled, not re-paid

    expect((await services.wallet.getBalances(winner)).coins).toBe(balanceAfterFirst);
    const ledgerCountAfter = (
      await suite.db()
        .select()
        .from(lrWalletTransactions)
        .where(eq(lrWalletTransactions.userId, winner))
    ).length;
    expect(ledgerCountAfter).toBe(ledgerCount);
    const players = await suite.db()
      .select()
      .from(lrMatchPlayers)
      .where(eq(lrMatchPlayers.matchId, started.matchId));
    expect(players).toHaveLength(2);
    // Stats were not double-counted either.
    const users = await suite.db().select().from(lrUsers).where(eq(lrUsers.id, winner));
    expect(users[0]!.gamesPlayed).toBe(1);
  });

  it('leftEarly seat: no prize, no XP, trophy penalty floored at 0, streak reset', async () => {
    const services = build();
    const tierId = await beginnerTierId();
    const winner = await createUser(5000, 'dev-left-1-aaaaaaaa');
    const quitter = await createUser(5000, 'dev-left-2-bbbbbbbb');

    const started = await services.matches.startMatch({
      mode: 'classic',
      type: 'quick',
      tierId,
      maxPlayers: 2,
      seats: [
        { seat: 0, deviceId: 'dev-left-1-aaaaaaaa' },
        { seat: 1, deviceId: 'dev-left-2-bbbbbbbb' },
      ],
    });
    const lines = await services.matches.persistAndReward({
      matchId: started.matchId,
      entryFee: started.entryFee,
      pot: started.pot,
      tierId: started.tierId,
      numPlayers: 2,
      seats: [
        outcome({ seat: 0, place: 1, userId: winner }),
        outcome({ seat: 1, place: 2, userId: quitter, leftEarly: true }),
      ],
    });

    const quitterLine = lines!.find((l) => l.seat === 1)!;
    expect(quitterLine.xpEarned).toBe(0);
    expect(quitterLine.coinsDelta).toBe(-500); // fee kept, no refund (§6.7)

    const board = await services.leaderboard.getView('weekly', quitter);
    expect(board.me).toEqual({ rank: 2, score: 0 }); // −10 floored at 0

    const row = (await suite.db().select().from(lrUsers).where(eq(lrUsers.id, quitter)))[0]!;
    expect(row.winStreak).toBe(0);
    expect(row.gamesPlayed).toBe(1);
  });

  it('bots and unresolved seats persist as rows but never touch wallets', async () => {
    const services = build();
    const human = await createUser(5000, 'dev-bot-1-aaaaaaaa');

    const started = await services.matches.startMatch({
      mode: 'classic',
      type: 'quick',
      tierId: null, // free table
      maxPlayers: 2,
      seats: [{ seat: 0, deviceId: 'dev-bot-1-aaaaaaaa' }, { seat: 1, isBot: true }],
    });
    expect(started.entryFee).toBe(0);

    const lines = await services.matches.persistAndReward({
      matchId: started.matchId,
      entryFee: 0,
      pot: 0,
      tierId: null,
      numPlayers: 2,
      seats: [
        outcome({ seat: 0, place: 2, userId: human }),
        outcome({ seat: 1, place: 1, isBot: true }),
      ],
    });
    expect(lines).toEqual([
      { seat: 0, coinsDelta: 0, xpEarned: 60 },
      { seat: 1, coinsDelta: 0, xpEarned: 0 },
    ]);

    const players = await suite.db()
      .select()
      .from(lrMatchPlayers)
      .where(eq(lrMatchPlayers.matchId, started.matchId));
    const bot = players.find((p) => p.seat === 1)!;
    expect(bot.isBot).toBe(true);
    expect(bot.userId).toBeNull();
    // A bot winner leaves winner_user_id NULL.
    const match = (await suite.db().select().from(lrMatches).where(eq(lrMatches.id, started.matchId)))[0]!;
    expect(match.winnerUserId).toBeNull();
  });
});
