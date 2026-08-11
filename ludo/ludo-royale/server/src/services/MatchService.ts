/**
 * MatchService — match persistence + real prizes (ARQUITECTURA §6.2/§7.3).
 *
 * Two calls frame every online match:
 *
 *   startMatch()        — at countdown→PLAYING. Resolves the roster's guest
 *                         deviceIds to lr_users rows, opens the lr_matches
 *                         row (state 'playing') and collects the tier entry
 *                         fee from every registered seat IN ONE TRANSACTION
 *                         (ledger 'match_entry', ref match/id). If ANY seat
 *                         cannot pay, the whole fee collection rolls back and
 *                         the match replays as FREE (fee 0, pot 0) — the
 *                         "tier free" fallback, so a broke player never
 *                         blocks a table that already counted down.
 *
 *   persistAndReward()  — at FINISHED. ONE transaction (§6.8.3): seats into
 *                         lr_match_players, match row closed, pot paid per
 *                         the tier prize_table (WalletService.creditIn,
 *                         'match_prize', ref match/id), XP by placement
 *                         (XpService.addXpIn, `match_xp_place` setting),
 *                         lr_users stats (games_played/games_won/win_streak),
 *                         mission events (MissionService.recordEventsIn),
 *                         leaderboard trophies (LeaderboardService.bumpIn)
 *                         and the first-win-of-the-day mail.
 *
 * IDEMPOTENCY: the FIRST statement of the settle transaction inserts the
 * lr_match_players rows — UNIQUE(match_id, seat) is the §7.2 origin-table
 * dedupe for the whole payout. A second call with the same matchId hits
 * ER_DUP_ENTRY, everything rolls back, and the method returns null: prizes
 * can never be paid twice.
 *
 * Crash recovery: a process death mid-match leaves lr_matches at 'playing';
 * the orphan-match watchdog (idx_state_started, §6.2) that refunds those
 * rows ships with the installer sprint (3c).
 */
import { and, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { lrMatches, lrMatchPlayers, lrRoomTiers, lrUsers } from '../db/schema.js';
import { isDuplicateKeyError } from './AuthService.js';
import { API_ERR, ApiError, isApiError } from './errors.js';
import type { LeaderboardService } from './LeaderboardService.js';
import type { MailService } from './MailService.js';
import type { MissionService } from './MissionService.js';
import { utcDayStart } from './period.js';
import type { SettingsService } from './SettingsService.js';
import type { WalletService } from './WalletService.js';
import type { XpService } from './XpService.js';

export interface MatchServiceDeps {
  wallet: WalletService;
  settings: SettingsService;
  xp: XpService;
  missions: MissionService;
  leaderboard: LeaderboardService;
  mail: MailService;
}

export interface StartSeatInput {
  seat: number;
  /** Guest identity from the room roster; resolved to lr_users here. */
  deviceId?: string;
  /** Direct user id (tests / future JWT identity) — wins over deviceId. */
  userId?: number;
  isBot?: boolean;
}

export interface StartMatchInput {
  mode: 'classic' | 'power' | 'minimap';
  type: 'quick' | 'private';
  tierId?: number | null;
  roomId?: string | null;
  privateCode?: string | null;
  maxPlayers: number;
  seats: StartSeatInput[];
}

export interface StartedMatch {
  matchId: number;
  /** Fee actually charged per paying seat (0 after the free fallback). */
  entryFee: number;
  pot: number;
  tierId: number | null;
  /** seat → lr_users.id for every seat that resolved to a registered user. */
  userBySeat: Map<number, number>;
  /** True when a seat could not pay and the match downgraded to free. */
  usedFreeFallback: boolean;
}

export interface SeatOutcome {
  seat: number;
  userId?: number;
  isBot: boolean;
  color: 'red' | 'blue' | 'yellow' | 'green';
  /** 1-based final placement. */
  place: number;
  /** Forfeited / abandoned (§6.7) — no prize, no XP, trophy penalty. */
  leftEarly: boolean;
  piecesHome: number;
  captures: number;
  sixes: number;
  disconnects: number;
}

export interface SettleInput {
  matchId: number;
  entryFee: number;
  pot: number;
  tierId: number | null;
  numPlayers: number;
  seats: SeatOutcome[];
  rngRolls?: number;
  seedHash?: string | null;
}

export interface RewardLine {
  seat: number;
  /** Net coins for the matchEnd broadcast: prize − entry fee. */
  coinsDelta: number;
  xpEarned: number;
}

export class MatchService {
  constructor(
    private readonly db: Db,
    private readonly deps: MatchServiceDeps,
  ) {}

  // ---------------------------------------------------------------------------
  // startMatch — open the row + collect entry fees (free fallback)
  // ---------------------------------------------------------------------------

  async startMatch(input: StartMatchInput, now: Date = new Date()): Promise<StartedMatch> {
    const userBySeat = await this.resolveSeats(input.seats);

    let tier: { id: number; entryFeeCoins: number } | null = null;
    if (input.tierId) {
      const tiers = await this.db
        .select({ id: lrRoomTiers.id, entryFeeCoins: lrRoomTiers.entryFeeCoins })
        .from(lrRoomTiers)
        .where(and(eq(lrRoomTiers.id, input.tierId), eq(lrRoomTiers.isActive, true)))
        .limit(1);
      tier = tiers[0] ?? null;
    }
    const fee = tier?.entryFeeCoins ?? 0;
    const payers = fee > 0 ? [...userBySeat.values()] : [];

    const open = (feeCharged: number): Promise<number> =>
      this.db.transaction(async (tx) => {
        const [header] = await tx.insert(lrMatches).values({
          mode: input.mode,
          type: input.type,
          tierId: tier?.id ?? input.tierId ?? null,
          roomId: input.roomId ?? null,
          privateCode: input.privateCode ?? null,
          maxPlayers: input.maxPlayers,
          entryFee: feeCharged,
          pot: feeCharged * payers.length,
          state: 'playing',
          startedAt: now,
          createdAt: now,
        });
        const matchId = header.insertId;
        if (feeCharged > 0) {
          for (const userId of payers) {
            await this.deps.wallet.debitIn(
              tx, userId, 'coins', feeCharged, 'match_entry', 'match', matchId,
            );
          }
        }
        return matchId;
      });

    let matchId: number;
    let entryFee = fee;
    let usedFreeFallback = false;
    try {
      matchId = await open(fee);
    } catch (err) {
      // "Tier free" fallback: any seat unable to pay (or a vanished user)
      // rolls back EVERY debit and the match replays without stakes.
      if (
        fee > 0 &&
        (isApiError(err, API_ERR.INSUFFICIENT_FUNDS) || isApiError(err, API_ERR.USER_NOT_FOUND))
      ) {
        entryFee = 0;
        usedFreeFallback = true;
        matchId = await open(0);
      } else {
        throw err;
      }
    }

    return {
      matchId,
      entryFee,
      pot: entryFee * payers.length,
      tierId: tier?.id ?? input.tierId ?? null,
      userBySeat,
      usedFreeFallback,
    };
  }

  // ---------------------------------------------------------------------------
  // persistAndReward — the FINISHED transaction
  // ---------------------------------------------------------------------------

  /**
   * Persist the finished match and grant every reward atomically.
   * Returns the per-seat reward lines, or null when this matchId was
   * already settled (idempotent re-entry — nothing is paid twice).
   */
  async persistAndReward(input: SettleInput, now: Date = new Date()): Promise<RewardLine[] | null> {
    const { wallet, settings, xp, missions, leaderboard, mail } = this.deps;

    // Config reads OUTSIDE the tx (cached; §10.1) — keeps the tx short.
    const xpTable = await settings.getJson<number[]>('match_xp_place', [100, 60, 40, 25]);
    const score = await leaderboard.scoreDeltas();
    const firstWinMailOn = await settings.getBool('first_win_mail_enabled', true);
    const firstWinCoins = await settings.getInt('first_win_mail_coins', 250);
    const prizeMultipliers = await this.prizeMultipliers(input);

    // Pure payout math first, so lr_match_players rows carry final numbers.
    const lines = input.seats.map((seat) => {
      const human = !seat.isBot && seat.userId !== undefined;
      const paidFee = human && input.entryFee > 0 ? input.entryFee : 0;
      const prize =
        human && !seat.leftEarly && input.pot > 0
          ? Math.round(input.entryFee * (prizeMultipliers[seat.place - 1] ?? 0))
          : 0;
      const xpEarned = human && !seat.leftEarly ? (xpTable[seat.place - 1] ?? 0) : 0;
      return { seat, prize, paidFee, xpEarned, coinsDelta: prize - paidFee };
    });

    try {
      return await this.db.transaction(async (tx) => {
        // 1) Settle dedupe — UNIQUE(match_id, seat) guards the whole payout.
        await tx.insert(lrMatchPlayers).values(
          lines.map(({ seat, xpEarned, coinsDelta }) => ({
            matchId: input.matchId,
            userId: seat.userId ?? null,
            seat: seat.seat,
            color: seat.color,
            isBot: seat.isBot,
            place: seat.place,
            piecesHome: seat.piecesHome,
            captures: seat.captures,
            sixes: seat.sixes,
            coinsDelta,
            xpEarned,
            leftEarly: seat.leftEarly,
            disconnects: seat.disconnects,
          })),
        );

        // 2) Close the match row.
        const matchRows = await tx
          .select({ startedAt: lrMatches.startedAt })
          .from(lrMatches)
          .where(eq(lrMatches.id, input.matchId))
          .limit(1);
        if (!matchRows[0]) {
          throw new ApiError(500, API_ERR.INTERNAL, `match ${input.matchId} row is missing`);
        }
        const startedAt = matchRows[0].startedAt ?? now;
        const winner = input.seats.find((s) => s.place === 1);
        const [closed] = await tx
          .update(lrMatches)
          .set({
            state: 'finished',
            winnerUserId: winner && !winner.isBot ? winner.userId ?? null : null,
            endedAt: now,
            durationS: Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)),
            rngRolls: input.rngRolls ?? 0,
            seedHash: input.seedHash ?? null,
          })
          .where(and(eq(lrMatches.id, input.matchId), eq(lrMatches.state, 'playing')));
        if (closed.affectedRows === 0) {
          throw new ApiError(500, API_ERR.INTERNAL, `match ${input.matchId} is not open`);
        }

        // 3) Per-human rewards + stats + missions + trophies.
        for (const line of lines) {
          const { seat } = line;
          if (seat.isBot || seat.userId === undefined) continue;
          const userId = seat.userId;

          if (line.prize > 0) {
            await wallet.creditIn(
              tx, userId, 'coins', line.prize, 'match_prize', 'match', input.matchId,
            );
          }
          if (line.xpEarned > 0) {
            await xp.addXpIn(tx, userId, line.xpEarned);
          }

          const won = seat.place === 1;
          await tx
            .update(lrUsers)
            .set({
              gamesPlayed: sql`games_played + 1`,
              ...(won
                ? { gamesWon: sql`games_won + 1`, winStreak: sql`win_streak + 1` }
                : { winStreak: 0 }),
              updatedAt: now,
            })
            .where(eq(lrUsers.id, userId));

          await missions.recordEventsIn(
            tx,
            userId,
            {
              play_matches: 1,
              win_matches: won ? 1 : 0,
              capture_pieces: seat.captures,
              roll_sixes: seat.sixes,
              pieces_home: seat.piecesHome,
            },
            undefined,
            now,
          );

          let trophies = 0;
          if (won) trophies += score.win;
          else if (seat.place === 2 && input.numPlayers >= 3) trophies += score.second;
          if (!won && seat.leftEarly) trophies += score.leave;
          await leaderboard.bumpIn(tx, userId, trophies, now);
        }

        // 4) First win of the day → system mail with a coin attachment.
        if (firstWinMailOn && winner && !winner.isBot && winner.userId !== undefined) {
          const earlier = await tx
            .select({ id: lrMatchPlayers.id })
            .from(lrMatchPlayers)
            .innerJoin(lrMatches, eq(lrMatchPlayers.matchId, lrMatches.id))
            .where(
              and(
                eq(lrMatchPlayers.userId, winner.userId),
                eq(lrMatchPlayers.place, 1),
                ne(lrMatches.id, input.matchId),
                eq(lrMatches.state, 'finished'),
                gte(lrMatches.endedAt, utcDayStart(now)),
              ),
            )
            .limit(1);
          if (earlier.length === 0 && firstWinCoins > 0) {
            await mail.sendSystemMailIn(
              tx, winner.userId, 'first_win',
              { type: 'coins', amount: firstWinCoins }, now,
            );
          }
        }

        return lines.map(({ seat, coinsDelta, xpEarned }) => ({
          seat: seat.seat,
          coinsDelta,
          xpEarned,
        }));
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) return null; // already settled — never re-pay
      throw err;
    }
  }

  // ---------------------------------------------------------------------------

  /** Map roster deviceIds/userIds to active lr_users rows (seat → id). */
  private async resolveSeats(seats: StartSeatInput[]): Promise<Map<number, number>> {
    const userBySeat = new Map<number, number>();
    const deviceIds: string[] = [];
    for (const seat of seats) {
      if (seat.isBot) continue;
      if (seat.userId !== undefined) userBySeat.set(seat.seat, seat.userId);
      else if (seat.deviceId) deviceIds.push(seat.deviceId);
    }
    if (deviceIds.length > 0) {
      const rows = await this.db
        .select({ id: lrUsers.id, deviceId: lrUsers.deviceId })
        .from(lrUsers)
        .where(and(inArray(lrUsers.deviceId, deviceIds), eq(lrUsers.status, 'active')));
      // First (lowest id) row wins on the off chance a deviceId is shared.
      const byDevice = new Map<string, number>();
      for (const row of rows.sort((a, b) => a.id - b.id)) {
        if (row.deviceId && !byDevice.has(row.deviceId)) byDevice.set(row.deviceId, row.id);
      }
      for (const seat of seats) {
        if (!seat.isBot && seat.userId === undefined && seat.deviceId) {
          const id = byDevice.get(seat.deviceId);
          if (id !== undefined) userBySeat.set(seat.seat, id);
        }
      }
    }
    return userBySeat;
  }

  /** Payout multipliers for this player count, from the tier prize_table. */
  private async prizeMultipliers(input: SettleInput): Promise<number[]> {
    if (input.pot <= 0 || !input.tierId) return [];
    const tiers = await this.db
      .select({ prizeTable: lrRoomTiers.prizeTable })
      .from(lrRoomTiers)
      .where(eq(lrRoomTiers.id, input.tierId))
      .limit(1);
    // MariaDB stores JSON as LONGTEXT, so mysql2 hands the column back as a
    // raw STRING (MySQL 8 parses it). Without this normalization, indexing
    // the string with '2' returns the CHARACTER '2' and 500 × '2' silently
    // becomes a 2× payout — normalize before touching the table.
    const raw: unknown = tiers[0]?.prizeTable;
    const table =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, number[]>)
        : (raw as Record<string, number[]> | undefined);
    const multipliers = table?.[String(input.numPlayers)] ?? [];
    return multipliers.map((m) => Number(m));
  }
}
