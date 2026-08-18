/**
 * Pawn textures per player color (STYLE-GUIDE §4): rounded conical base +
 * top sphere, rim-light (300), body (500), dark base ring + 2dp outline
 * (700), white specular dot. LUDOWORLD-PARITY §2.5 adds a `piece_<color>_face`
 * variant (simple procedural eyes + smile + stronger candy gloss) used by
 * the home mode-card clusters. The soft elliptical drop shadow is a separate
 * shared texture so it can shrink/fade independently during hops.
 */
import type Phaser from 'phaser';
import type { PlayerColor } from '@ludo/shared';
import { LR_BAKE_SCALE, LR_COLORS, LR_PLAYERS, cssColor, cssRgba, dp } from '../../theme/tokens';
import { makeCanvas } from './canvasKit';

const COLORS: readonly PlayerColor[] = ['red', 'blue', 'yellow', 'green'];

/** Logical pawn footprint: ~62×84dp (§4), baked at 2×. */
export const PAWN_W = dp(62);
export const PAWN_H = dp(84);

export function bakePieces(scene: Phaser.Scene): void {
  for (const color of COLORS) {
    bakePawn(scene, `piece_${color}`, color, false);
    bakePawn(scene, `piece_${color}_face`, color, true);
  }
  bakeShadow(scene);
}

function bakePawn(scene: Phaser.Scene, key: string, color: PlayerColor, face: boolean): void {
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const w = (PAWN_W + 8) * S;
  const h = (PAWN_H + 8) * S;
  const { ctx, texture } = makeCanvas(scene, key, w, h);
  ctx.scale(S, S);
  ctx.translate((PAWN_W + 8) / 2, 4);

  const pal = LR_PLAYERS[color];
  const headR = PAWN_W * 0.38;
  const headY = headR + 2;
  const tipY = PAWN_H - 4;

  // Map-pin token: white ring, colored disc, point at the cell.
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.bezierCurveTo(-headR * 1.15, headY + headR * 0.85, -headR * 1.05, headY - 2, -headR, headY);
  ctx.arc(0, headY, headR, Math.PI, 0, false);
  ctx.bezierCurveTo(headR * 1.05, headY - 2, headR * 1.15, headY + headR * 0.85, 0, tipY);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = cssColor(pal.dark);
  ctx.stroke();

  const innerR = headR * 0.62;
  const disc = ctx.createRadialGradient(-innerR * 0.3, headY - innerR * 0.35, innerR * 0.15, 0, headY, innerR);
  disc.addColorStop(0, cssColor(pal.light));
  disc.addColorStop(0.65, cssColor(pal.mid));
  disc.addColorStop(1, cssColor(pal.dark));
  ctx.beginPath();
  ctx.arc(0, headY, innerR, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-innerR * 0.32, headY - innerR * 0.38, innerR * 0.28, innerR * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fill();

  if (face) {
    for (const side of [-1, 1]) {
      const ex = side * innerR * 0.32;
      const ey = headY + innerR * 0.08;
      ctx.beginPath();
      ctx.arc(ex, ey, innerR * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, ey + innerR * 0.04, innerR * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(LR_COLORS.panelInk);
      ctx.fill();
    }
  }

  texture.refresh();
}

function bakeShadow(scene: Phaser.Scene): void {
  if (scene.textures.exists('piece_shadow')) return;
  const S = LR_BAKE_SCALE;
  const w = 44 * S;
  const h = 18 * S;
  const { ctx, texture } = makeCanvas(scene, 'piece_shadow', w, h);
  ctx.scale(S, S);
  const grad = ctx.createRadialGradient(22, 9, 2, 22, 9, 20);
  grad.addColorStop(0, cssRgba(LR_COLORS.sceneShadowInk, 0.35));
  grad.addColorStop(1, cssRgba(LR_COLORS.sceneShadowInk, 0));
  ctx.fillStyle = grad;
  ctx.save();
  ctx.translate(22, 9);
  ctx.scale(1, 0.42);
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.restore();
  ctx.fill();
  texture.refresh();
}
