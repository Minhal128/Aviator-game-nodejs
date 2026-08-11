import { legalMoves } from '../rules.js';
import { easyMove } from './easy.js';
import { mediumMove } from './medium.js';
import { hardMove } from './hard.js';
import type { AiLevel, GameState, MoveDescriptor, Seat } from '../../types.js';

export { easyMove } from './easy.js';
export { mediumMove } from './medium.js';
export { hardMove } from './hard.js';

/**
 * Pick a move for `seat` given an already-rolled dice. Returns null when
 * nothing is legal. `rand` is injectable (only Easy consumes it) so the
 * server can derive it from its CSPRNG and tests stay deterministic (§5.5).
 */
export function chooseMove(
  state: GameState,
  seat: Seat,
  dice: number,
  level: AiLevel,
  rand: () => number = Math.random,
): MoveDescriptor | null {
  const moves = legalMoves(state, seat, dice);
  if (moves.length === 0) return null;
  switch (level) {
    case 'easy':
      return easyMove(moves, rand);
    case 'medium':
      return mediumMove(state, moves);
    case 'hard':
      return hardMove(state, moves);
  }
}

/** ARQUITECTURA §5.6 signature — acts on the current seat, returns a pieceId. */
export function pickMove(
  level: AiLevel,
  state: GameState,
  dice: number,
  rand?: () => number,
): number | null {
  const md = chooseMove(state, state.currentSeat, dice, level, rand);
  return md ? md.pieceId : null;
}
