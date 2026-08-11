/**
 * Match state machine (ARQUITECTURA §5.3) — a pure, deterministic reducer.
 *
 * `applyAction(state, action)` is the ONLY source of transitions. It never
 * mutates its input, never touches a clock and never rolls dice: the caller
 * injects dice values (server: crypto.randomInt · offline: Math.random ·
 * tests: scripted sequences) and, optionally, `now` for turn deadlines.
 * The server runs it as authority; the client runs the same compiled code
 * for offline play and move previews — zero rule divergence.
 */
import {
  BASE_STEPS,
  BOLT_KNOCKBACK,
  DEFAULT_RULES,
  DEFAULT_TURN_TIMER_S,
  HOME_STEPS,
  LAST_TRACK_STEP,
  MAX_CONSECUTIVE_SIXES,
  PIECES_PER_PLAYER,
  POWER_CHARGE_CAP,
  POWER_INITIAL_TOKENS,
  POWER_MATCH_CAP,
  POWER_MAX_TOKENS,
  POWER_SPAWN_PCT,
  POWER_TYPES,
  POWER_WEIGHTS,
  TRACK_SIZE,
} from '../constants.js';
import { isOnTrack, isSafeCell, seatColors, toAbsoluteCell } from './board.js';
import { describeMove, enemyPiecesOnCell, getPiece, getPlayer, hasWon, isFrozen, isShielded, legalMoves } from './rules.js';
import { easyMove } from './ai/easy.js';
import { ERR, IllegalActionError } from '../protocol/errors.js';
import type {
  ApplyResult,
  ExtraTurnReason,
  GameAction,
  GameConfig,
  GameEvent,
  GameState,
  MoveDescriptor,
  PieceState,
  PlayerColor,
  PlayerState,
  PowerType,
  RuleFlags,
  Seat,
  TurnPhase,
} from '../types.js';

export interface CreateGameOptions {
  numPlayers: 2 | 3 | 4;
  rules?: Partial<RuleFlags>;
  turnTimerS?: number;
  startingSeat?: Seat;
  powerMode?: boolean;
  /** POWER: keep the legacy on-board token drops (default true). */
  tokenDrops?: boolean;
  /**
   * POWER inventory model: per-seat loadout the match opens with; every
   * count is clamped to POWER_MATCH_CAP. Missing seats start empty.
   */
  initialCharges?: ReadonlyArray<Readonly<Partial<Record<PowerType, number>>> | undefined>;
  /** Board color for seat 0 — the layout rotates so the spread is intact. */
  seatZeroColor?: PlayerColor;
}

/** Build a fresh match in LOBBY. All pieces start in BASE. */
/** A zeroed per-match charge counter covering every power type. */
function emptyCharges(): Record<PowerType, number> {
  const c = {} as Record<PowerType, number>;
  for (const p of POWER_TYPES) c[p] = 0;
  return c;
}

/** Per-match charges from an inventory loadout, clamped to POWER_MATCH_CAP. */
function seedCharges(
  loadout?: Readonly<Partial<Record<PowerType, number>>>,
): Record<PowerType, number> {
  const c = emptyCharges();
  if (!loadout) return c;
  for (const p of POWER_TYPES) {
    const qty = Math.floor(loadout[p] ?? 0);
    if (qty > 0) c[p] = Math.min(POWER_MATCH_CAP, qty);
  }
  return c;
}

export function createGame(options: CreateGameOptions): GameState {
  const startingSeat = options.startingSeat ?? 0;
  if (startingSeat >= options.numPlayers) {
    throw new RangeError(`startingSeat ${startingSeat} out of range for ${options.numPlayers} players`);
  }
  const config: GameConfig = {
    numPlayers: options.numPlayers,
    rules: { ...DEFAULT_RULES, ...options.rules },
    turnTimerS: options.turnTimerS ?? DEFAULT_TURN_TIMER_S,
    startingSeat,
    powerMode: options.powerMode ?? false,
    tokenDrops: options.tokenDrops ?? true,
  };
  const players: PlayerState[] = seatColors(options.numPlayers, options.seatZeroColor).map((color, i) => ({
    seat: i as Seat,
    color,
    place: 0,
    forfeited: false,
    timeoutStrikes: 0,
  }));
  const pieces: PieceState[] = players.flatMap((p) =>
    Array.from({ length: PIECES_PER_PLAYER }, (_, pieceId): PieceState => ({
      seat: p.seat,
      pieceId,
      steps: BASE_STEPS,
    })),
  );
  return {
    phase: 'lobby',
    turnPhase: 'wait_roll',
    config,
    players,
    pieces,
    currentSeat: startingSeat,
    dice: 0,
    diceParts: null,
    consecutiveSixes: 0,
    turnDeadline: 0,
    winnerOrder: [],
    rngLog: [],
    tokens: [],
    traps: [],
    frozen: [],
    charges: players.map((p) => seedCharges(options.initialCharges?.[p.seat])),
    shields: [],
    pendingRoll: null,
  };
}

/** Structural clone of a GameState (fast, dependency-free). */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    config: { ...s.config, rules: { ...s.config.rules } },
    players: s.players.map((p) => ({ ...p })),
    pieces: s.pieces.map((p) => ({ ...p })),
    winnerOrder: [...s.winnerOrder],
    rngLog: [...s.rngLog],
    diceParts: s.diceParts ? [s.diceParts[0], s.diceParts[1]] : null,
    tokens: s.tokens.map((t) => ({ ...t })),
    charges: s.charges.map((c) => ({ ...c })),
    shields: s.shields.map((sh) => ({ ...sh })),
    traps: s.traps.map((tr) => ({ ...tr })),
    frozen: s.frozen.map((f) => ({ ...f })),
    pendingRoll: s.pendingRoll ? { ...s.pendingRoll } : null,
  };
}

/**
 * Apply one action and return the next state plus the events it produced.
 * Throws IllegalActionError on invalid actions; the input state is never
 * modified either way.
 */
export function applyAction(state: GameState, action: GameAction): ApplyResult {
  const next = cloneState(state);
  const events: GameEvent[] = [];
  switch (action.type) {
    case 'START':
      doStart(next, action, events);
      break;
    case 'ROLL':
      doRoll(next, action, events);
      break;
    case 'MOVE':
      doMove(next, action, events);
      break;
    case 'TIMEOUT':
      doTimeout(next, action, events);
      break;
    case 'FORFEIT':
      doForfeit(next, action, events);
      break;
    case 'USE_POWER':
      doUsePower(next, action, events);
      break;
  }
  return { state: next, events };
}

// ---------------------------------------------------------------------------
// Action handlers (mutate the fresh clone only)
// ---------------------------------------------------------------------------

function doStart(next: GameState, action: { now?: number }, events: GameEvent[]): void {
  if (next.phase !== 'lobby') {
    throw new IllegalActionError(ERR.BAD_PHASE, 'match already started');
  }
  next.phase = 'playing';
  next.turnPhase = 'wait_roll';
  setDeadline(next, action.now);
  events.push({ type: 'MATCH_STARTED', startingSeat: next.currentSeat });
  // POWER legacy economy: the board opens with a few tokens in play.
  // Inventory-model matches (tokenDrops off) start with a clean ring.
  if (next.config.powerMode && next.config.tokenDrops) {
    for (let i = 0; i < POWER_INITIAL_TOKENS; i++) maybeSpawnToken(next, events, true);
  }
  events.push({ type: 'TURN_CHANGED', seat: next.currentSeat, turnPhase: 'wait_roll' });
}

function doRoll(
  next: GameState,
  action: { seat: Seat; dice: number; dice2?: number; auto?: boolean; now?: number },
  events: GameEvent[],
): void {
  assertPlaying(next);
  if (next.turnPhase !== 'wait_roll') {
    throw new IllegalActionError(ERR.BAD_PHASE, 'not waiting for a roll');
  }
  if (action.seat !== next.currentSeat) {
    throw new IllegalActionError(ERR.NOT_YOUR_TURN);
  }
  // §5.4: any manual action clears the player's timeout strikes.
  if (!action.auto) getPlayer(next, action.seat).timeoutStrikes = 0;

  // POWER: an armed modifier owns this roll and is consumed by it.
  const pending = next.pendingRoll;
  if (pending?.kind === 'double') {
    if (action.dice2 === undefined) {
      throw new IllegalActionError(ERR.BAD_PHASE, 'double roll requires two injected dice');
    }
    assertDice(action.dice);
    assertDice(action.dice2);
    next.pendingRoll = null;
    resolveRoll(next, action.dice + action.dice2, events, action.now, {
      parts: [action.dice, action.dice2],
    });
    return;
  }
  if (pending?.kind === 'pick') {
    next.pendingRoll = null;
    resolveRoll(next, pending.face, events, action.now, { picked: true });
    return;
  }
  assertDice(action.dice);
  resolveRoll(next, action.dice, events, action.now);
}

function doMove(
  next: GameState,
  action: { seat: Seat; pieceId: number; auto?: boolean; now?: number },
  events: GameEvent[],
): void {
  assertPlaying(next);
  if (next.turnPhase !== 'wait_move') {
    throw new IllegalActionError(ERR.BAD_PHASE, 'not waiting for a move');
  }
  if (action.seat !== next.currentSeat) {
    throw new IllegalActionError(ERR.NOT_YOUR_TURN);
  }
  if (!action.auto) getPlayer(next, action.seat).timeoutStrikes = 0;
  const md = describeMove(next, action.seat, action.pieceId, next.dice);
  if (!md) {
    throw new IllegalActionError(ERR.ILLEGAL_MOVE, `piece ${action.pieceId} cannot move`);
  }
  performMove(next, stripDoubleSix(next, md), events, action.now);
}

/** A double totalling 6 never earns the six re-roll (see resolveRoll). */
function stripDoubleSix(next: GameState, md: MoveDescriptor): MoveDescriptor {
  if (!next.diceParts) return md;
  return {
    ...md,
    extraTurn: md.reachesHome || (md.captures.length > 0 && next.config.rules.extraTurnOnCapture),
  };
}

function doTimeout(
  next: GameState,
  action: { dice?: number; rng?: number; now?: number },
  events: GameEvent[],
): void {
  assertPlaying(next);
  const seat = next.currentSeat;
  const player = getPlayer(next, seat);
  player.timeoutStrikes += 1;
  events.push({ type: 'PLAYER_TIMEOUT', seat, strikes: player.timeoutStrikes });

  // POWER: an armed-but-unrolled modifier is refunded, not wasted — the
  // player paid a charge and got nothing for it.
  if (next.pendingRoll) {
    const ch = next.charges[seat];
    if (ch) {
      const kind = next.pendingRoll.kind === 'double' ? 'double' : 'pick';
      ch[kind] = Math.min(POWER_CHARGE_CAP, ch[kind] + 1);
    }
    next.pendingRoll = null;
  }

  if (!next.config.rules.autoMoveOnTimeout) {
    // Whatever was pending is wasted; the turn simply passes.
    events.push({ type: 'TURN_SKIPPED', seat, reason: 'timeout' });
    advanceTurn(next, events, action.now);
    return;
  }

  // §5.4 auto-move: roll for the player if needed, then play the Easy
  // heuristic on their behalf. Dice and rng stay injected — no RNG here.
  if (next.turnPhase === 'wait_roll') {
    if (action.dice === undefined) {
      throw new IllegalActionError(ERR.BAD_PHASE, 'TIMEOUT during wait_roll requires an injected dice value');
    }
    assertDice(action.dice);
    resolveRoll(next, action.dice, events, action.now);
    // resolveRoll mutates turnPhase; assert past TS narrowing before re-checking.
    if ((next.turnPhase as TurnPhase) !== 'wait_move' || next.phase !== 'playing') return; // roll was skipped
  }

  const moves = legalMoves(next, seat, next.dice);
  const rngValue = action.rng ?? 0.5;
  const md = easyMove(moves, () => rngValue);
  if (!md) {
    // Unreachable in practice: wait_move is only entered with ≥1 legal move.
    events.push({ type: 'TURN_SKIPPED', seat, reason: 'timeout' });
    advanceTurn(next, events, action.now);
    return;
  }
  performMove(next, stripDoubleSix(next, md), events, action.now);
}

function doForfeit(next: GameState, action: { seat: Seat; now?: number }, events: GameEvent[]): void {
  assertPlaying(next);
  const player = getPlayer(next, action.seat);
  if (player.forfeited || player.place > 0) {
    throw new IllegalActionError(ERR.BAD_PHASE, 'player is not active');
  }
  player.forfeited = true;
  // §6.7: the seat's pieces are retired from the board.
  for (const piece of next.pieces) {
    if (piece.seat === action.seat) piece.steps = BASE_STEPS;
  }
  // Retired pieces drop their domes — and their freeze marks — with them.
  next.shields = next.shields.filter((s) => s.seat !== action.seat);
  next.frozen = next.frozen.filter((f) => f.seat !== action.seat);
  // Forfeits fill places from the bottom up (last available position).
  const forfeitCount = next.players.filter((p) => p.forfeited).length;
  player.place = next.config.numPlayers - forfeitCount + 1;
  events.push({ type: 'PLAYER_FORFEITED', seat: action.seat, place: player.place });

  if (checkMatchEnd(next, events)) return;
  if (next.currentSeat === action.seat) advanceTurn(next, events, action.now);
}

// ---------------------------------------------------------------------------
// Shared transitions
// ---------------------------------------------------------------------------

interface RollMod {
  parts?: [number, number];
  picked?: boolean;
}

function resolveRoll(
  next: GameState,
  dice: number,
  events: GameEvent[],
  now?: number,
  mod?: RollMod,
): void {
  const seat = next.currentSeat;
  if (mod?.parts) next.rngLog.push(mod.parts[0], mod.parts[1]);
  else next.rngLog.push(dice);
  // Only NATURAL single-die rolls feed the six streak: a picked face is not
  // luck and a double is a composite value — neither pays the §5.2.6 tax
  // (nor resets it; the streak freezes across modified rolls).
  if (!mod) {
    if (dice === 6) next.consecutiveSixes += 1;
    else next.consecutiveSixes = 0;
  }

  // §5.2.6: the third consecutive six forfeits the turn on the spot — the
  // roll is never played and the counter resets with the turn change.
  if (
    !mod &&
    dice === 6 &&
    next.config.rules.tripleSixForfeit &&
    next.consecutiveSixes >= MAX_CONSECUTIVE_SIXES
  ) {
    events.push({ type: 'DICE_ROLLED', seat, value: dice, legalPieceIds: [], extraTurn: false });
    events.push({ type: 'TURN_SKIPPED', seat, reason: 'triple_six' });
    maybeSpawnToken(next, events);
    advanceTurn(next, events, now);
    return;
  }

  let moves = legalMoves(next, seat, dice);
  // A double totalling 6 moves like a six but does NOT earn the six re-roll
  // (capture/home extra turns still apply).
  if (mod?.parts) {
    moves = moves.map((m) => ({
      ...m,
      extraTurn: m.reachesHome || (m.captures.length > 0 && next.config.rules.extraTurnOnCapture),
    }));
  }
  if (moves.length === 0) {
    // §5.2.7: no legal moves — the turn passes automatically (even on a six).
    events.push({
      type: 'DICE_ROLLED',
      seat,
      value: dice,
      legalPieceIds: [],
      extraTurn: false,
      parts: mod?.parts,
      picked: mod?.picked,
    });
    events.push({ type: 'TURN_SKIPPED', seat, reason: 'no_moves' });
    maybeSpawnToken(next, events);
    advanceTurn(next, events, now);
    return;
  }

  next.dice = dice;
  next.diceParts = mod?.parts ?? null;
  next.turnPhase = 'wait_move';
  setDeadline(next, now);
  events.push({
    type: 'DICE_ROLLED',
    seat,
    value: dice,
    legalPieceIds: moves.map((m) => m.pieceId),
    extraTurn: mod?.parts ? false : dice === 6,
    parts: mod?.parts,
    picked: mod?.picked,
  });
  maybeSpawnToken(next, events);
}

function performMove(next: GameState, md: MoveDescriptor, events: GameEvent[], now?: number): void {
  const seat = md.seat;
  const mover = getPlayer(next, seat);

  if (md.captures.length > 0) {
    // Captures only happen on the ring, so the absolute cell always resolves.
    const cell = toAbsoluteCell(mover.color, md.to);
    for (const cap of md.captures) {
      getPiece(next, cap.seat, cap.pieceId).steps = BASE_STEPS;
      events.push({
        type: 'CAPTURE',
        seat,
        pieceId: md.pieceId,
        victimSeat: cap.seat,
        victimPieceId: cap.pieceId,
        cell: cell ?? -1,
      });
    }
  }

  getPiece(next, seat, md.pieceId).steps = md.to;
  events.push({
    type: 'PIECE_MOVED',
    seat,
    pieceId: md.pieceId,
    from: md.from,
    to: md.to,
    path: md.path,
    reachedHome: md.reachesHome,
  });
  collectToken(next, seat, md.to, events);
  triggerTrapAt(next, seat, md.pieceId, events);
  if (md.reachesHome) {
    next.shields = next.shields.filter((s) => !(s.seat === seat && s.pieceId === md.pieceId));
  }

  let finishedNow = false;
  if (md.reachesHome && hasWon(next, seat)) {
    next.winnerOrder.push(seat);
    mover.place = next.winnerOrder.length;
    events.push({ type: 'PLAYER_FINISHED', seat, place: mover.place });
    finishedNow = true;
  }

  next.dice = 0;
  next.diceParts = null;
  if (checkMatchEnd(next, events)) return;

  if (finishedNow) {
    // A finished player cannot use an earned extra turn.
    advanceTurn(next, events, now);
    return;
  }

  if (md.extraTurn) {
    const reasons: ExtraTurnReason[] = [];
    if (md.dice === 6) reasons.push('six');
    if (md.captures.length > 0 && next.config.rules.extraTurnOnCapture) reasons.push('capture');
    if (md.reachesHome) reasons.push('home');
    next.turnPhase = 'wait_roll';
    setDeadline(next, now);
    // consecutiveSixes deliberately survives the extra turn — that streak is
    // exactly what the triple-six rule counts (§5.2.6).
    events.push({ type: 'EXTRA_TURN', seat, reasons });
    events.push({ type: 'TURN_CHANGED', seat, turnPhase: 'wait_roll' });
    return;
  }

  advanceTurn(next, events, now);
}

function advanceTurn(next: GameState, events: GameEvent[], now?: number): void {
  next.dice = 0;
  next.diceParts = null;
  next.consecutiveSixes = 0;
  next.pendingRoll = null;
  next.turnPhase = 'wait_roll';
  // POWER freeze lifetime: the frozen piece sat out this owner turn — thaw
  // as the turn passes on (one full turn lost, exactly).
  const ending = next.currentSeat;
  next.frozen = next.frozen
    .map((f) => (f.seat === ending ? { ...f, remaining: f.remaining - 1 } : f))
    .filter((f) => f.remaining > 0);
  next.currentSeat = nextActiveSeat(next, next.currentSeat);
  // POWER shield lifetime: a dome protects through the whole enemy round and
  // pops the moment its owner's turn comes back around.
  next.shields = next.shields.filter((s) => s.seat !== next.currentSeat);
  setDeadline(next, now);
  events.push({ type: 'TURN_CHANGED', seat: next.currentSeat, turnPhase: 'wait_roll' });
}

function nextActiveSeat(next: GameState, from: Seat): Seat {
  const n = next.config.numPlayers;
  for (let i = 1; i <= n; i++) {
    const seat = ((from + i) % n) as Seat;
    const player = getPlayer(next, seat);
    if (player.place === 0 && !player.forfeited) return seat;
  }
  // checkMatchEnd() runs before every turn change, so this cannot happen.
  throw new Error('no active seat left');
}

/**
 * §5.2.8 end condition: 2P (or playForSecond off) ends at the 1st winner;
 * 3-4P with playForSecond keeps going until 2nd place is decided. A match
 * also ends whenever at most one active player remains (finishes/forfeits).
 */
function checkMatchEnd(next: GameState, events: GameEvent[]): boolean {
  const active = next.players.filter((p) => p.place === 0 && !p.forfeited);
  const needed = next.config.numPlayers >= 3 && next.config.rules.playForSecond ? 2 : 1;
  if (next.winnerOrder.length < needed && active.length > 1) return false;

  next.phase = 'finished';
  next.turnDeadline = 0;
  next.dice = 0;
  next.diceParts = null;
  next.pendingRoll = null;

  // Winners already hold the top places and forfeits the bottom ones; the
  // survivors in between rank by board progress (most advanced first).
  const remaining = active.sort(
    (a, b) => progressOf(next, b.seat) - progressOf(next, a.seat) || a.seat - b.seat,
  );
  let place = next.winnerOrder.length;
  for (const p of remaining) {
    place += 1;
    p.place = place;
  }

  const ranking = [...next.players]
    .sort((a, b) => a.place - b.place)
    .map((p) => ({ seat: p.seat, place: p.place }));
  events.push({ type: 'MATCH_ENDED', ranking });
  return true;
}

/** Total steps advanced across the seat's pieces (BASE counts as 0). */
function progressOf(next: GameState, seat: Seat): number {
  return next.pieces
    .filter((p) => p.seat === seat)
    .reduce((sum, p) => sum + Math.max(p.steps, 0), 0);
}

// ---------------------------------------------------------------------------
// POWER mode (Ludo World parity)
// ---------------------------------------------------------------------------

function doUsePower(
  next: GameState,
  action: {
    seat: Seat;
    power: PowerType;
    face?: number;
    pieceId?: number;
    targetSeat?: Seat;
    cell?: number;
    now?: number;
  },
  events: GameEvent[],
): void {
  assertPlaying(next);
  if (!next.config.powerMode) {
    throw new IllegalActionError(ERR.BAD_PHASE, 'not a POWER match');
  }
  if (next.turnPhase !== 'wait_roll') {
    throw new IllegalActionError(ERR.BAD_PHASE, 'powers are used before rolling');
  }
  if (action.seat !== next.currentSeat) {
    throw new IllegalActionError(ERR.NOT_YOUR_TURN);
  }
  const charges = next.charges[action.seat];
  if (!charges) throw new RangeError(`unknown seat ${action.seat}`);
  if (charges[action.power] <= 0) {
    throw new IllegalActionError(ERR.ILLEGAL_MOVE, `no ${action.power} charges`);
  }
  getPlayer(next, action.seat).timeoutStrikes = 0;

  switch (action.power) {
    case 'double': {
      if (next.pendingRoll) {
        throw new IllegalActionError(ERR.BAD_PHASE, 'a roll modifier is already armed');
      }
      charges.double -= 1;
      next.pendingRoll = { kind: 'double' };
      events.push({ type: 'POWER_USED', seat: action.seat, power: 'double' });
      return;
    }
    case 'pick': {
      if (next.pendingRoll) {
        throw new IllegalActionError(ERR.BAD_PHASE, 'a roll modifier is already armed');
      }
      assertDice(action.face ?? 0);
      charges.pick -= 1;
      next.pendingRoll = { kind: 'pick', face: action.face! };
      events.push({ type: 'POWER_USED', seat: action.seat, power: 'pick', face: action.face! });
      return;
    }
    case 'shield': {
      if (action.pieceId === undefined) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'shield requires a pieceId');
      }
      const piece = getPiece(next, action.seat, action.pieceId);
      if (!isOnTrack(piece.steps)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'only ring pieces can be shielded');
      }
      if (isShielded(next, action.seat, action.pieceId)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'piece is already shielded');
      }
      charges.shield -= 1;
      next.shields.push({ seat: action.seat, pieceId: action.pieceId });
      events.push({
        type: 'POWER_USED',
        seat: action.seat,
        power: 'shield',
        pieceId: action.pieceId,
      });
      return;
    }
    case 'plus': {
      if (action.pieceId === undefined) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'plus requires a pieceId');
      }
      const md = describeMove(next, action.seat, action.pieceId, 1);
      if (!md) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'piece cannot advance one step');
      }
      charges.plus -= 1;
      events.push({
        type: 'POWER_USED',
        seat: action.seat,
        power: 'plus',
        pieceId: action.pieceId,
      });
      plusMiniMove(next, md, events, action.now);
      return;
    }
    case 'bomb': {
      const cell = action.cell;
      if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell >= TRACK_SIZE) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'bomb requires a ring cell');
      }
      if (isSafeCell(cell)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'safe cells cannot be trapped');
      }
      // Only the planter's OWN trap blocks the cell: rival traps are hidden
      // client-side, so rejecting here would leak their position. Stacked
      // rival traps coexist; the trigger pops the first hostile one.
      if (next.traps.some((tr) => tr.cell === cell && tr.seat === action.seat)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'cell already trapped');
      }
      const occupied = next.pieces.some(
        (p) => isOnTrack(p.steps) && toAbsoluteCell(getPlayer(next, p.seat).color, p.steps) === cell,
      );
      if (occupied) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'cell is occupied');
      }
      charges.bomb -= 1;
      next.traps.push({ seat: action.seat, cell });
      events.push({ type: 'POWER_USED', seat: action.seat, power: 'bomb', cell });
      return;
    }
    case 'bolt': {
      const victim = requireEnemyPiece(next, action);
      if (!isOnTrack(victim.steps)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'bolt only hits ring pieces');
      }
      if (isShielded(next, victim.seat, victim.pieceId)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'target is shielded');
      }
      charges.bolt -= 1;
      const from = victim.steps;
      const to = victim.steps >= BOLT_KNOCKBACK ? victim.steps - BOLT_KNOCKBACK : BASE_STEPS;
      victim.steps = to;
      events.push({
        type: 'POWER_USED',
        seat: action.seat,
        power: 'bolt',
        targetSeat: victim.seat,
        pieceId: victim.pieceId,
      });
      events.push({
        type: 'PIECE_MOVED',
        seat: victim.seat,
        pieceId: victim.pieceId,
        from,
        to,
        path: [to],
        reachedHome: false,
        teleport: true,
      });
      // A knocked-back piece can crash straight into an armed bomb.
      if (isOnTrack(to)) triggerTrapAt(next, victim.seat, victim.pieceId, events);
      return;
    }
    case 'freeze': {
      const victim = requireEnemyPiece(next, action);
      if (victim.steps < 0 || victim.steps === HOME_STEPS) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'freeze only hits board pieces');
      }
      if (isShielded(next, victim.seat, victim.pieceId)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'target is shielded');
      }
      if (isFrozen(next, victim.seat, victim.pieceId)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'piece is already frozen');
      }
      charges.freeze -= 1;
      next.frozen.push({ seat: victim.seat, pieceId: victim.pieceId, remaining: 1 });
      events.push({
        type: 'POWER_USED',
        seat: action.seat,
        power: 'freeze',
        targetSeat: victim.seat,
        pieceId: victim.pieceId,
      });
      return;
    }
    case 'portal': {
      if (action.pieceId === undefined) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'portal requires a pieceId');
      }
      const piece = getPiece(next, action.seat, action.pieceId);
      if (!isOnTrack(piece.steps)) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'portal only moves ring pieces');
      }
      const dest = portalDestination(next, action.seat, piece.steps);
      if (dest === null) {
        throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'no reachable safe cell ahead');
      }
      charges.portal -= 1;
      const from = piece.steps;
      piece.steps = dest;
      events.push({
        type: 'POWER_USED',
        seat: action.seat,
        power: 'portal',
        pieceId: action.pieceId,
      });
      events.push({
        type: 'PIECE_MOVED',
        seat: action.seat,
        pieceId: action.pieceId,
        from,
        to: dest,
        path: [dest],
        reachedHome: false,
        teleport: true,
      });
      collectToken(next, action.seat, dest, events);
      return;
    }
  }
}

/** bolt/freeze target guard: a LIVE enemy piece named by targetSeat+pieceId. */
function requireEnemyPiece(
  next: GameState,
  action: { seat: Seat; pieceId?: number; targetSeat?: Seat },
): PieceState {
  if (action.targetSeat === undefined || action.pieceId === undefined) {
    throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'power requires targetSeat + pieceId');
  }
  if (action.targetSeat === action.seat) {
    throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'cannot target your own piece');
  }
  const player = getPlayer(next, action.targetSeat);
  if (player.forfeited || player.place > 0) {
    throw new IllegalActionError(ERR.ILLEGAL_MOVE, 'target player is not active');
  }
  return getPiece(next, action.targetSeat, action.pieceId);
}

/**
 * The bomb's fuse: landing on an enemy trap sends the piece home, unless a
 * shield absorbs the blast. Trap AND shield are consumed either way.
 */
function triggerTrapAt(next: GameState, seat: Seat, pieceId: number, events: GameEvent[]): void {
  const piece = getPiece(next, seat, pieceId);
  if (!isOnTrack(piece.steps)) return;
  const abs = toAbsoluteCell(getPlayer(next, seat).color, piece.steps);
  if (abs === null) return;
  const idx = next.traps.findIndex((tr) => tr.cell === abs && tr.seat !== seat);
  if (idx < 0) return;
  const trap = next.traps[idx]!;
  next.traps.splice(idx, 1);
  const blocked = isShielded(next, seat, pieceId);
  if (blocked) {
    next.shields = next.shields.filter((s) => !(s.seat === seat && s.pieceId === pieceId));
  } else {
    piece.steps = BASE_STEPS;
  }
  events.push({
    type: 'TRAP_TRIGGERED',
    seat: trap.seat,
    victimSeat: seat,
    victimPieceId: pieceId,
    cell: abs,
    blocked,
  });
}

/**
 * Portal target: the nearest SAFE ring cell strictly ahead on the ring
 * (never past step 50), skipping cells walled by two enemy pieces.
 */
function portalDestination(next: GameState, seat: Seat, steps: number): number | null {
  const color = getPlayer(next, seat).color;
  for (let s = steps + 1; s <= LAST_TRACK_STEP; s++) {
    const abs = toAbsoluteCell(color, s);
    if (abs === null || !isSafeCell(abs)) continue;
    if (next.config.rules.blockEnabled) {
      const perSeat = new Map<Seat, number>();
      for (const e of enemyPiecesOnCell(next, seat, abs)) {
        perSeat.set(e.seat, (perSeat.get(e.seat) ?? 0) + 1);
      }
      if ([...perSeat.values()].some((n) => n >= 2)) continue;
    }
    return s;
  }
  return null;
}

/**
 * The +1 power: a one-cell bonus move DURING the roll phase — the player
 * still rolls afterwards. Captures and exact-home apply like a normal move
 * but no extra-turn logic runs (there is no turn to duplicate).
 */
function plusMiniMove(next: GameState, md: MoveDescriptor, events: GameEvent[], now?: number): void {
  const seat = md.seat;
  const mover = getPlayer(next, seat);

  if (md.captures.length > 0) {
    const cell = toAbsoluteCell(mover.color, md.to);
    for (const cap of md.captures) {
      getPiece(next, cap.seat, cap.pieceId).steps = BASE_STEPS;
      events.push({
        type: 'CAPTURE',
        seat,
        pieceId: md.pieceId,
        victimSeat: cap.seat,
        victimPieceId: cap.pieceId,
        cell: cell ?? -1,
      });
    }
  }

  getPiece(next, seat, md.pieceId).steps = md.to;
  events.push({
    type: 'PIECE_MOVED',
    seat,
    pieceId: md.pieceId,
    from: md.from,
    to: md.to,
    path: md.path,
    reachedHome: md.reachesHome,
  });
  collectToken(next, seat, md.to, events);
  triggerTrapAt(next, seat, md.pieceId, events);
  if (md.reachesHome) {
    next.shields = next.shields.filter((s) => !(s.seat === seat && s.pieceId === md.pieceId));
  }

  if (md.reachesHome && hasWon(next, seat)) {
    next.winnerOrder.push(seat);
    mover.place = next.winnerOrder.length;
    events.push({ type: 'PLAYER_FINISHED', seat, place: mover.place });
    if (checkMatchEnd(next, events)) return;
    // The finisher cannot roll anymore — the turn moves on.
    advanceTurn(next, events, now);
    return;
  }

  // Still this seat's roll phase; refresh the clock for the decision.
  setDeadline(next, now);
}

/**
 * Landing on a token collects it into the mover's charges (capped — excess
 * pickups are wasted, Ludo World behavior).
 */
function collectToken(next: GameState, seat: Seat, steps: number, events: GameEvent[]): void {
  if (!next.config.powerMode || !isOnTrack(steps)) return;
  const abs = toAbsoluteCell(getPlayer(next, seat).color, steps);
  if (abs === null) return;
  const idx = next.tokens.findIndex((t) => t.cell === abs);
  if (idx < 0) return;
  const token = next.tokens[idx]!;
  next.tokens.splice(idx, 1);
  const charges = next.charges[seat];
  if (!charges) return;
  charges[token.power] = Math.min(POWER_CHARGE_CAP, charges[token.power] + 1);
  events.push({
    type: 'TOKEN_COLLECTED',
    seat,
    cell: token.cell,
    power: token.power,
    charges: charges[token.power],
  });
}

/**
 * Deterministic drop: no RNG is injected for spawns — a small integer hash
 * of the rng log decides, so replaying the action log reproduces the exact
 * same board (same audit property as the dice, §5.5).
 */
function maybeSpawnToken(next: GameState, events: GameEvent[], force = false): void {
  if (!next.config.powerMode || !next.config.tokenDrops) return;
  if (next.tokens.length >= POWER_MAX_TOKENS) return;
  if (!force && powerHash(next, 1) % 100 >= POWER_SPAWN_PCT) return;

  const free: number[] = [];
  for (let cell = 0; cell < TRACK_SIZE; cell++) {
    if (isSafeCell(cell)) continue;
    if (next.tokens.some((t) => t.cell === cell)) continue;
    const occupied = next.pieces.some((p) => {
      if (!isOnTrack(p.steps)) return false;
      return toAbsoluteCell(getPlayer(next, p.seat).color, p.steps) === cell;
    });
    if (!occupied) free.push(cell);
  }
  if (free.length === 0) return;

  const cell = free[powerHash(next, 2 + next.tokens.length) % free.length]!;
  const roll = powerHash(next, 3 + cell) % 100;
  let acc = 0;
  let power: PowerType = 'plus';
  for (const entry of POWER_WEIGHTS) {
    acc += entry.w;
    if (roll < acc) {
      power = entry.power;
      break;
    }
  }
  next.tokens.push({ cell, power });
  events.push({ type: 'TOKEN_SPAWNED', cell, power });
}

/** Tiny integer hash over the rng log tail — deterministic, well-mixed. */
function powerHash(next: GameState, salt: number): number {
  let h = 0x50575231 ^ Math.imul(salt, 0x9e3779b1);
  const log = next.rngLog;
  h = Math.imul(h ^ log.length, 0x85ebca6b);
  for (let i = Math.max(0, log.length - 8); i < log.length; i++) {
    h = Math.imul(h ^ ((log[i] ?? 0) + i * 7), 0xc2b2ae35);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

function setDeadline(next: GameState, now?: number): void {
  next.turnDeadline = now !== undefined ? now + next.config.turnTimerS * 1000 : 0;
}

function assertPlaying(next: GameState): void {
  if (next.phase !== 'playing') {
    throw new IllegalActionError(ERR.BAD_PHASE, `match is ${next.phase}`);
  }
}

function assertDice(dice: number): void {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    throw new IllegalActionError(ERR.ILLEGAL_MOVE, `dice value ${dice} out of range`);
  }
}
