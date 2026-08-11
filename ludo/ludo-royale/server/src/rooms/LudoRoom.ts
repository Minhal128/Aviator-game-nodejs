/**
 * LudoRoom — the authoritative match room (ARQUITECTURA §6).
 *
 * One class, two matchmaking doors (registered in app.config.ts):
 *   · 'quick'   — joinOrCreate grouped by size via filterBy (§6.3)
 *   · 'private' — explicit create; the 6-char code IS the roomId (§6.1)
 *
 * The @ludo/shared reducer is the ONLY source of rules: every client intent
 * becomes a GameAction, every engine event becomes a §6.5 protocol message.
 * Dice come exclusively from crypto.randomInt injected through `rollDie`
 * (§5.5) — tests overwrite that property to script exact sequences.
 *
 * Sprint 2 runs on guest identity ({deviceId, name} join options); Sprint 3b
 * resolves those deviceIds to lr_users through the shared MatchService.
 *
 * PERSISTENCE + PRIZES (Sprint 3b): when the shared GameServices container is
 * available (game.entry.ts inits it from DATABASE_URL; tests may inject one
 * via setGameServices/room.services), the room opens the lr_matches row and
 * collects the tier entry fee at countdown→PLAYING, and settles everything
 * (players, prizes, XP, missions, leaderboard, first-win mail) in ONE
 * transaction at FINISHED via MatchService.persistAndReward(). Without a
 * container the room behaves exactly like Sprint 2: prizes 0, nothing
 * persisted. A DB failure NEVER kills the table — matchEnd goes out with
 * zeros and `rewardsPending: true`.
 */
import { createHash, randomInt } from 'node:crypto';
import { Room, ServerError } from 'colyseus';
import type { Client } from 'colyseus';
import {
  applyAction,
  BATTLE_POWERS,
  chooseMove,
  createGame,
  ERR,
  IllegalActionError,
  PROTOCOL_VERSION,
} from '@ludo/shared';
import type {
  ApplyResult,
  DiceMessage,
  EmoteShownMessage,
  ErrCode,
  ErrMessage,
  GameAction,
  GameEvent,
  GameState,
  MatchEndMessage,
  MoveResultMessage,
  PlayerStatusMessage,
  PowerType,
  PowerUsedMessage,
  Seat,
  TokenCollectedMessage,
  TokenSpawnedMessage,
  TrapTriggeredMessage,
  TurnMessage,
  TurnSkippedMessage,
} from '@ludo/shared';
import { ChargesSchema, FrozenSchema, LudoRoomState, PieceSchema, PlayerSchema, ShieldSchema, TokenSchema, TrapSchema } from './schema.js';
import { claimRoomCode, releaseRoomCode } from './roomCode.js';
import {
  allowEmote,
  allowMessage,
  MAX_ILLEGAL_ACTIONS,
  newMeta,
  readDeviceId,
  readEmoteId,
  readPieceId,
  readSeat,
  readSize,
  readTierId,
  sanitizeName,
} from './guards.js';
import type { ClientMeta } from './guards.js';
import { getGameServices, type GameServices } from '../services/gameServices.js';
import type {
  RewardLine,
  SeatOutcome,
  SettleInput,
  StartedMatch,
} from '../services/MatchService.js';
import { log } from '../logger.js';

/** Guest identity resolved by onAuth (Sprint 2 — JWT claims in Sprint 3). */
interface JoinAuth {
  deviceId: string;
  name: string;
}

/**
 * Server-side knobs. Instance-mutable so the test suite can shrink every
 * timer after createRoom() — no env-gated backdoors reachable by clients.
 */
export interface RoomTuning {
  /** §5.4 — 30s per decision (Sprint-2 contract; a lr_settings key later). */
  turnTimerS: number;
  /** §6.2 — room full → countdown → playing. */
  countdownS: number;
  /** §6.6 — reconnection grace window. */
  graceS: number;
  /** Server "thinking" delay before an AUTO seat rolls / moves. */
  autoRollDelayMs: number;
  autoMoveDelayMs: number;
  /** §6.2 — broadcast matchEnd → room.disconnect() afterwards. */
  disposeAfterEndMs: number;
  /** §5.4 — consecutive timeouts before the seat flips to AUTO. */
  maxStrikes: number;
}

const DEFAULT_TUNING: Readonly<RoomTuning> = {
  turnTimerS: 30,
  countdownS: 3,
  graceS: 60,
  autoRollDelayMs: 900,
  autoMoveDelayMs: 650,
  disposeAfterEndMs: 20000,
  maxStrikes: 2,
};

/** Presence set that blocks one guest device from two live quick rooms (§6.8.5). */
const QUICK_DEVICE_CHANNEL = 'lr:quick:devices';
/** Custom close code for anti-cheat / host kicks (4000-4010 are Colyseus'). */
const KICK_CLOSE_CODE = 4100;
/**
 * §6.8.2 fairness window: when the SERVER just played a seat's decision
 * (turn-timer TIMEOUT or an AUTO/disconnected seat), an in-flight action
 * from that seat's client is a lost RACE against the timer, not cheating.
 * Punishing those lets an ordinary laggy connection collect 5 strikes from
 * timeouts alone and get anticheat-kicked mid-match. Within this window the
 * rejection is still answered with `err`, but NOT counted toward the kick.
 */
const TIMER_RACE_GRACE_MS = 2000;

interface RosterEntry {
  sessionId: string;
  deviceId: string;
  name: string;
}

export class LudoRoom extends Room<{ state: LudoRoomState }> {
  state = new LudoRoomState();
  maxClients = 4;

  tuning: RoomTuning = { ...DEFAULT_TUNING };
  /** Injected CSPRNG die (§5.5). Tests replace it with scripted sequences. */
  rollDie: () => number = () => randomInt(1, 7);
  /**
   * Shared persistence container (Sprint 3b). Defaults to the process-level
   * singleton in onCreate; DB tests overwrite it right after createRoom().
   * null = play like Sprint 2 (no persistence, prizes 0).
   */
  services: GameServices | null = null;

  private match: GameState | null = null;
  private roster: RosterEntry[] = [];
  private readonly seatBySession = new Map<string, Seat>();
  private readonly disconnectedSeats = new Set<Seat>();
  private readonly autoSeats = new Set<Seat>();
  /** Bumped on every (re)schedule so stale clock callbacks self-cancel. */
  private turnEpoch = 0;
  private isPrivateRoom = false;
  /** lr_room_tiers.id from the join options (null = free table). */
  private tierId: number | null = null;
  // POWER shop model: loadouts prefetched during the countdown, keyed by
  // deviceId (the roster identity), + the resolved userId for consumption.
  private readonly powerLoadouts = new Map<string, Partial<Record<PowerType, number>>>();
  private readonly powerUserIds = new Map<string, number>();
  private loadoutsPromise: Promise<void> | null = null;
  private startingMatch = false;

  /** Open lr_matches record + fee/pot from MatchService.startMatch(). */
  private startedMatch: StartedMatch | null = null;
  private startPromise: Promise<void> | null = null;
  /** Per-seat counters for lr_match_players (captures/sixes/disconnects). */
  private readonly seatStats = new Map<number, { captures: number; sixes: number }>();
  private readonly seatDisconnects = new Map<number, number>();
  /** Last time the SERVER played each seat's decision (timer-race excuse). */
  private readonly serverActedAt = new Map<Seat, number>();

  /** Uniform [0,1) from the CSPRNG — feeds the Easy heuristic (§5.6). */
  private readonly rand01 = (): number => randomInt(0, 1 << 30) / (1 << 30);

  /** Read-only engine state for tests and the (Sprint 3) monitor endpoint. */
  get matchState(): GameState | null {
    return this.match;
  }

  // -------------------------------------------------------------------------
  // Lifecycle (§6.2)
  // -------------------------------------------------------------------------

  async onCreate(options: Record<string, unknown>): Promise<void> {
    this.isPrivateRoom = this.roomName === 'private';
    const size = readSize(options['size']) ?? (this.isPrivateRoom ? 4 : null);
    if (size === null) throw new ServerError(400, 'invalid room size');
    this.services = getGameServices();
    // Quick rooms are also grouped by tierId (filterBy in app.config.ts) so
    // Beginner and Gold queues never mix. Private tables default to free.
    this.tierId = readTierId(options['tierId']);
    this.maxClients = size;
    this.state.size = size;
    this.state.mode = this.isPrivateRoom ? 'private' : 'quick';
    this.state.turnTimerS = this.tuning.turnTimerS;
    // POWER rooms: quick queues are also split by powerMode (filterBy).
    this.state.powerMode = options['powerMode'] === true;

    if (this.isPrivateRoom) {
      // The join code IS the roomId → clients join with joinById(code).
      this.roomId = await claimRoomCode(this.presence);
      this.state.privateCode = this.roomId;
      await this.setMatchmaking({ private: true });
    }

    this.registerMessages();
    log.info('room created', { roomId: this.roomId, mode: this.state.mode, size });
  }

  async onAuth(_client: Client, options: Record<string, unknown>): Promise<JoinAuth> {
    if (options['protocolVersion'] !== PROTOCOL_VERSION) {
      throw new ServerError(400, 'protocol version mismatch — please update the game');
    }
    // Rooms only admit players in LOBBY; late joinById on a running private
    // room reads as "full" to the caller (§6.5 ERR_ROOM_FULL).
    if (this.state.phase !== 'lobby') throw new ServerError(423, ERR.ROOM_FULL);

    const deviceId = readDeviceId(options['deviceId']);
    if (!deviceId) throw new ServerError(400, 'missing device identity');
    if (this.roster.some((entry) => entry.deviceId === deviceId)) {
      throw new ServerError(409, ERR.ALREADY_IN_MATCH);
    }
    if (!this.isPrivateRoom) {
      const inQuick = await this.presence.sismember(QUICK_DEVICE_CHANNEL, deviceId);
      if (inQuick) throw new ServerError(409, ERR.ALREADY_IN_MATCH);
    }
    const name = sanitizeName(options['name']) || `Player ${this.roster.length + 1}`;
    return { deviceId, name };
  }

  onJoin(client: Client, _options: Record<string, unknown>, auth: JoinAuth): void {
    client.userData = newMeta(auth.deviceId);
    const seat = this.roster.length as Seat;
    this.roster.push({ sessionId: client.sessionId, deviceId: auth.deviceId, name: auth.name });
    this.seatBySession.set(client.sessionId, seat);
    if (!this.isPrivateRoom) void this.presence.sadd(QUICK_DEVICE_CHANNEL, auth.deviceId);
    if (this.state.hostSessionId === '') this.state.hostSessionId = client.sessionId;

    const player = new PlayerSchema();
    player.seat = seat;
    player.name = auth.name;
    this.state.players.set(client.sessionId, player);

    log.info('player joined', { roomId: this.roomId, seat, name: auth.name });
    // §6.2: join = ready. Full room → 3s countdown → PLAYING.
    if (this.clients.length === this.maxClients) this.beginCountdown();
  }

  /** Unexpected socket loss — §6.6: 60s grace, AUTO plays meanwhile. */
  async onDrop(client: Client, _code?: number): Promise<void> {
    if (!this.match || this.match.phase !== 'playing') {
      // No grace in LOBBY (§6.6): free the seat immediately.
      this.removeFromLobby(client);
      return;
    }
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return;
    this.disconnectedSeats.add(seat);
    this.seatDisconnects.set(seat, (this.seatDisconnects.get(seat) ?? 0) + 1);
    this.broadcastStatus(seat, false, true);
    this.syncSchema();
    // Never stall the table: if it was their turn, AUTO takes over now.
    if (this.match.currentSeat === seat) this.scheduleTurn();
    try {
      await this.allowReconnection(client, this.tuning.graceS);
    } catch {
      // Grace expired or was rejected → onLeave runs the forfeit (§6.7).
    }
  }

  onReconnect(client: Client): void {
    // Identity note (§6.6): the reconnectionToken is bound to the original
    // session, which was admitted with this deviceId in onAuth — a foreign
    // device cannot replay the seat without stealing the token itself.
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return;
    this.disconnectedSeats.delete(seat);
    this.autoSeats.delete(seat);
    const match = this.match;
    if (match) {
      const player = match.players[seat];
      if (player) player.timeoutStrikes = 0; // §6.6: back to manual, clean slate
    }
    this.broadcastStatus(seat, true, false);
    this.syncSchema();
    if (match && match.phase === 'playing') {
      // Restore the client's timer/banner without waiting for the next turn.
      client.send('turn', {
        seat: match.currentSeat,
        deadline: match.turnDeadline,
        phase: match.turnPhase === 'wait_roll' ? 'roll' : 'move',
      } satisfies TurnMessage);
      this.scheduleTurn();
    }
    log.info('player reconnected', { roomId: this.roomId, seat });
  }

  /** Consented leave, kick, or expired reconnection grace. */
  onLeave(client: Client, _code?: number): void {
    const match = this.match;
    if (!match || match.phase !== 'playing') {
      this.removeFromLobby(client);
      return;
    }
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return;
    this.disconnectedSeats.delete(seat);
    this.autoSeats.delete(seat);
    const meta = client.userData as ClientMeta | undefined;
    if (meta && !this.isPrivateRoom) void this.presence.srem(QUICK_DEVICE_CHANNEL, meta.deviceId);

    const player = match.players[seat];
    if (player && player.place === 0 && !player.forfeited) {
      // §6.7: abandoning a live match is a forfeit; no refunds (Sprint 3).
      this.applyEngine({ type: 'FORFEIT', seat, now: Date.now() });
    }
    this.broadcastStatus(seat, false, false);
    this.syncSchema();
    log.info('player left', { roomId: this.roomId, seat });
  }

  async onDispose(): Promise<void> {
    if (this.isPrivateRoom && this.state.privateCode !== '') {
      await releaseRoomCode(this.presence, this.state.privateCode);
    } else {
      for (const entry of this.roster) {
        void this.presence.srem(QUICK_DEVICE_CHANNEL, entry.deviceId);
      }
    }
    log.info('room disposed', { roomId: this.roomId });
  }

  // -------------------------------------------------------------------------
  // Client intents (§6.5 C→S). The client NEVER sends dice values, positions
  // or results — only intentions, validated here against the engine (§6.8).
  // -------------------------------------------------------------------------

  private registerMessages(): void {
    this.onMessage('roll', (client: Client) => this.handleRoll(client));
    this.onMessage('move', (client: Client, payload: unknown) => this.handleMove(client, payload));
    this.onMessage('emote', (client: Client, payload: unknown) => this.handleEmote(client, payload));
    this.onMessage('forfeit', (client: Client) => this.handleForfeit(client));
    this.onMessage('startMatch', (client: Client) => this.handleStartMatch(client));
    this.onMessage('kickPlayer', (client: Client, payload: unknown) =>
      this.handleKickPlayer(client, payload),
    );
    this.onMessage('usePower', (client: Client, payload: unknown) =>
      this.handleUsePower(client, payload),
    );
  }

  private handleUsePower(client: Client, payload: unknown): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    const { seat, meta } = ctx;
    const parsed = readUsePower(payload);
    if (!parsed) {
      this.punish(client, meta, ERR.ILLEGAL_MOVE, 'malformed usePower payload');
      return;
    }
    const wasAuto = this.exitAutoIfManual(seat);
    const applied = this.applyEngine(
      {
        type: 'USE_POWER',
        seat,
        power: parsed.power,
        face: parsed.face,
        pieceId: parsed.pieceId,
        targetSeat: parsed.targetSeat,
        cell: parsed.cell,
        now: Date.now(),
      },
      (err) => {
        if (wasAuto || this.isTimerRace(seat)) this.sendErr(client, err.code, err.message);
        else this.punish(client, meta, err.code, err.message);
      },
    );
    // Only BATTLE powers burn an owned unit (classic charges come from the
    // board drops). Fire-and-forget — DB latency never blocks the turn; the
    // atomic qty>0 guard prevents dupes.
    if (applied && BATTLE_POWERS.has(parsed.power)) {
      this.consumePowerItem(seat, parsed.power);
    }
  }

  /** POWER shop model: prefetch owned loadouts for every seated device. */
  private async prefetchPowerLoadouts(): Promise<void> {
    const services = this.services;
    if (!services) return;
    try {
      const found = await services.inventory.getPowerLoadoutsByDevice(
        this.roster.map((entry) => entry.deviceId),
      );
      for (const [deviceId, entry] of found) {
        this.powerLoadouts.set(deviceId, entry.loadout);
        this.powerUserIds.set(deviceId, entry.userId);
      }
    } catch (err) {
      log.warn('power loadout prefetch failed', {
        roomId: this.roomId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Burn one owned power unit after a successful USE_POWER. */
  private consumePowerItem(seat: Seat, power: PowerType): void {
    const services = this.services;
    if (!services) return;
    const entry = this.roster[seat];
    const userId = entry ? this.powerUserIds.get(entry.deviceId) : undefined;
    if (userId === undefined) return;
    void services.inventory.consumePower(userId, power).catch((err: unknown) => {
      log.warn('power consume failed', {
        roomId: this.roomId,
        power,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private handleRoll(client: Client): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    const { seat, meta } = ctx;
    const wasAuto = this.exitAutoIfManual(seat);
    this.applyEngine({ type: 'ROLL', seat, dice: this.rollDie(), dice2: this.secondDie(), now: Date.now() }, (err) => {
      // A player racing the AUTO scheduler / turn timer is recovering, not
      // cheating (see TIMER_RACE_GRACE_MS).
      if (wasAuto || this.isTimerRace(seat)) this.sendErr(client, err.code, err.message);
      else this.punish(client, meta, err.code, err.message);
    });
  }

  private handleMove(client: Client, payload: unknown): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    const { seat, meta } = ctx;
    const pieceId = readPieceId(payload);
    if (pieceId === null) {
      this.punish(client, meta, ERR.ILLEGAL_MOVE, 'malformed move payload');
      return;
    }
    const wasAuto = this.exitAutoIfManual(seat);
    this.applyEngine({ type: 'MOVE', seat, pieceId, now: Date.now() }, (err) => {
      if (wasAuto || this.isTimerRace(seat)) this.sendErr(client, err.code, err.message);
      else this.punish(client, meta, err.code, err.message);
    });
  }

  private handleEmote(client: Client, payload: unknown): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    const { seat, meta } = ctx;
    const emoteId = readEmoteId(payload);
    if (emoteId === null) {
      this.punish(client, meta, ERR.ILLEGAL_MOVE, 'malformed emote payload');
      return;
    }
    if (!allowEmote(meta, Date.now())) {
      this.sendErr(client, ERR.RATE_LIMIT, 'one emote every 4 seconds');
      return;
    }
    this.broadcast('emoteShown', { seat, emoteId } satisfies EmoteShownMessage);
  }

  private handleForfeit(client: Client): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    // Explicit surrender (§6.7): seat retires, places cascade from the bottom.
    this.applyEngine({ type: 'FORFEIT', seat: ctx.seat, now: Date.now() }, (err) =>
      this.sendErr(client, err.code, err.message),
    );
  }

  /** PrivateRoom host starts with 2+ seated (§6.1). */
  private handleStartMatch(client: Client): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    if (!this.isPrivateRoom || this.state.phase !== 'lobby') {
      this.sendErr(client, ERR.BAD_PHASE, 'match cannot start now');
      return;
    }
    if (client.sessionId !== this.state.hostSessionId) {
      this.sendErr(client, ERR.BAD_PHASE, 'only the host can start');
      return;
    }
    if (this.roster.length < 2) {
      this.sendErr(client, ERR.BAD_PHASE, 'need at least 2 players');
      return;
    }
    this.beginCountdown();
  }

  /** PrivateRoom host kicks a seat, LOBBY only (§6.1/§6.5). */
  private handleKickPlayer(client: Client, payload: unknown): void {
    const ctx = this.gate(client);
    if (!ctx) return;
    if (
      !this.isPrivateRoom ||
      this.state.phase !== 'lobby' ||
      client.sessionId !== this.state.hostSessionId
    ) {
      this.sendErr(client, ERR.BAD_PHASE, 'kick is host-only, lobby-only');
      return;
    }
    const seat = readSeat(payload);
    if (seat === null) {
      this.punish(client, ctx.meta, ERR.ILLEGAL_MOVE, 'malformed kick payload');
      return;
    }
    const target = this.roster[seat];
    if (!target || target.sessionId === client.sessionId) {
      this.sendErr(client, ERR.BAD_PHASE, 'no such player');
      return;
    }
    this.clients.getById(target.sessionId)?.leave(KICK_CLOSE_CODE);
  }

  // -------------------------------------------------------------------------
  // Match flow
  // -------------------------------------------------------------------------

  /*
   * Bot backfill (§6.3) — documented Sprint-3 stub. [DECISIÓN ARQ]: if a
   * quick room is still short after `matchmaking_bot_after_s` (lr_settings,
   * default 25s, 0 = off), the remaining seats are filled with Medium bots
   * (`is_bot=1` in lr_match_players, names from the bot_names pool). NOT in
   * Sprint 2: it needs the settings cache + persisted bot identities. Hook
   * points when it lands: schedule in onJoin, seat the bots in startPlaying
   * as roster entries with an empty sessionId.
   */
  private beginCountdown(): void {
    if (this.state.phase !== 'lobby') return;
    this.state.phase = 'countdown';
    this.state.countdownEnds = Date.now() + this.tuning.countdownS * 1000;
    this.lock();
    // POWER shop model: pull every device's owned powers while the countdown
    // runs — startPlaying seeds the match charges from this (§7.5).
    if (this.state.powerMode && this.services) {
      this.loadoutsPromise = this.prefetchPowerLoadouts();
    }
    this.clock.setTimeout(() => void this.startPlaying(), this.tuning.countdownS * 1000);
  }

  private cancelCountdown(): void {
    this.state.phase = 'lobby';
    this.state.countdownEnds = 0;
    this.unlock();
  }

  private async startPlaying(): Promise<void> {
    if (this.state.phase !== 'countdown' || this.startingMatch) return;
    this.startingMatch = true;
    // The loadout prefetch races a short cap: a slow DB must not hold the
    // promised table hostage (worst case: seats start without charges).
    if (this.loadoutsPromise) {
      await Promise.race([
        this.loadoutsPromise,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
    if ((this.state.phase as string) !== 'countdown') {
      this.startingMatch = false;
      return; // cancelled by a lobby leave while we awaited
    }
    const seated = this.roster.length;
    if (seated < 2) {
      this.startingMatch = false;
      this.cancelCountdown();
      return;
    }
    const numPlayers = (seated > 4 ? 4 : seated) as 2 | 3 | 4;
    // Compact seats in join order — lobby churn may have left gaps.
    this.roster.forEach((entry, i) => this.seatBySession.set(entry.sessionId, i as Seat));
    this.disconnectedSeats.clear();
    this.autoSeats.clear();

    // POWER hybrid economy (Jose): the classic four keep DROPPING on the
    // board for everyone; only the BATTLE set is seeded from each player's
    // shop inventory (the loadout prefetch already filters to battle skus).
    this.match = createGame({
      numPlayers,
      turnTimerS: this.tuning.turnTimerS,
      powerMode: this.state.powerMode,
      initialCharges:
        this.state.powerMode && this.services !== null
          ? this.roster.map((entry) => this.powerLoadouts.get(entry.deviceId))
          : undefined,
    });
    this.seatStats.clear();
    this.seatDisconnects.clear();
    this.serverActedAt.clear();
    this.startedMatch = null;
    // Open the lr_matches row + collect entry fees in the background — the
    // countdown already promised these players a table, so DB latency (or a
    // DB outage) must never hold the first roll hostage. finishMatch awaits
    // this promise before settling.
    this.startPromise = this.openMatchRecord(numPlayers);
    this.state.turnTimerS = this.tuning.turnTimerS;
    this.state.numPlayers = numPlayers;
    this.state.countdownEnds = 0;
    // Piece rows are created once; only `steps` mutates afterwards (§6.4).
    this.state.pieces.clear();
    for (const piece of this.match.pieces) {
      const row = new PieceSchema();
      row.seat = piece.seat;
      row.pieceId = piece.pieceId;
      row.steps = piece.steps;
      this.state.pieces.push(row);
    }
    this.applyEngine({ type: 'START', now: Date.now() });
    log.info('match started', { roomId: this.roomId, numPlayers });
  }

  /**
   * The single funnel into the reducer: apply, translate events to §6.5
   * messages, mirror the schema, reschedule the turn timer.
   */
  private applyEngine(action: GameAction, onIllegal?: (err: IllegalActionError) => void): boolean {
    const match = this.match;
    if (!match) {
      onIllegal?.(new IllegalActionError(ERR.BAD_PHASE, 'match is not running'));
      return false;
    }
    let result: ApplyResult;
    try {
      result = applyAction(match, action);
    } catch (err) {
      if (err instanceof IllegalActionError) {
        if (onIllegal) onIllegal(err);
        else log.warn('internal action rejected', { action: action.type, code: err.code });
        return false;
      }
      throw err;
    }
    this.match = result.state;
    this.emitEvents(result.events);
    this.syncSchema();
    this.scheduleTurn();
    return true;
  }

  /** Engine events → protocol broadcasts, in §6.5 emission order. */
  private emitEvents(events: GameEvent[]): void {
    const match = this.match;
    if (!match) return;
    let enteredWaitMove = false;

    for (const ev of events) {
      switch (ev.type) {
        case 'DICE_ROLLED':
          if (ev.value === 6) this.bumpStat(ev.seat, 'sixes');
          this.broadcast('dice', {
            seat: ev.seat,
            value: ev.value,
            legalPieceIds: ev.legalPieceIds,
            extraTurn: ev.extraTurn,
            parts: ev.parts,
            picked: ev.picked,
          } satisfies DiceMessage);
          if (ev.legalPieceIds.length > 0) enteredWaitMove = true;
          break;
        case 'TOKEN_SPAWNED':
          this.broadcast('tokenSpawned', { cell: ev.cell, power: ev.power } satisfies TokenSpawnedMessage);
          break;
        case 'TOKEN_COLLECTED':
          this.broadcast('tokenCollected', {
            seat: ev.seat,
            cell: ev.cell,
            power: ev.power,
            charges: ev.charges,
          } satisfies TokenCollectedMessage);
          break;
        case 'POWER_USED':
          this.broadcast('powerUsed', {
            seat: ev.seat,
            power: ev.power,
            face: ev.face,
            pieceId: ev.pieceId,
            targetSeat: ev.targetSeat,
            cell: ev.cell,
          } satisfies PowerUsedMessage);
          break;
        case 'TRAP_TRIGGERED':
          this.broadcast('trapTriggered', {
            seat: ev.seat,
            victimSeat: ev.victimSeat,
            victimPieceId: ev.victimPieceId,
            cell: ev.cell,
            blocked: ev.blocked,
          } satisfies TrapTriggeredMessage);
          break;
        case 'CAPTURE':
          // No direct message (moveResult carries it) — only the §7.3 stat.
          this.bumpStat(ev.seat, 'captures');
          break;
        case 'PIECE_MOVED': {
          const capture = events.find(
            (e): e is Extract<GameEvent, { type: 'CAPTURE' }> =>
              e.type === 'CAPTURE' && e.seat === ev.seat && e.pieceId === ev.pieceId,
          );
          this.broadcast('moveResult', {
            seat: ev.seat,
            pieceId: ev.pieceId,
            path: ev.path,
            captured: capture
              ? { seat: capture.victimSeat, pieceId: capture.victimPieceId }
              : undefined,
            reachedHome: ev.reachedHome,
            extraTurn: events.some((e) => e.type === 'EXTRA_TURN' && e.seat === ev.seat),
            teleport: ev.teleport,
          } satisfies MoveResultMessage);
          break;
        }
        case 'TURN_SKIPPED':
          this.broadcast('turnSkipped', {
            seat: ev.seat,
            reason: ev.reason,
          } satisfies TurnSkippedMessage);
          break;
        case 'TURN_CHANGED':
          this.broadcast('turn', {
            seat: ev.seat,
            deadline: match.turnDeadline,
            phase: 'roll',
          } satisfies TurnMessage);
          break;
        case 'PLAYER_TIMEOUT':
          // §5.4: 2 consecutive strikes → the seat flips to AUTO.
          if (ev.strikes >= this.tuning.maxStrikes) this.setAuto(ev.seat);
          break;
        case 'MATCH_ENDED':
          this.finishMatch(ev.ranking);
          break;
        default:
          break; // MATCH_STARTED / EXTRA_TURN / PLAYER_* need no direct message
      }
    }

    // §6.5: the roll reset the deadline — announce the move sub-phase.
    if (enteredWaitMove && match.phase === 'playing' && match.turnPhase === 'wait_move') {
      this.broadcast('turn', {
        seat: match.currentSeat,
        deadline: match.turnDeadline,
        phase: 'move',
      } satisfies TurnMessage);
    }
  }

  private finishMatch(ranking: { seat: Seat; place: number }[]): void {
    this.turnEpoch += 1; // cancel any pending turn timer
    void this.settleAndBroadcast(ranking);
  }

  /**
   * Sprint 3b: persist + pay through MatchService, then broadcast matchEnd
   * with the REAL per-seat rewards. Any persistence failure downgrades to
   * prizes 0 + `rewardsPending` — the room itself never dies over the DB.
   */
  private async settleAndBroadcast(ranking: { seat: Seat; place: number }[]): Promise<void> {
    let lines: RewardLine[] | null = null;
    let rewardsPending = false;
    if (this.services) {
      try {
        if (this.startPromise) await this.startPromise;
        const started = this.startedMatch;
        if (!started) throw new Error('lr_matches record was never opened');
        lines = await this.services.matches.persistAndReward(
          this.buildSettleInput(started, ranking),
        );
      } catch (err) {
        rewardsPending = true;
        log.error('match settlement failed — broadcasting rewardsPending', {
          roomId: this.roomId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const bySeat = new Map((lines ?? []).map((line) => [line.seat, line] as const));
    const payload: MatchEndMessage = {
      ranking: ranking.map((r) => ({
        seat: r.seat,
        place: r.place,
        coinsDelta: bySeat.get(r.seat)?.coinsDelta ?? 0,
        xpEarned: bySeat.get(r.seat)?.xpEarned ?? 0,
      })),
      potTotal: rewardsPending ? 0 : this.startedMatch?.pot ?? 0,
    };
    if (rewardsPending) payload.rewardsPending = true;
    this.broadcast('matchEnd', payload);

    // Free the guest identities so players can queue again right away.
    if (!this.isPrivateRoom) {
      for (const entry of this.roster) {
        void this.presence.srem(QUICK_DEVICE_CHANNEL, entry.deviceId);
      }
    }
    // §6.2: FINISHED → room.disconnect() shortly after.
    this.clock.setTimeout(() => void this.disconnect(), this.tuning.disposeAfterEndMs);
    log.info('match finished', { roomId: this.roomId, persisted: lines !== null });
  }

  /** Open the lr_matches row + collect fees (see startPlaying comment). */
  private async openMatchRecord(numPlayers: number): Promise<void> {
    const services = this.services;
    if (!services) return;
    try {
      this.startedMatch = await services.matches.startMatch({
        mode: 'classic',
        type: this.isPrivateRoom ? 'private' : 'quick',
        tierId: this.tierId,
        roomId: this.roomId,
        privateCode: this.isPrivateRoom ? this.state.privateCode : null,
        maxPlayers: numPlayers,
        seats: this.roster.map((entry, i) => ({
          seat: i,
          deviceId: entry.deviceId,
        })),
      });
    } catch (err) {
      // Leave startedMatch null: settleAndBroadcast turns that into
      // rewardsPending instead of crashing the table.
      log.error('startMatch persistence failed', {
        roomId: this.roomId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Engine state + room counters → MatchService.SettleInput. */
  private buildSettleInput(
    started: StartedMatch,
    ranking: { seat: Seat; place: number }[],
  ): SettleInput {
    const match = this.match;
    const placeBySeat = new Map(ranking.map((r) => [r.seat, r.place] as const));
    const seats: SeatOutcome[] = this.roster.map((_entry, i) => {
      const seat = i as Seat;
      const player = match?.players[seat];
      const stats = this.seatStats.get(seat);
      return {
        seat,
        userId: started.userBySeat.get(seat),
        isBot: false,
        color: player?.color ?? 'red',
        place: placeBySeat.get(seat) ?? player?.place ?? 0,
        leftEarly: player?.forfeited ?? false,
        piecesHome: match
          ? match.pieces.filter((p) => p.seat === seat && p.steps === 57).length
          : 0,
        captures: stats?.captures ?? 0,
        sixes: stats?.sixes ?? 0,
        disconnects: this.seatDisconnects.get(seat) ?? 0,
      };
    });
    const rngLog = match?.rngLog ?? [];
    return {
      matchId: started.matchId,
      entryFee: started.entryFee,
      pot: started.pot,
      tierId: started.tierId,
      numPlayers: match?.config.numPlayers ?? seats.length,
      seats,
      rngRolls: rngLog.length,
      // §5.5 post-hoc dice audit: SHA-256(matchId + rngLog).
      seedHash: createHash('sha256')
        .update(`${started.matchId}${JSON.stringify(rngLog)}`)
        .digest('hex'),
    };
  }

  private bumpStat(seat: Seat, key: 'captures' | 'sixes'): void {
    const stats = this.seatStats.get(seat) ?? { captures: 0, sixes: 0 };
    stats[key] += 1;
    this.seatStats.set(seat, stats);
  }

  // -------------------------------------------------------------------------
  // Turn timer (§5.4) + AUTO seats (§6.6)
  // -------------------------------------------------------------------------

  private scheduleTurn(): void {
    this.turnEpoch += 1;
    const epoch = this.turnEpoch;
    const match = this.match;
    if (!match || match.phase !== 'playing') return;
    const seat = match.currentSeat;
    const serverPlays = this.autoSeats.has(seat) || this.disconnectedSeats.has(seat);
    const waitMs = serverPlays
      ? match.turnPhase === 'wait_roll'
        ? this.tuning.autoRollDelayMs
        : this.tuning.autoMoveDelayMs
      : Math.max(match.turnDeadline - Date.now(), 50);
    this.clock.setTimeout(() => this.onTurnTimer(epoch), waitMs);
  }

  private onTurnTimer(epoch: number): void {
    if (epoch !== this.turnEpoch) return; // superseded by a manual action
    const match = this.match;
    if (!match || match.phase !== 'playing') return;
    const seat = match.currentSeat;
    const now = Date.now();

    // Either branch below plays THIS seat's decision server-side — an
    // in-flight client action for it must not count as cheating.
    this.serverActedAt.set(seat, now);

    if (this.autoSeats.has(seat) || this.disconnectedSeats.has(seat)) {
      // §6.6: the server plays the seat with the Easy heuristic (no strikes).
      if (match.turnPhase === 'wait_roll') {
        this.applyEngine({ type: 'ROLL', seat, dice: this.rollDie(), dice2: this.secondDie(), auto: true, now });
      } else {
        const md = chooseMove(match, seat, match.dice, 'easy', this.rand01);
        if (md) this.applyEngine({ type: 'MOVE', seat, pieceId: md.pieceId, auto: true, now });
      }
      return;
    }
    // §5.4 timeout: strike + auto-move on the player's behalf.
    this.applyEngine({
      type: 'TIMEOUT',
      dice: match.turnPhase === 'wait_roll' ? this.rollDie() : undefined,
      rng: this.rand01(),
      now,
    });
  }

  /** Second CSPRNG die, only when a POWER double is armed for this roll. */
  private secondDie(): number | undefined {
    return this.match?.pendingRoll?.kind === 'double' ? this.rollDie() : undefined;
  }

  /** True while `seat`'s last decision was just played by the server. */
  private isTimerRace(seat: Seat): boolean {
    const at = this.serverActedAt.get(seat);
    return at !== undefined && Date.now() - at < TIMER_RACE_GRACE_MS;
  }

  private setAuto(seat: Seat): void {
    if (this.autoSeats.has(seat)) return;
    this.autoSeats.add(seat);
    this.broadcastStatus(seat, !this.disconnectedSeats.has(seat), true);
    log.info('seat switched to AUTO', { roomId: this.roomId, seat });
  }

  /** §5.4: any manual action exits AUTO and clears strikes. */
  private exitAutoIfManual(seat: Seat): boolean {
    if (!this.autoSeats.has(seat)) return false;
    this.autoSeats.delete(seat);
    const match = this.match;
    if (match) {
      const player = match.players[seat];
      if (player) player.timeoutStrikes = 0;
    }
    this.broadcastStatus(seat, true, false);
    this.syncSchema();
    this.scheduleTurn();
    return true;
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /** Rate-gate + seat lookup shared by every message handler. */
  private gate(client: Client): { seat: Seat; meta: ClientMeta } | null {
    const meta = client.userData as ClientMeta | undefined;
    if (!meta) return null;
    if (!allowMessage(meta, Date.now())) {
      this.sendErr(client, ERR.RATE_LIMIT, 'too many messages');
      return null;
    }
    const seat = this.seatBySession.get(client.sessionId);
    if (seat === undefined) return null;
    return { seat, meta };
  }

  private sendErr(client: Client, code: ErrCode, msg: string): void {
    client.send('err', { code, msg } satisfies ErrMessage);
  }

  /** Count a rejected action; ≥5 in a match → kick + audit log (§6.8.2). */
  private punish(client: Client, meta: ClientMeta, code: ErrCode, msg: string): void {
    meta.illegal += 1;
    this.sendErr(client, code, msg);
    if (meta.illegal >= MAX_ILLEGAL_ACTIONS) {
      // lr_admin_audit_log entity 'anticheat' arrives with the DB in Sprint 3.
      log.warn('anticheat kick', { roomId: this.roomId, sessionId: client.sessionId });
      client.leave(KICK_CLOSE_CODE);
    }
  }

  private broadcastStatus(seat: Seat, connected: boolean, auto: boolean): void {
    this.broadcast('playerStatus', { seat, connected, auto } satisfies PlayerStatusMessage);
  }

  private removeFromLobby(client: Client): void {
    if (this.state.phase !== 'lobby' && this.state.phase !== 'countdown') return;
    const idx = this.roster.findIndex((entry) => entry.sessionId === client.sessionId);
    if (idx === -1) return;
    const [gone] = this.roster.splice(idx, 1);
    if (gone && !this.isPrivateRoom) void this.presence.srem(QUICK_DEVICE_CHANNEL, gone.deviceId);
    this.seatBySession.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    // Re-seat survivors in join order and re-elect the host.
    this.roster.forEach((entry, i) => {
      this.seatBySession.set(entry.sessionId, i as Seat);
      const player = this.state.players.get(entry.sessionId);
      if (player) player.seat = i;
    });
    this.state.hostSessionId = this.roster[0]?.sessionId ?? '';
    // A departure mid-countdown always re-opens the lobby (host restarts).
    if (this.state.phase === 'countdown') this.cancelCountdown();
  }

  /** Mirror the engine state into the synchronized schema (§6.4). */
  private syncSchema(): void {
    const match = this.match;
    if (!match) return;
    this.state.phase = match.phase;
    this.state.currentSeat = match.currentSeat;
    this.state.dice = match.dice;
    this.state.awaitingMove = match.turnPhase === 'wait_move';
    this.state.turnDeadline = match.turnDeadline;
    this.state.consecutiveSixes = match.consecutiveSixes;

    for (const entry of this.roster) {
      const player = this.state.players.get(entry.sessionId);
      const seat = this.seatBySession.get(entry.sessionId);
      if (!player || seat === undefined) continue;
      const enginePlayer = match.players[seat];
      if (!enginePlayer) continue;
      player.seat = seat;
      player.color = enginePlayer.color;
      player.place = enginePlayer.place;
      player.forfeited = enginePlayer.forfeited;
      player.timeoutStrikes = enginePlayer.timeoutStrikes;
      player.connected = !this.disconnectedSeats.has(seat);
      player.auto = this.autoSeats.has(seat) || this.disconnectedSeats.has(seat);
    }

    match.pieces.forEach((piece, i) => {
      const row = this.state.pieces[i];
      if (row) row.steps = piece.steps;
    });

    if (this.state.winnerOrder.length !== match.winnerOrder.length) {
      this.state.winnerOrder.clear();
      for (const s of match.winnerOrder) this.state.winnerOrder.push(s);
    }

    // POWER mirror — small lists, rebuilt whole (they change rarely).
    if (match.config.powerMode) {
      this.state.tokens.clear();
      for (const t of match.tokens) {
        const row = new TokenSchema();
        row.cell = t.cell;
        row.power = t.power;
        this.state.tokens.push(row);
      }
      while (this.state.charges.length < match.charges.length) {
        this.state.charges.push(new ChargesSchema());
      }
      match.charges.forEach((c, i) => {
        const row = this.state.charges[i];
        if (!row) return;
        row.plus = c.plus;
        row.double = c.double;
        row.pick = c.pick;
        row.shield = c.shield;
        row.bomb = c.bomb;
        row.bolt = c.bolt;
        row.freeze = c.freeze;
        row.portal = c.portal;
      });
      this.state.shields.clear();
      for (const s of match.shields) {
        const row = new ShieldSchema();
        row.seat = s.seat;
        row.pieceId = s.pieceId;
        this.state.shields.push(row);
      }
      this.state.traps.clear();
      for (const tr of match.traps) {
        const row = new TrapSchema();
        row.seat = tr.seat;
        row.cell = tr.cell;
        this.state.traps.push(row);
      }
      this.state.frozen.clear();
      for (const f of match.frozen) {
        const row = new FrozenSchema();
        row.seat = f.seat;
        row.pieceId = f.pieceId;
        this.state.frozen.push(row);
      }
    }
  }
}

const USE_POWER_TYPES: ReadonlySet<string> = new Set([
  'plus', 'double', 'pick', 'shield', 'bomb', 'bolt', 'freeze', 'portal',
]);

/** Validate a usePower payload (type-safe narrow, §6.8 zero-trust inputs). */
function readUsePower(
  payload: unknown,
): { power: PowerType; face?: number; pieceId?: number; targetSeat?: Seat; cell?: number } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const power = p['power'];
  if (typeof power !== 'string' || !USE_POWER_TYPES.has(power)) return null;
  const readInt = (key: string, min: number, max: number): number | null | undefined => {
    const v = p[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
    return v;
  };
  const face = readInt('face', 1, 6);
  if (face === null) return null;
  const pieceId = readInt('pieceId', 0, 3);
  if (pieceId === null) return null;
  const targetSeat = readInt('targetSeat', 0, 3);
  if (targetSeat === null) return null;
  const cell = readInt('cell', 0, 51);
  if (cell === null) return null;
  return {
    power: power as PowerType,
    face,
    pieceId,
    targetSeat: targetSeat as Seat | undefined,
    cell,
  };
}
