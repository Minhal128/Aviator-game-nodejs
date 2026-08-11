import { LAST_TRACK_STEP } from '../../constants.js';
import { isSafeCell, toAbsoluteCell } from '../board.js';
import { getPlayer, isCellThreatened } from '../rules.js';
import type { GameState, MoveDescriptor } from '../../types.js';

/**
 * Level 2 "Retador" (ARQUITECTURA §5.6) — fixed priority ladder:
 *  1. put a piece into HOME
 *  2. capture
 *  3. leave BASE (only possible on a six)
 *  4. rescue an endangered piece into a safe destination
 *  5. advance the most advanced piece
 * Deterministic: within a rung, the lowest pieceId wins.
 */
export function mediumMove(state: GameState, moves: MoveDescriptor[]): MoveDescriptor | null {
  if (moves.length === 0) return null;

  const home = moves.find((m) => m.reachesHome);
  if (home) return home;

  const capture = moves.find((m) => m.captures.length > 0);
  if (capture) return capture;

  const exit = moves.find((m) => m.from === -1);
  if (exit) return exit;

  const rescue = moves.find((m) => isEndangered(state, m) && isSafeDestination(state, m));
  if (rescue) return rescue;

  return moves.reduce((best, m) => (m.from > best.from ? m : best));
}

/** The moving piece currently sits on a ring cell an enemy can reach. */
function isEndangered(state: GameState, m: MoveDescriptor): boolean {
  if (m.from < 0 || m.from > LAST_TRACK_STEP) return false;
  const abs = toAbsoluteCell(getPlayer(state, m.seat).color, m.from);
  return abs !== null && isCellThreatened(state, m.seat, abs);
}

/** Destination is uncapturable: a safe star/entry cell, the lane, or HOME. */
function isSafeDestination(state: GameState, m: MoveDescriptor): boolean {
  if (m.to > LAST_TRACK_STEP) return true;
  const abs = toAbsoluteCell(getPlayer(state, m.seat).color, m.to);
  return abs !== null && isSafeCell(abs);
}
