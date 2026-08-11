/** Shared test utilities: seeded PRNG, state builders and full-game runner. */
import { applyAction, chooseMove, createGame, ENTRY_CELLS, TRACK_SIZE } from '../src/index.js';
import type {
  AiLevel,
  ApplyResult,
  GameEvent,
  GameState,
  PlayerColor,
  RuleFlags,
  Seat,
} from '../src/index.js';

/** Deterministic PRNG (mulberry32) — plenty for property-style tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startedGame(
  numPlayers: 2 | 3 | 4,
  rules: Partial<RuleFlags> = {},
  startingSeat: Seat = 0,
): GameState {
  const game = createGame({ numPlayers, rules, startingSeat });
  return applyAction(game, { type: 'START' }).state;
}

export interface Placement {
  seat: Seat;
  pieceId: number;
  steps: number;
}

/** Test-only: clone the state with the given pieces teleported into place. */
export function withPieces(state: GameState, placements: Placement[]): GameState {
  const next = structuredClone(state);
  for (const pl of placements) {
    const piece = next.pieces.find((p) => p.seat === pl.seat && p.pieceId === pl.pieceId);
    if (!piece) throw new Error(`no piece ${pl.seat}/${pl.pieceId}`);
    piece.steps = pl.steps;
  }
  return next;
}

/**
 * Color-relative steps for a piece standing on an absolute ring cell.
 * Throws when the cell is unreachable for that color (the cell right
 * before its entry maps to steps 51, which is lane territory).
 */
export function stepsForAbs(color: PlayerColor, absCell: number): number {
  const steps = (absCell - ENTRY_CELLS[color] + TRACK_SIZE) % TRACK_SIZE;
  if (steps > 50) throw new Error(`cell ${absCell} unreachable on track for ${color}`);
  return steps;
}

export function roll(state: GameState, dice: number): ApplyResult {
  return applyAction(state, { type: 'ROLL', seat: state.currentSeat, dice });
}

export function move(state: GameState, pieceId: number): ApplyResult {
  return applyAction(state, { type: 'MOVE', seat: state.currentSeat, pieceId });
}

export function eventTypes(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

export function findEvent<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export interface FullGameResult {
  state: GameState;
  actions: number;
}

/**
 * Play a complete CPU-vs-CPU match with a seeded dice stream. Levels are
 * assigned per seat (modulo the array). Throws if the match does not
 * terminate within the action guard — that IS the liveness assertion.
 */
export function playFullGame(
  numPlayers: 2 | 3 | 4,
  levels: AiLevel[],
  seed: number,
  rules: Partial<RuleFlags> = {},
  guardLimit = 10000,
): FullGameResult {
  let state = startedGame(numPlayers, rules);
  const rand = mulberry32(seed);
  const rollDie = () => 1 + Math.floor(rand() * 6);
  let actions = 0;
  while (state.phase === 'playing') {
    if (++actions > guardLimit) throw new Error(`game did not terminate in ${guardLimit} actions`);
    if (state.turnPhase === 'wait_roll') {
      state = applyAction(state, { type: 'ROLL', seat: state.currentSeat, dice: rollDie() }).state;
    } else {
      const level = levels[state.currentSeat % levels.length];
      if (!level) throw new Error('no AI level configured');
      const md = chooseMove(state, state.currentSeat, state.dice, level, rand);
      if (!md) throw new Error('AI returned null while a move was pending');
      state = applyAction(state, { type: 'MOVE', seat: state.currentSeat, pieceId: md.pieceId })
        .state;
    }
  }
  return { state, actions };
}
