/**
 * OfflineDriver — GameDriver over the local engine (ARQUITECTURA §4.5).
 *
 * Wraps the pure reducer + AI for the two offline modes: vs CPU (seat 0
 * human) and pass & play (every seat human, same device). It mirrors the
 * server protocol shapes exactly so GameBoardScene cannot tell it apart
 * from the Sprint-2 ColyseusClient: `dice`/`moveResult`/`turn`/`matchEnd`
 * callbacks fire in the same order the room would send them.
 *
 * Dice come from crypto.getRandomValues (no economic value offline, but the
 * same honest distribution). CPU turns get a human-feeling 600–1000ms delay;
 * human turns run a visible 30s timeout that hands the turn to the engine's
 * auto-move (Easy heuristic), matching the server behavior in §5.4.
 */
import {
  AI_POWER_LOADOUTS,
  BATTLE_POWERS,
  applyAction,
  cloneState,
  createGame,
  isCellThreatened,
  isFrozen,
  isOnTrack,
  isSafeCell,
  isShielded,
  pickMove,
  toAbsoluteCell,
  IllegalActionError,
  TRACK_SIZE,
} from '@ludo/shared';
import type {
  AiLevel,
  ApplyResult,
  CaptureNotice,
  DiceMessage,
  ErrMessage,
  GameAction,
  GameDriver,
  GameEvent,
  GameState,
  MatchEndMessage,
  MoveResultMessage,
  PlayerColor,
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
import type { OfflineMode } from './matchTypes';

export interface OfflineDriverOptions {
  mode: OfflineMode;
  numPlayers: 2 | 3 | 4;
  aiLevel: AiLevel;
  turnTimerS?: number;
  powerMode?: boolean;
  /** vs CPU: board color the human picked for seat 0 (layout rotates). */
  seatZeroColor?: PlayerColor;
  /** vs CPU POWER: the human's owned power quantities (shop model). */
  humanLoadout?: Readonly<Partial<Record<PowerType, number>>>;
}

const CPU_DELAY_MIN_MS = 600;
const CPU_DELAY_MAX_MS = 1000;
/** Sprint contract: offline turns give 30s (server default is 15s). */
const OFFLINE_TURN_TIMER_S = 30;

export class OfflineDriver implements GameDriver {
  onDice?: (msg: DiceMessage) => void;
  onMove?: (msg: MoveResultMessage) => void;
  onTurn?: (msg: TurnMessage) => void;
  onTurnSkipped?: (msg: TurnSkippedMessage) => void;
  onCapture?: (notice: CaptureNotice) => void;
  onMatchEnd?: (msg: MatchEndMessage) => void;
  onPlayerStatus?: (msg: PlayerStatusMessage) => void;
  onError?: (msg: ErrMessage) => void;
  onTokenSpawned?: (msg: TokenSpawnedMessage) => void;
  onTokenCollected?: (msg: TokenCollectedMessage) => void;
  onPowerUsed?: (msg: PowerUsedMessage) => void;
  onTrapTriggered?: (msg: TrapTriggeredMessage) => void;
  /** vs CPU shop model: the human spent a charge → burn one OWNED unit. */
  onConsumePower?: (power: PowerType) => void;

  private state: GameState;
  private readonly mode: OfflineMode;
  private readonly aiLevel: AiLevel;
  private cpuTimer = 0;
  private humanTimer = 0;
  private destroyed = false;

  constructor(options: OfflineDriverOptions) {
    this.mode = options.mode;
    this.aiLevel = options.aiLevel;
    const powerMode = options.powerMode ?? false;
    // Hybrid economy (mirrors online): the classic four keep dropping on the
    // board for everyone; the BATTLE set is seeded from the shop inventory
    // (human) / the difficulty loadout (CPU). Pass & play stays drops-only
    // (several guests share one device — consuming items would be unfair).
    const inventoryModel = powerMode && options.mode === 'cpu';
    this.state = createGame({
      numPlayers: options.numPlayers,
      turnTimerS: options.turnTimerS ?? OFFLINE_TURN_TIMER_S,
      powerMode,
      seatZeroColor: options.seatZeroColor,
      initialCharges: inventoryModel
        ? Array.from({ length: options.numPlayers }, (_, seat) =>
            seat === 0 ? options.humanLoadout ?? {} : AI_POWER_LOADOUTS[options.aiLevel],
          )
        : undefined,
    });
  }

  /** Defensive copy for initial scene setup (seats, colors, pieces). */
  snapshot(): GameState {
    return cloneState(this.state);
  }

  get turnTimerS(): number {
    return this.state.config.turnTimerS;
  }

  isHumanSeat(seat: Seat): boolean {
    return this.mode === 'local' || seat === 0;
  }

  start(): void {
    this.apply({ type: 'START', now: Date.now() });
  }

  requestRoll(): void {
    if (!this.isHumanSeat(this.state.currentSeat) || this.state.turnPhase !== 'wait_roll') return;
    this.apply({
      type: 'ROLL',
      seat: this.state.currentSeat,
      dice: secureDie(),
      // A pending double consumes a second die; harmless extra otherwise.
      dice2: this.state.pendingRoll?.kind === 'double' ? secureDie() : undefined,
      now: Date.now(),
    });
  }

  usePower(
    power: PowerType,
    opts: { face?: number; pieceId?: number; targetSeat?: Seat; cell?: number } = {},
  ): void {
    if (!this.isHumanSeat(this.state.currentSeat) || this.state.turnPhase !== 'wait_roll') return;
    this.apply({
      type: 'USE_POWER',
      seat: this.state.currentSeat,
      power,
      face: opts.face,
      pieceId: opts.pieceId,
      targetSeat: opts.targetSeat,
      cell: opts.cell,
      now: Date.now(),
    });
  }

  requestMove(pieceId: number): void {
    if (!this.isHumanSeat(this.state.currentSeat) || this.state.turnPhase !== 'wait_move') return;
    this.apply({ type: 'MOVE', seat: this.state.currentSeat, pieceId, now: Date.now() });
  }

  sendEmote(_emoteId: number): void {
    // Nobody to broadcast to offline; the scene renders its own bubble.
  }

  /** vs CPU always forfeits the human seat; pass & play the seat at hand. */
  forfeit(): void {
    const seat = this.mode === 'cpu' ? 0 : this.state.currentSeat;
    const player = this.state.players.find((p) => p.seat === seat);
    if (!player || player.forfeited || player.place > 0) return;
    this.apply({ type: 'FORFEIT', seat, now: Date.now() });
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
  }

  // -------------------------------------------------------------------------

  private apply(action: GameAction): void {
    let result: ApplyResult;
    try {
      result = applyAction(this.state, action);
    } catch (err) {
      if (err instanceof IllegalActionError) {
        this.onError?.({ code: err.code, msg: err.message });
        return;
      }
      throw err;
    }
    this.state = result.state;
    this.dispatch(result.events);
    this.scheduleNext();
  }

  /** Engine events → protocol callbacks, in server emission order (§6.5). */
  private dispatch(events: GameEvent[]): void {
    const pendingCaptures: CaptureNotice[] = [];
    let enteredWaitMove = false;

    for (const ev of events) {
      switch (ev.type) {
        case 'DICE_ROLLED':
          this.onDice?.({
            seat: ev.seat,
            value: ev.value,
            legalPieceIds: ev.legalPieceIds,
            extraTurn: ev.extraTurn,
            parts: ev.parts,
            picked: ev.picked,
          });
          if (ev.legalPieceIds.length > 0) enteredWaitMove = true;
          break;
        case 'TOKEN_SPAWNED':
          this.onTokenSpawned?.({ cell: ev.cell, power: ev.power });
          break;
        case 'TOKEN_COLLECTED':
          this.onTokenCollected?.({
            seat: ev.seat,
            cell: ev.cell,
            power: ev.power,
            charges: ev.charges,
          });
          break;
        case 'POWER_USED':
          this.onPowerUsed?.({
            seat: ev.seat,
            power: ev.power,
            face: ev.face,
            pieceId: ev.pieceId,
            targetSeat: ev.targetSeat,
            cell: ev.cell,
          });
          // Only BATTLE powers burn an owned unit through the API (classic
          // charges come from board drops; the scene wires onConsumePower).
          if (ev.seat === 0 && this.mode === 'cpu' && BATTLE_POWERS.has(ev.power)) {
            this.onConsumePower?.(ev.power);
          }
          break;
        case 'TRAP_TRIGGERED':
          this.onTrapTriggered?.({
            seat: ev.seat,
            victimSeat: ev.victimSeat,
            victimPieceId: ev.victimPieceId,
            cell: ev.cell,
            blocked: ev.blocked,
          });
          break;
        case 'CAPTURE':
          // The engine emits CAPTURE before PIECE_MOVED; the protocol sends
          // moveResult first — buffer and flush after onMove.
          pendingCaptures.push({
            bySeat: ev.seat,
            byPieceId: ev.pieceId,
            victimSeat: ev.victimSeat,
            victimPieceId: ev.victimPieceId,
            cell: ev.cell,
          });
          break;
        case 'PIECE_MOVED': {
          const first = pendingCaptures[0];
          this.onMove?.({
            seat: ev.seat,
            pieceId: ev.pieceId,
            path: ev.path,
            captured: first ? { seat: first.victimSeat, pieceId: first.victimPieceId } : undefined,
            reachedHome: ev.reachedHome,
            extraTurn: events.some((e) => e.type === 'EXTRA_TURN' && e.seat === ev.seat),
            teleport: ev.teleport,
          });
          while (pendingCaptures.length > 0) {
            const cap = pendingCaptures.shift();
            if (cap) this.onCapture?.(cap);
          }
          break;
        }
        case 'TURN_SKIPPED':
          this.onTurnSkipped?.({ seat: ev.seat, reason: ev.reason });
          break;
        case 'TURN_CHANGED':
          this.onTurn?.({
            seat: ev.seat,
            deadline: this.state.turnDeadline,
            phase: ev.turnPhase === 'wait_roll' ? 'roll' : 'move',
          });
          break;
        case 'MATCH_ENDED':
          this.onMatchEnd?.({
            ranking: ev.ranking.map((r) => ({ ...r, coinsDelta: 0, xpEarned: 0 })),
            potTotal: 0,
          });
          break;
        default:
          // MATCH_STARTED / EXTRA_TURN / PLAYER_* have no protocol mirror.
          break;
      }
    }

    // §6.5: the server also emits `turn` for the move sub-phase (the roll
    // reset the deadline); mirror it so the timer ring restarts.
    if (enteredWaitMove && this.state.phase === 'playing' && this.state.turnPhase === 'wait_move') {
      this.onTurn?.({
        seat: this.state.currentSeat,
        deadline: this.state.turnDeadline,
        phase: 'move',
      });
    }
  }

  private scheduleNext(): void {
    this.clearTimers();
    if (this.destroyed || this.state.phase !== 'playing') return;
    const seat = this.state.currentSeat;
    if (!this.isHumanSeat(seat)) {
      const delay = CPU_DELAY_MIN_MS + Math.random() * (CPU_DELAY_MAX_MS - CPU_DELAY_MIN_MS);
      this.cpuTimer = window.setTimeout(() => this.cpuAct(), delay);
    } else {
      const wait = Math.max(250, this.state.turnDeadline - Date.now());
      this.humanTimer = window.setTimeout(() => this.humanTimeout(), wait);
    }
  }

  private cpuAct(): void {
    if (this.destroyed || this.state.phase !== 'playing') return;
    const seat = this.state.currentSeat;
    if (this.isHumanSeat(seat)) return;
    if (this.state.turnPhase === 'wait_roll') {
      // POWER: spend at most one charge before rolling (simple heuristics).
      if (this.state.config.powerMode && !this.state.pendingRoll && this.cpuUsePower(seat)) {
        return; // apply() rescheduled us; the roll comes on the next tick
      }
      this.apply({
        type: 'ROLL',
        seat,
        dice: secureDie(),
        dice2: this.state.pendingRoll?.kind === 'double' ? secureDie() : undefined,
        auto: true,
        now: Date.now(),
      });
      return;
    }
    const pieceId = pickMove(this.aiLevel, this.state, this.state.dice);
    if (pieceId === null) return; // unreachable: wait_move implies ≥1 legal move
    this.apply({ type: 'MOVE', seat, pieceId, auto: true, now: Date.now() });
  }

  /**
   * CPU power heuristics, in priority order. Returns true when a power was
   * played (the engine keeps the CPU in wait_roll; scheduleNext re-arms).
   */
  private cpuUsePower(seat: Seat): boolean {
    const ch = this.state.charges[seat];
    if (!ch) return false;
    const color = this.state.players.find((p) => p.seat === seat)?.color;
    if (!color) return false;
    const mine = this.state.pieces.filter((p) => p.seat === seat);

    // 1) plus: a piece one step from HOME banks a sure point.
    if (ch.plus > 0) {
      const atDoor = mine.find((p) => p.steps === 56);
      if (atDoor) {
        this.apply({ type: 'USE_POWER', seat, power: 'plus', pieceId: atDoor.pieceId, now: Date.now() });
        return true;
      }
    }
    // 2) shield: protect the most advanced ring piece under threat.
    if (ch.shield > 0) {
      const threatened = mine
        .filter((p) => isOnTrack(p.steps) && !isShielded(this.state, seat, p.pieceId))
        .filter((p) => {
          const abs = toAbsoluteCell(color, p.steps);
          return abs !== null && isCellThreatened(this.state, seat, abs);
        })
        .sort((a, b) => b.steps - a.steps)[0];
      if (threatened) {
        this.apply({ type: 'USE_POWER', seat, power: 'shield', pieceId: threatened.pieceId, now: Date.now() });
        return true;
      }
    }
    // 3) bolt: knock back the enemy closest to finishing (steps ≥ 38).
    if (ch.bolt > 0) {
      const target = this.state.pieces
        .filter((p) => p.seat !== seat && isOnTrack(p.steps) && p.steps >= 38)
        .filter((p) => !isShielded(this.state, p.seat, p.pieceId))
        .sort((a, b) => b.steps - a.steps)[0];
      if (target) {
        this.apply({
          type: 'USE_POWER', seat, power: 'bolt',
          targetSeat: target.seat, pieceId: target.pieceId, now: Date.now(),
        });
        return true;
      }
    }
    // 4) freeze: stall the most advanced enemy piece (steps ≥ 30).
    if (ch.freeze > 0) {
      const target = this.state.pieces
        .filter((p) => p.seat !== seat && p.steps >= 30 && p.steps < 57)
        .filter(
          (p) =>
            !isShielded(this.state, p.seat, p.pieceId) &&
            !isFrozen(this.state, p.seat, p.pieceId),
        )
        .sort((a, b) => b.steps - a.steps)[0];
      if (target) {
        this.apply({
          type: 'USE_POWER', seat, power: 'freeze',
          targetSeat: target.seat, pieceId: target.pieceId, now: Date.now(),
        });
        return true;
      }
    }
    // 5) bomb: mine the cell ~7 ahead of the most advanced enemy ring piece
    //    (their most probable landing zone).
    if (ch.bomb > 0) {
      const enemy = this.state.pieces
        .filter((p) => p.seat !== seat && isOnTrack(p.steps) && p.steps <= 43)
        .sort((a, b) => b.steps - a.steps)[0];
      if (enemy) {
        const enemyColor = this.state.players.find((p) => p.seat === enemy.seat)?.color;
        const abs = enemyColor ? toAbsoluteCell(enemyColor, enemy.steps) : null;
        if (abs !== null) {
          for (const ahead of [7, 6, 8, 5, 9]) {
            const cell = (abs + ahead) % TRACK_SIZE;
            if (isSafeCell(cell)) continue;
            if (this.state.traps.some((tr) => tr.cell === cell)) continue;
            const occupied = this.state.pieces.some((p) => {
              if (!isOnTrack(p.steps)) return false;
              const c = this.state.players.find((pl) => pl.seat === p.seat)?.color;
              return c !== undefined && toAbsoluteCell(c, p.steps) === cell;
            });
            if (occupied) continue;
            this.apply({ type: 'USE_POWER', seat, power: 'bomb', cell, now: Date.now() });
            return true;
          }
        }
      }
    }
    // 6) portal: rescue a threatened ring piece to the next safe cell.
    if (ch.portal > 0) {
      const runner = mine
        .filter((p) => isOnTrack(p.steps) && p.steps <= 42)
        .filter((p) => {
          const abs = toAbsoluteCell(color, p.steps);
          return abs !== null && isCellThreatened(this.state, seat, abs);
        })
        .sort((a, b) => b.steps - a.steps)[0];
      if (runner) {
        try {
          this.apply({
            type: 'USE_POWER', seat, power: 'portal',
            pieceId: runner.pieceId, now: Date.now(),
          });
          return true;
        } catch {
          /* no safe cell ahead — fall through to the next option */
        }
      }
    }
    // 7) pick a six when everything is stuck in base.
    if (ch.pick > 0 && mine.every((p) => p.steps < 0 || p.steps === 57)) {
      this.apply({ type: 'USE_POWER', seat, power: 'pick', face: 6, now: Date.now() });
      return true;
    }
    // 8) double: race the endgame when nothing is left in base.
    if (ch.double > 0 && mine.every((p) => p.steps >= 0)) {
      this.apply({ type: 'USE_POWER', seat, power: 'double', now: Date.now() });
      return true;
    }
    return false;
  }

  private humanTimeout(): void {
    if (this.destroyed || this.state.phase !== 'playing') return;
    this.apply({
      type: 'TIMEOUT',
      dice: this.state.turnPhase === 'wait_roll' ? secureDie() : undefined,
      rng: Math.random(),
      now: Date.now(),
    });
  }

  private clearTimers(): void {
    if (this.cpuTimer) window.clearTimeout(this.cpuTimer);
    if (this.humanTimer) window.clearTimeout(this.humanTimer);
    this.cpuTimer = 0;
    this.humanTimer = 0;
  }
}

/** Uniform 1-6 from the platform CSPRNG (rejection sampling, no mod bias). */
function secureDie(): number {
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0];
    if (v !== undefined && v < 252) return (v % 6) + 1;
  }
}
