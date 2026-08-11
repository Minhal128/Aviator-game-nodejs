import { HOME_STEPS, LAST_TRACK_STEP, PIECES_PER_PLAYER } from '../constants.js';
import { isInBase, isOnTrack, isSafeCell, toAbsoluteCell, trackDistance } from './board.js';
import type { CaptureRef, GameState, MoveDescriptor, PieceState, PlayerState, Seat } from '../types.js';

export function getPlayer(state: GameState, seat: Seat): PlayerState {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) throw new RangeError(`unknown seat ${seat}`);
  return player;
}

export function getPiece(state: GameState, seat: Seat, pieceId: number): PieceState {
  const piece = state.pieces.find((p) => p.seat === seat && p.pieceId === pieceId);
  if (!piece) throw new RangeError(`unknown piece ${seat}/${pieceId}`);
  return piece;
}

/** Enemy pieces currently standing on an absolute ring cell. */
export function enemyPiecesOnCell(state: GameState, seat: Seat, absCell: number): PieceState[] {
  return state.pieces.filter((p) => {
    if (p.seat === seat || !isOnTrack(p.steps)) return false;
    return toAbsoluteCell(getPlayer(state, p.seat).color, p.steps) === absCell;
  });
}

/** How many of the seat's own pieces stand on an absolute ring cell. */
export function ownCountOnCell(state: GameState, seat: Seat, absCell: number): number {
  const color = getPlayer(state, seat).color;
  return state.pieces.filter(
    (p) => p.seat === seat && isOnTrack(p.steps) && toAbsoluteCell(color, p.steps) === absCell,
  ).length;
}

/** POWER mode: true while the piece wears an immunity dome. */
export function isShielded(state: GameState, seat: Seat, pieceId: number): boolean {
  return state.shields.some((s) => s.seat === seat && s.pieceId === pieceId);
}

/** POWER battle set: true while the piece is frozen (sits out a turn). */
export function isFrozen(state: GameState, seat: Seat, pieceId: number): boolean {
  return state.frozen.some((f) => f.seat === seat && f.pieceId === pieceId && f.remaining > 0);
}

/**
 * Resolve what would happen if `seat` played `pieceId` with `dice`.
 * Returns null when the move is illegal (ARQUITECTURA §5.2).
 */
export function describeMove(
  state: GameState,
  seat: Seat,
  pieceId: number,
  dice: number,
): MoveDescriptor | null {
  const player = state.players.find((p) => p.seat === seat);
  if (!player || player.forfeited || player.place > 0) return null;
  const piece = state.pieces.find((p) => p.seat === seat && p.pieceId === pieceId);
  if (!piece) return null;
  // POWER freeze: a frozen piece has no legal moves until it thaws.
  if (isFrozen(state, seat, pieceId)) return null;
  const rules = state.config.rules;

  let to: number;
  if (isInBase(piece.steps)) {
    // §5.2.1: only a six leaves BASE, landing on the color's entry cell.
    if (dice !== 6) return null;
    to = 0;
  } else {
    if (piece.steps === HOME_STEPS) return null;
    to = piece.steps + dice;
    // §5.1: HOME needs the exact value — overshooting the lane is illegal.
    if (to > HOME_STEPS) return null;
  }

  let captures: CaptureRef[] = [];
  if (to <= LAST_TRACK_STEP) {
    const destAbs = toAbsoluteCell(player.color, to);
    if (destAbs === null) return null;
    const enemies = enemyPiecesOnCell(state, seat, destAbs);
    if (rules.blockEnabled) {
      // §5.2.4: an enemy wall (2+ pieces of one seat) cannot be landed on.
      const perSeat = new Map<Seat, number>();
      for (const e of enemies) perSeat.set(e.seat, (perSeat.get(e.seat) ?? 0) + 1);
      for (const count of perSeat.values()) {
        if (count >= 2) return null;
      }
    }
    // §5.2.3: capture on landing, never on safe cells. With walls disabled a
    // multi-piece stack is simply captured whole. POWER shields make the
    // wearer uncapturable — the mover simply shares the cell with it.
    if (!isSafeCell(destAbs)) {
      captures = enemies
        .filter((e) => !isShielded(state, e.seat, e.pieceId))
        .map((e) => ({ seat: e.seat, pieceId: e.pieceId }));
    }
  }

  const reachesHome = to === HOME_STEPS;
  const extraTurn =
    dice === 6 || reachesHome || (captures.length > 0 && rules.extraTurnOnCapture);

  const path: number[] = [];
  if (isInBase(piece.steps)) {
    path.push(0);
  } else {
    for (let s = piece.steps + 1; s <= to; s++) path.push(s);
  }

  return { seat, pieceId, dice, from: piece.steps, to, path, captures, reachesHome, extraTurn };
}

/** All legal moves for the seat with the given dice (may be empty, §5.2.7). */
export function legalMoves(state: GameState, seat: Seat, dice: number): MoveDescriptor[] {
  const moves: MoveDescriptor[] = [];
  for (let pieceId = 0; pieceId < PIECES_PER_PLAYER; pieceId++) {
    const md = describeMove(state, seat, pieceId, dice);
    if (md) moves.push(md);
  }
  return moves;
}

/** §5.2.8: victory = all 4 pieces at HOME. */
export function hasWon(state: GameState, seat: Seat): boolean {
  return (
    state.pieces.filter((p) => p.seat === seat && p.steps === HOME_STEPS).length ===
    PIECES_PER_PLAYER
  );
}

/**
 * P(some enemy lands on `absCell` on its next roll): each enemy within 1-6
 * ring cells behind adds 1/6 per reachable distance — but only if that enemy
 * would still be on the ring after moving (it cannot capture from inside its
 * own lane). Safe cells are never capturable (§5.6 hard AI lookahead).
 */
export function captureProbability(state: GameState, seat: Seat, absCell: number): number {
  if (isSafeCell(absCell)) return 0;
  let p = 0;
  for (const enemy of state.pieces) {
    if (enemy.seat === seat || !isOnTrack(enemy.steps)) continue;
    const enemyAbs = toAbsoluteCell(getPlayer(state, enemy.seat).color, enemy.steps);
    if (enemyAbs === null) continue;
    const d = trackDistance(enemyAbs, absCell);
    if (d >= 1 && d <= 6 && enemy.steps + d <= LAST_TRACK_STEP) p += 1 / 6;
  }
  return Math.min(p, 1);
}

/** True when an enemy could capture this ring cell on its next roll. */
export function isCellThreatened(state: GameState, seat: Seat, absCell: number): boolean {
  return captureProbability(state, seat, absCell) > 0;
}
