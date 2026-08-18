/**
 * Places the baked board texture and owns the geometry mapping used by
 * every piece/fx position lookup (ARQUITECTURA §4.2: render from the shared
 * board model, never a parallel board definition).
 */
import type Phaser from 'phaser';
import type { PlayerColor } from '@ludo/shared';
import { BoardGeometry } from '../boardMap';
import type { XY } from '../boardMap';
import { BOARD_SIZE, BOARD_X, BOARD_Y, CELL, DEPTH } from '../layout';
import { LR_BAKE_SCALE } from '../../theme/tokens';

export class BoardView {
  readonly geo: BoardGeometry;
  /** Clockwise quarter-turns to put a color's yard at BOTTOM-LEFT (LW You). */
  static readonly TURNS_FOR: Readonly<Record<PlayerColor, number>> = {
    green: 0, // already bottom-left
    yellow: 1, // SE → SW
    blue: 2, // NE → SW
    red: 3, // NW → SW
  };

  private readonly cx = BOARD_X + BOARD_SIZE / 2;
  private readonly cy = BOARD_Y + BOARD_SIZE / 2;
  private readonly turns: number;

  /**
   * LW-style camera: the SQUARE board image spins in quarter turns and the
   * geometry rotates with it, so the local player always reads bottom-left
   * no matter which color the match dealt them.
   */
  constructor(scene: Phaser.Scene, textureKey = 'board', quarterTurns = 0) {
    this.turns = ((quarterTurns % 4) + 4) % 4;
    this.geo = new BoardGeometry(CELL, BOARD_X, BOARD_Y);
    scene.add
      .image(this.cx, this.cy, textureKey)
      .setScale(1 / LR_BAKE_SCALE)
      .setAngle(90 * this.turns)
      .setDepth(DEPTH.board);
  }

  /** Rotate a board-space point around the center (same math as setAngle). */
  private rot(p: XY): XY {
    let dx = p.x - this.cx;
    let dy = p.y - this.cy;
    for (let i = 0; i < this.turns; i++) {
      const nx = -dy; // 90° clockwise with screen-down Y
      dy = dx;
      dx = nx;
    }
    return { x: this.cx + dx, y: this.cy + dy };
  }

  stepsToXY(color: PlayerColor, steps: number, pieceId: number): XY {
    return this.rot(this.geo.stepsToXY(color, steps, pieceId));
  }

  baseSlotXY(color: PlayerColor, pieceId: number): XY {
    return this.rot(this.geo.baseSlotXY(color, pieceId));
  }

  absCellXY(absCell: number): XY {
    return this.rot(this.geo.absCellXY(absCell));
  }

  get centerXY(): XY {
    return this.geo.centerXY; // rotation-invariant
  }
}
