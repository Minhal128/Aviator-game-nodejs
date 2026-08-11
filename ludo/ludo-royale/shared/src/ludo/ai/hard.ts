import { AI_WEIGHTS, HOME_STEPS, LAST_TRACK_STEP } from '../../constants.js';
import { isOnTrack, isSafeCell, toAbsoluteCell, trackDistance } from '../board.js';
import { captureProbability, getPlayer, isCellThreatened, ownCountOnCell } from '../rules.js';
import type { GameState, MoveDescriptor, Seat } from '../../types.js';

/**
 * Level 3 "Experto" (ARQUITECTURA §5.6): weighted score per candidate move,
 * 1-ply enemy lookahead via captureProbability(). Highest score wins;
 * lowest pieceId breaks ties. Deterministic — no randomness at all.
 */
export function hardMove(state: GameState, moves: MoveDescriptor[]): MoveDescriptor | null {
  if (moves.length === 0) return null;
  let best: MoveDescriptor | null = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const score = scoreMove(state, m);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function scoreMove(state: GameState, m: MoveDescriptor): number {
  const rules = state.config.rules;
  const color = getPlayer(state, m.seat).color;
  let score = 0;

  if (m.captures.length > 0) score += AI_WEIGHTS.capture;
  if (m.reachesHome) score += AI_WEIGHTS.reachHome;
  // Opening pressure: only rewarded while the seat has fewer than 2 pieces out.
  if (m.from === -1 && piecesOut(state, m.seat) < 2) score += AI_WEIGHTS.exitBase;

  score += AI_WEIGHTS.progress * (m.to / HOME_STEPS);

  const destAbs = m.to <= LAST_TRACK_STEP ? toAbsoluteCell(color, m.to) : null;
  if (destAbs !== null) {
    if (isSafeCell(destAbs)) score += AI_WEIGHTS.safeCell;

    const formsWall = rules.blockEnabled && ownCountOnCell(state, m.seat, destAbs) >= 1;
    if (formsWall) {
      // A wall cannot be captured, so the threat penalty does not apply;
      // it only earns the bonus when enemies still have to cross that cell.
      if (enemyWillTransit(state, m.seat, destAbs)) score += AI_WEIGHTS.formWall;
    } else {
      score -= AI_WEIGHTS.threatPenalty * captureProbability(state, m.seat, destAbs);
    }
  }

  if (breaksThreatenedWall(state, m)) score -= AI_WEIGHTS.breakWallPenalty;

  return score;
}

/** Pieces on the ring or in the lane (i.e. neither BASE nor HOME). */
function piecesOut(state: GameState, seat: Seat): number {
  return state.pieces.filter((p) => p.seat === seat && p.steps >= 0 && p.steps < HOME_STEPS)
    .length;
}

/** Some enemy piece still has to pass over this ring cell before its lane. */
function enemyWillTransit(state: GameState, seat: Seat, absCell: number): boolean {
  for (const enemy of state.pieces) {
    if (enemy.seat === seat || !isOnTrack(enemy.steps)) continue;
    const enemyAbs = toAbsoluteCell(getPlayer(state, enemy.seat).color, enemy.steps);
    if (enemyAbs === null) continue;
    const d = trackDistance(enemyAbs, absCell);
    if (d >= 1 && enemy.steps + d <= LAST_TRACK_STEP) return true;
  }
  return false;
}

/** Moving away would leave a currently-threatened own wall broken. */
function breaksThreatenedWall(state: GameState, m: MoveDescriptor): boolean {
  if (!state.config.rules.blockEnabled) return false;
  if (m.from < 0 || m.from > LAST_TRACK_STEP) return false;
  const fromAbs = toAbsoluteCell(getPlayer(state, m.seat).color, m.from);
  if (fromAbs === null) return false;
  return ownCountOnCell(state, m.seat, fromAbs) === 2 && isCellThreatened(state, m.seat, fromAbs);
}
