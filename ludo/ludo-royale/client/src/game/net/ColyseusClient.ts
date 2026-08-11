/**
 * ColyseusClient — GameDriver over the network (ARQUITECTURA §4.5/§6).
 *
 * Same contract as OfflineDriver, so GameBoardScene cannot tell them apart:
 * §6.5 protocol messages map 1:1 onto driver callbacks and the room schema
 * (§6.4) backs snapshot()/resync. Messages received before the scene calls
 * start() (countdown → first turn while WaitingScene is still up) are
 * buffered and flushed in order.
 *
 * Reconnection (§6.6): the SDK retries transient drops on its own
 * (onDrop/onReconnect surface as connection status); the reconnectionToken
 * is persisted in sessionStorage so a page reload can resume() back into
 * the same seat while the server plays AUTO.
 */
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { DEFAULT_RULES, ERR, LAST_TRACK_STEP, PROTOCOL_VERSION, toAbsoluteCell } from '@ludo/shared';
import type {
  CaptureNotice,
  DiceMessage,
  EmoteShownMessage,
  ErrMessage,
  GameState,
  MatchEndMessage,
  MoveResultMessage,
  PieceState,
  PlayerColor,
  PlayerState,
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
import type { ConnectionStatus, SceneDriver } from '../matchTypes';
import { gameServerUrl } from './config';
import { deviceId, getPlayerName } from './identity';

const SESSION_KEY = 'lr_online_session';
/** A stored token older than this cannot possibly be inside the 60s grace. */
const SESSION_MAX_AGE_MS = 10 * 60 * 1000;
/** A join/reconnect that cannot reach the server must never hang the UI. */
const CONNECT_TIMEOUT_MS = 10_000;
/** Client-side code (not in shared ERR) surfaced when the timeout fires. */
export const ERR_CONNECT_TIMEOUT = 'ERR_CONNECT_TIMEOUT';

// ---------------------------------------------------------------------------
// Read-only structural view of the decoded room schema (server §6.4)
// ---------------------------------------------------------------------------

interface NetPlayer {
  seat: number;
  name: string;
  color: string;
  connected: boolean;
  auto: boolean;
  place: number;
  forfeited: boolean;
  timeoutStrikes: number;
}

interface NetPiece {
  seat: number;
  pieceId: number;
  steps: number;
}

interface NetMap<T> {
  get(key: string): T | undefined;
  forEach(cb: (value: T, key: string) => void): void;
  readonly size: number;
}

interface NetList<T> {
  readonly length: number;
  forEach(cb: (value: T, index: number) => void): void;
}

interface NetState {
  phase: string;
  mode: string;
  size: number;
  numPlayers: number;
  turnTimerS: number;
  currentSeat: number;
  dice: number;
  awaitingMove: boolean;
  turnDeadline: number;
  consecutiveSixes: number;
  countdownEnds: number;
  privateCode: string;
  hostSessionId: string;
  players: NetMap<NetPlayer>;
  pieces: NetList<NetPiece>;
  winnerOrder: NetList<number>;
}

/** POWER-mode schema extras (present only on power rooms). */
interface NetPowerState {
  powerMode: boolean;
  tokens: NetList<{ cell: number; power: string }>;
  charges: NetList<{
    plus: number;
    double: number;
    pick: number;
    shield: number;
    bomb?: number;
    bolt?: number;
    freeze?: number;
    portal?: number;
  }>;
  shields: NetList<{ seat: number; pieceId: number }>;
  traps?: NetList<{ seat: number; cell: number }>;
  frozen?: NetList<{ seat: number; pieceId: number }>;
}

// ---------------------------------------------------------------------------
// Lobby view for WaitingScene
// ---------------------------------------------------------------------------

export interface LobbySlot {
  seat: Seat;
  name: string;
  isYou: boolean;
  connected: boolean;
}

export interface LobbyInfo {
  phase: string;
  size: number;
  numPlayers: number;
  players: LobbySlot[];
  code: string;
  isHost: boolean;
  countdownEnds: number;
}

function joinOptions(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    deviceId: deviceId(),
    name: getPlayerName() ?? 'Player',
    ...extra,
  };
}

/**
 * Race a join/reconnect against CONNECT_TIMEOUT_MS. A dead server or a WS
 * stuck in `connecting` otherwise leaves the promise pending forever and the
 * lobby wedged on "Connecting…". If the join lands AFTER the timeout fired,
 * the late room is left immediately so no ghost seat stays reserved.
 */
function joinWithTimeout(join: Promise<Room>): Promise<Room> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(ERR_CONNECT_TIMEOUT));
    }, CONNECT_TIMEOUT_MS);
  });
  join.then(
    (room) => {
      if (timedOut) void room.leave(true).catch(() => undefined);
    },
    () => undefined, // real error propagates via the race below
  );
  return Promise.race([join, timeout]).finally(() => clearTimeout(timer));
}

/** Server rejections carry §6.5 codes in the message — surface them as-is. */
function normalizeJoinError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  for (const code of Object.values(ERR)) {
    if (message.includes(code)) return new Error(code);
  }
  if (/not found|has been disposed|expired|locked/i.test(message)) {
    return new Error(ERR.BAD_CODE);
  }
  return new Error(message);
}

export class ColyseusClient implements SceneDriver {
  // GameDriver callbacks (wired by GameBoardScene)
  onDice?: (msg: DiceMessage) => void;
  onMove?: (msg: MoveResultMessage) => void;
  onTurn?: (msg: TurnMessage) => void;
  onTurnSkipped?: (msg: TurnSkippedMessage) => void;
  onCapture?: (notice: CaptureNotice) => void;
  onMatchEnd?: (msg: MatchEndMessage) => void;
  onPlayerStatus?: (msg: PlayerStatusMessage) => void;
  onEmoteShown?: (msg: EmoteShownMessage) => void;
  onError?: (msg: ErrMessage) => void;
  onTokenSpawned?: (msg: TokenSpawnedMessage) => void;
  onTokenCollected?: (msg: TokenCollectedMessage) => void;
  onPowerUsed?: (msg: PowerUsedMessage) => void;
  onTrapTriggered?: (msg: TrapTriggeredMessage) => void;
  // SceneDriver extras
  onResync?: () => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
  // WaitingScene surface
  onLobbyUpdate?: (info: LobbyInfo) => void;

  private readonly room: Room;
  private started = false;
  private pending: (() => void)[] = [];
  private sawTurn = false;
  private matchEnded = false;
  private leaving = false;
  /** place per sessionId — detects remote forfeits for board resync (§6.7). */
  private readonly knownPlaces = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  /** §6.3 quick match: joinOrCreate grouped by size+mode via server filterBy. */
  static async quickMatch(size: 2 | 3 | 4, powerMode = false): Promise<ColyseusClient> {
    try {
      const room = await joinWithTimeout(
        new Client(gameServerUrl()).joinOrCreate('quick', joinOptions({ size, powerMode })),
      );
      return await ColyseusClient.wrap(room);
    } catch (err) {
      throw normalizeJoinError(err);
    }
  }

  /** §6.1 private room — the 6-char code is room.roomId / state.privateCode. */
  static async createPrivate(size: 2 | 3 | 4, powerMode = false): Promise<ColyseusClient> {
    try {
      const room = await joinWithTimeout(
        new Client(gameServerUrl()).create('private', joinOptions({ size, powerMode })),
      );
      return await ColyseusClient.wrap(room);
    } catch (err) {
      throw normalizeJoinError(err);
    }
  }

  static async joinPrivate(code: string): Promise<ColyseusClient> {
    try {
      const room = await joinWithTimeout(
        new Client(gameServerUrl()).joinById(code.trim().toUpperCase(), joinOptions()),
      );
      return await ColyseusClient.wrap(room);
    } catch (err) {
      throw normalizeJoinError(err);
    }
  }

  /**
   * §6.6: after a reload, retry the sessionStorage token. Returns null when
   * there is nothing to resume (no token, grace expired, match finished).
   */
  static async resume(): Promise<ColyseusClient | null> {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    let token = '';
    try {
      const stored = JSON.parse(raw) as { token?: string; savedAt?: number };
      if (
        typeof stored.token !== 'string' ||
        typeof stored.savedAt !== 'number' ||
        Date.now() - stored.savedAt > SESSION_MAX_AGE_MS
      ) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      token = stored.token;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    try {
      const room = await joinWithTimeout(new Client(gameServerUrl()).reconnect(token));
      const driver = await ColyseusClient.wrap(room);
      if (driver.net.phase === 'finished') {
        driver.destroy();
        return null;
      }
      return driver;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  private static async wrap(room: Room): Promise<ColyseusClient> {
    const driver = new ColyseusClient(room);
    await driver.waitForFirstState();
    driver.persistToken();
    return driver;
  }

  private constructor(room: Room) {
    this.room = room;

    room.onMessage('dice', (msg: DiceMessage) => this.deliver(() => this.onDice?.(msg)));
    room.onMessage('moveResult', (msg: MoveResultMessage) =>
      this.deliver(() => {
        this.onMove?.(msg);
        const capture = this.captureFrom(msg);
        if (capture) this.onCapture?.(capture);
      }),
    );
    room.onMessage('turn', (msg: TurnMessage) => {
      this.sawTurn = true;
      this.deliver(() => this.onTurn?.(msg));
    });
    room.onMessage('turnSkipped', (msg: TurnSkippedMessage) =>
      this.deliver(() => this.onTurnSkipped?.(msg)),
    );
    room.onMessage('playerStatus', (msg: PlayerStatusMessage) =>
      this.deliver(() => this.onPlayerStatus?.(msg)),
    );
    room.onMessage('emoteShown', (msg: EmoteShownMessage) => {
      // Own emotes already showed a local bubble on tap — avoid the echo.
      if (msg.seat !== this.localSeat) this.deliver(() => this.onEmoteShown?.(msg));
    });
    room.onMessage('matchEnd', (msg: MatchEndMessage) => {
      this.matchEnded = true;
      this.deliver(() => this.onMatchEnd?.(msg));
    });
    room.onMessage('err', (msg: ErrMessage) => this.deliver(() => this.onError?.(msg)));
    room.onMessage('tokenSpawned', (msg: TokenSpawnedMessage) =>
      this.deliver(() => this.onTokenSpawned?.(msg)),
    );
    room.onMessage('tokenCollected', (msg: TokenCollectedMessage) =>
      this.deliver(() => this.onTokenCollected?.(msg)),
    );
    room.onMessage('powerUsed', (msg: PowerUsedMessage) =>
      this.deliver(() => this.onPowerUsed?.(msg)),
    );
    room.onMessage('trapTriggered', (msg: TrapTriggeredMessage) =>
      this.deliver(() => this.onTrapTriggered?.(msg)),
    );

    room.onStateChange(() => this.handleStateChange());
    room.onDrop(() => this.onConnectionStatus?.('reconnecting'));
    room.onReconnect(() => {
      // Token rotates on every connection — persist the fresh one.
      this.persistToken();
      this.onConnectionStatus?.('connected');
      // The schema re-synced the whole board while we were away.
      this.deliver(() => this.onResync?.());
    });
    room.onLeave(() => {
      ColyseusClient.clearSession();
      if (!this.leaving && !this.matchEnded) this.onConnectionStatus?.('lost');
    });
  }

  // -------------------------------------------------------------------------
  // SceneDriver / GameDriver
  // -------------------------------------------------------------------------

  requestRoll(): void {
    this.room.send('roll', {});
  }

  requestMove(pieceId: number): void {
    this.room.send('move', { pieceId });
  }

  sendEmote(emoteId: number): void {
    this.room.send('emote', { emoteId });
  }

  usePower(
    power: PowerType,
    opts: { face?: number; pieceId?: number; targetSeat?: Seat; cell?: number } = {},
  ): void {
    this.room.send('usePower', {
      power,
      face: opts.face,
      pieceId: opts.pieceId,
      targetSeat: opts.targetSeat,
      cell: opts.cell,
    });
  }

  forfeit(): void {
    this.room.send('forfeit', {});
  }

  /** PrivateRoom host only (§6.1). */
  sendStartMatch(): void {
    this.room.send('startMatch', {});
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const queued = this.pending;
    this.pending = [];
    for (const task of queued) task();
    // Resumed session: no buffered `turn` — rebuild it from the schema.
    if (!this.sawTurn && this.net.phase === 'playing') {
      this.onTurn?.({
        seat: this.net.currentSeat as Seat,
        deadline: this.net.turnDeadline,
        phase: this.net.awaitingMove ? 'move' : 'roll',
      });
    }
  }

  destroy(): void {
    this.leaving = true;
    ColyseusClient.clearSession();
    void this.room.leave(true).catch(() => undefined);
  }

  isHumanSeat(seat: Seat): boolean {
    return this.localSeat === seat;
  }

  get turnTimerS(): number {
    const timer: number = this.net.turnTimerS;
    return timer > 0 ? timer : 30;
  }

  seatName(seat: Seat): string {
    let name = '';
    this.net.players.forEach((player) => {
      if (player.seat === seat) name = player.name;
    });
    return name;
  }

  get localSeat(): Seat | null {
    const me = this.net.players.get(this.room.sessionId);
    return me ? (me.seat as Seat) : null;
  }

  get roomCode(): string {
    return this.net.privateCode;
  }

  get lobby(): LobbyInfo {
    return this.buildLobby();
  }

  /**
   * §6.6 presence snapshot: the current connected/auto flags per seat,
   * straight from the schema. GameBoardScene paints the AUTO/offline chip
   * badges from this on resume/resync — the flags may have flipped while we
   * were away, and the next `playerStatus` broadcast could be minutes out.
   */
  seatStatuses(): PlayerStatusMessage[] {
    const statuses: PlayerStatusMessage[] = [];
    this.net.players.forEach((player) => {
      statuses.push({
        seat: player.seat as Seat,
        connected: player.connected,
        auto: player.auto,
      });
    });
    statuses.sort((a, b) => a.seat - b.seat);
    return statuses;
  }

  /** Rebuild the engine-shaped state from the schema (§6.4 is the truth). */
  snapshot(): GameState {
    const net = this.net;
    const players: PlayerState[] = [];
    net.players.forEach((player) => {
      players.push({
        seat: player.seat as Seat,
        color: (player.color === '' ? 'red' : player.color) as PlayerColor,
        place: player.place,
        forfeited: player.forfeited,
        timeoutStrikes: player.timeoutStrikes,
      });
    });
    players.sort((a, b) => a.seat - b.seat);

    const pieces: PieceState[] = [];
    net.pieces.forEach((piece) => {
      pieces.push({ seat: piece.seat as Seat, pieceId: piece.pieceId, steps: piece.steps });
    });

    const winnerOrder: Seat[] = [];
    net.winnerOrder.forEach((seat) => winnerOrder.push(seat as Seat));

    const numPlayers = (net.numPlayers === 3 || net.numPlayers === 4 ? net.numPlayers : 2) as
      | 2
      | 3
      | 4;
    return {
      phase: net.phase === 'playing' ? 'playing' : net.phase === 'finished' ? 'finished' : 'lobby',
      turnPhase: net.awaitingMove ? 'wait_move' : 'wait_roll',
      config: {
        numPlayers,
        rules: { ...DEFAULT_RULES }, // display-only client-side (§5 authority is the server)
        turnTimerS: this.turnTimerS,
        powerMode: (this.net as Partial<NetPowerState>).powerMode ?? false,
        // Display-only: charges already arrive seeded via the schema, and
        // token sprites sync from the (empty, in shop-model rooms) list.
        tokenDrops: true,
        startingSeat: 0,
      },
      players,
      pieces,
      currentSeat: net.currentSeat as Seat,
      dice: net.dice,
      diceParts: null,
      consecutiveSixes: net.consecutiveSixes,
      turnDeadline: net.turnDeadline,
      winnerOrder,
      rngLog: [], // server-side audit only (§5.5)
      tokens: this.tokensFromNet(),
      charges: this.chargesFromNet(numPlayers),
      shields: this.shieldsFromNet(),
      traps: this.trapsFromNet(),
      frozen: this.frozenFromNet(),
      pendingRoll: null,
    };
  }

  /** POWER schema extras — absent on classic rooms / older servers. */
  private tokensFromNet(): GameState['tokens'] {
    const list = (this.net as Partial<NetPowerState>).tokens;
    const out: GameState['tokens'] = [];
    list?.forEach((t) => out.push({ cell: t.cell, power: t.power as PowerType }));
    return out;
  }

  private chargesFromNet(numPlayers: number): GameState['charges'] {
    const list = (this.net as Partial<NetPowerState>).charges;
    const out: GameState['charges'] = Array.from({ length: numPlayers }, () => ({
      plus: 0,
      double: 0,
      pick: 0,
      shield: 0,
      bomb: 0,
      bolt: 0,
      freeze: 0,
      portal: 0,
    }));
    list?.forEach((c, i) => {
      const slot = out[i];
      if (slot) {
        Object.assign(slot, {
          plus: c.plus,
          double: c.double,
          pick: c.pick,
          shield: c.shield,
          bomb: c.bomb ?? 0,
          bolt: c.bolt ?? 0,
          freeze: c.freeze ?? 0,
          portal: c.portal ?? 0,
        });
      }
    });
    return out;
  }

  /** POWER battle set mirrors — absent on classic rooms / older servers. */
  private trapsFromNet(): GameState['traps'] {
    const list = (this.net as Partial<NetPowerState>).traps;
    const out: GameState['traps'] = [];
    list?.forEach((tr) => out.push({ seat: tr.seat as Seat, cell: tr.cell }));
    return out;
  }

  private frozenFromNet(): GameState['frozen'] {
    const list = (this.net as Partial<NetPowerState>).frozen;
    const out: GameState['frozen'] = [];
    list?.forEach((f) => out.push({ seat: f.seat as Seat, pieceId: f.pieceId, remaining: 1 }));
    return out;
  }

  private shieldsFromNet(): GameState['shields'] {
    const list = (this.net as Partial<NetPowerState>).shields;
    const out: GameState['shields'] = [];
    list?.forEach((s) => out.push({ seat: s.seat as Seat, pieceId: s.pieceId }));
    return out;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private get net(): NetState {
    return this.room.state as unknown as NetState;
  }

  private deliver(task: () => void): void {
    if (this.started) task();
    else this.pending.push(task);
  }

  private waitForFirstState(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      this.room.onStateChange.once(finish);
      // Safety net: if the full state landed before this registration (or a
      // proxy delays patches), don't wedge the join flow.
      setTimeout(finish, 1500);
    });
  }

  private persistToken(): void {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: this.room.reconnectionToken, savedAt: Date.now() }),
    );
  }

  private static clearSession(): void {
    sessionStorage.removeItem(SESSION_KEY);
  }

  /** moveResult.captured → CaptureNotice with the absolute landing cell. */
  private captureFrom(msg: MoveResultMessage): CaptureNotice | null {
    if (!msg.captured) return null;
    const landing = msg.path[msg.path.length - 1];
    let cell = -1;
    if (landing !== undefined && landing <= LAST_TRACK_STEP) {
      const color = this.colorOfSeat(msg.seat);
      if (color) cell = toAbsoluteCell(color, landing) ?? -1;
    }
    return {
      bySeat: msg.seat,
      byPieceId: msg.pieceId,
      victimSeat: msg.captured.seat,
      victimPieceId: msg.captured.pieceId,
      cell,
    };
  }

  private colorOfSeat(seat: Seat): PlayerColor | null {
    let color: PlayerColor | null = null;
    this.net.players.forEach((player) => {
      if (player.seat === seat && player.color !== '') color = player.color as PlayerColor;
    });
    return color;
  }

  private handleStateChange(): void {
    this.onLobbyUpdate?.(this.buildLobby());
    // §6.7: a forfeit retires pieces without a moveResult — detect the place
    // flip and snap the board to schema truth.
    let resync = false;
    this.net.players.forEach((player, sessionId) => {
      const prev = this.knownPlaces.get(sessionId) ?? 0;
      if (player.forfeited && prev === 0 && player.place > 0) resync = true;
      this.knownPlaces.set(sessionId, player.place);
    });
    if (resync) this.deliver(() => this.onResync?.());
  }

  private buildLobby(): LobbyInfo {
    const net = this.net;
    const players: LobbySlot[] = [];
    net.players.forEach((player, sessionId) => {
      players.push({
        seat: player.seat as Seat,
        name: player.name,
        isYou: sessionId === this.room.sessionId,
        connected: player.connected,
      });
    });
    players.sort((a, b) => a.seat - b.seat);
    return {
      phase: net.phase,
      size: net.size,
      numPlayers: net.numPlayers,
      players,
      code: net.privateCode,
      isHost: net.hostSessionId === this.room.sessionId,
      countdownEnds: net.countdownEnds,
    };
  }
}
