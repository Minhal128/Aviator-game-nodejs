import {
  BASE_STEPS,
  ENTRY_CELLS,
  HOME_STEPS,
  LANE_START,
  LAST_TRACK_STEP,
  PLAYER_COLORS,
  SAFE_CELLS,
  TRACK_SIZE,
} from '../constants.js';
import type { PlayerColor } from '../types.js';

export function isInBase(steps: number): boolean {
  return steps === BASE_STEPS;
}

export function isOnTrack(steps: number): boolean {
  return steps >= 0 && steps <= LAST_TRACK_STEP;
}

export function isInLane(steps: number): boolean {
  return steps >= LANE_START && steps < HOME_STEPS;
}

export function isHome(steps: number): boolean {
  return steps === HOME_STEPS;
}

export function isSafeCell(absCell: number): boolean {
  return SAFE_CELLS.has(absCell);
}

/**
 * Absolute ring cell (0-51) for a color-relative position, or null when the
 * piece is off the shared ring (base, home lane or HOME).
 */
export function toAbsoluteCell(color: PlayerColor, steps: number): number | null {
  if (!isOnTrack(steps)) return null;
  return (ENTRY_CELLS[color] + steps) % TRACK_SIZE;
}

/**
 * Colors per seat count. 2P games take opposite corners so the match does
 * not play out on one half of the board; `seatZeroColor` rotates the whole
 * layout around the ring (PLAYER_COLORS is ring order) so seat 0 gets the
 * chosen color while the geometric spread stays identical.
 */
export function seatColors(numPlayers: 2 | 3 | 4, seatZeroColor: PlayerColor = 'red'): PlayerColor[] {
  const anchor = PLAYER_COLORS.indexOf(seatZeroColor);
  const spread = numPlayers === 2 ? [0, 2] : numPlayers === 3 ? [0, 1, 2] : [0, 1, 2, 3];
  return spread.map((off) => PLAYER_COLORS[(anchor + off) % PLAYER_COLORS.length] as PlayerColor);
}

/** Forward (clockwise) distance in cells from one absolute cell to another. */
export function trackDistance(fromAbs: number, toAbs: number): number {
  return (toAbs - fromAbs + TRACK_SIZE) % TRACK_SIZE;
}
