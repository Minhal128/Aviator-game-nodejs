/**
 * Maps the engine's abstract positions (ARQUITECTURA §5.1: steps -1/0-50/
 * 51-56/57) onto the classic 15×15 cross grid and then onto pixels.
 *
 * Grid conventions: red yard top-left, blue top-right, yellow bottom-right,
 * green bottom-left — clockwise, matching the engine's seat/turn order and
 * its entry cells (red 0 → blue 13 → yellow 26 → green 39).
 */
import { ENTRY_CELLS, LANE_START, HOME_STEPS, TRACK_SIZE, isOnTrack } from '@ludo/shared';
import type { PlayerColor } from '@ludo/shared';

export interface GridPos {
  col: number;
  row: number;
}

export interface XY {
  x: number;
  y: number;
}

function g(col: number, row: number): GridPos {
  return { col, row };
}

/** Absolute ring cells 0-51, clockwise, index 0 = red's entry cell. */
export const TRACK_GRID: readonly GridPos[] = [
  g(1, 6), g(2, 6), g(3, 6), g(4, 6), g(5, 6),
  g(6, 5), g(6, 4), g(6, 3), g(6, 2), g(6, 1), g(6, 0),
  g(7, 0),
  g(8, 0), g(8, 1), g(8, 2), g(8, 3), g(8, 4), g(8, 5),
  g(9, 6), g(10, 6), g(11, 6), g(12, 6), g(13, 6), g(14, 6),
  g(14, 7),
  g(14, 8), g(13, 8), g(12, 8), g(11, 8), g(10, 8), g(9, 8),
  g(8, 9), g(8, 10), g(8, 11), g(8, 12), g(8, 13), g(8, 14),
  g(7, 14),
  g(6, 14), g(6, 13), g(6, 12), g(6, 11), g(6, 10), g(6, 9),
  g(5, 8), g(4, 8), g(3, 8), g(2, 8), g(1, 8), g(0, 8),
  g(0, 7),
  g(0, 6),
];

/**
 * Home lane, steps 51-56. Cells 51-55 are the five tinted lane cells; cell
 * 56 sits on the medallion edge and is rendered as that color's gate
 * triangle (the engine's 6-cell lane mapped onto the classic 5+gate board).
 */
export const LANE_GRID: Readonly<Record<PlayerColor, readonly GridPos[]>> = {
  red: [g(1, 7), g(2, 7), g(3, 7), g(4, 7), g(5, 7), g(6, 7)],
  blue: [g(7, 1), g(7, 2), g(7, 3), g(7, 4), g(7, 5), g(7, 6)],
  yellow: [g(13, 7), g(12, 7), g(11, 7), g(10, 7), g(9, 7), g(8, 7)],
  green: [g(7, 13), g(7, 12), g(7, 11), g(7, 10), g(7, 9), g(7, 8)],
};

/** Top-left cell of each 6×6 home yard. */
export const YARD_ORIGIN: Readonly<Record<PlayerColor, GridPos>> = {
  red: g(0, 0),
  blue: g(9, 0),
  yellow: g(9, 9),
  green: g(0, 9),
};

/** Movement direction out of each entry cell (for the start-cell arrow). */
export const ENTRY_DIR: Readonly<Record<PlayerColor, XY>> = {
  red: { x: 1, y: 0 },
  blue: { x: 0, y: 1 },
  yellow: { x: -1, y: 0 },
  green: { x: 0, y: -1 },
};

/** Direction from the board center toward each color's gate. */
export const GATE_DIR: Readonly<Record<PlayerColor, XY>> = {
  red: { x: -1, y: 0 },
  blue: { x: 0, y: -1 },
  yellow: { x: 1, y: 0 },
  green: { x: 0, y: 1 },
};

function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`index ${i} out of bounds`);
  return v;
}

export class BoardGeometry {
  constructor(
    readonly cell: number,
    readonly originX: number,
    readonly originY: number,
  ) {}

  get size(): number {
    return this.cell * 15;
  }

  get centerXY(): XY {
    return this.gridToXY({ col: 7, row: 7 });
  }

  /** Center of a grid cell in world pixels. */
  gridToXY(p: GridPos): XY {
    return {
      x: this.originX + (p.col + 0.5) * this.cell,
      y: this.originY + (p.row + 0.5) * this.cell,
    };
  }

  absCellXY(absCell: number): XY {
    return this.gridToXY(at(TRACK_GRID, absCell % TRACK_SIZE));
  }

  /** World position for a color-relative steps value. */
  stepsToXY(color: PlayerColor, steps: number, pieceId: number): XY {
    if (steps < 0) return this.baseSlotXY(color, pieceId);
    if (isOnTrack(steps)) return this.absCellXY((ENTRY_CELLS[color] + steps) % TRACK_SIZE);
    if (steps < HOME_STEPS) return this.gridToXY(at(LANE_GRID[color], steps - LANE_START));
    return this.homeParkXY(color, pieceId);
  }

  /** The four yard slots where pieces wait in BASE (and return on capture). */
  baseSlotXY(color: PlayerColor, pieceId: number): XY {
    const yard = YARD_ORIGIN[color];
    const cx = this.originX + (yard.col + 3) * this.cell;
    const cy = this.originY + (yard.row + 3) * this.cell;
    const off = 0.95 * this.cell;
    const dx = pieceId % 2 === 0 ? -off : off;
    const dy = pieceId < 2 ? -off : off;
    return { x: cx + dx, y: cy + dy };
  }

  /** Finished pieces park inside the medallion, clustered by their gate. */
  homeParkXY(color: PlayerColor, pieceId: number): XY {
    const center = this.centerXY;
    const dir = GATE_DIR[color];
    const along = 0.92 * this.cell;
    const spread = (pieceId - 1.5) * 9;
    return {
      x: center.x + dir.x * along + Math.abs(dir.y) * spread,
      y: center.y + dir.y * along + Math.abs(dir.x) * spread,
    };
  }
}
