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
  const headR = PAWN_W * 0.30;
  const headY = headR + 2;
  const baseY = PAWN_H - 7;
  const baseHalf = PAWN_W * 0.44;
  const neckHalf = PAWN_W * 0.17;
  const neckY = headY + headR * 0.7;

  // Body cone (rounded via quadratic flares into the base).
  const body = ctx.createLinearGradient(-baseHalf, 0, baseHalf, 0);
  body.addColorStop(0, cssColor(pal.mid));
  body.addColorStop(0.35, cssColor(pal.light));
  body.addColorStop(1, cssColor(pal.mid));
  ctx.beginPath();
  ctx.moveTo(-neckHalf, neckY);
  ctx.quadraticCurveTo(-neckHalf * 1.05, baseY - PAWN_H * 0.42, -baseHalf, baseY - 8);
  ctx.quadraticCurveTo(-baseHalf * 1.08, baseY, -baseHalf * 0.8, baseY);
  ctx.lineTo(baseHalf * 0.8, baseY);
  ctx.quadraticCurveTo(baseHalf * 1.08, baseY, baseHalf, baseY - 8);
  ctx.quadraticCurveTo(neckHalf * 1.05, baseY - PAWN_H * 0.42, neckHalf, neckY);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = cssColor(pal.dark);
  ctx.stroke();

  // Dark base ring (grounding).
  ctx.beginPath();
  ctx.ellipse(0, baseY - 3, baseHalf * 0.92, 6.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = cssRgba(pal.dark, 0.9);
  ctx.fill();

  // Head sphere with top-left rim light.
  const head = ctx.createRadialGradient(-headR * 0.35, headY - headR * 0.4, headR * 0.15, 0, headY, headR * 1.15);
  head.addColorStop(0, cssColor(pal.light));
  head.addColorStop(0.55, cssColor(pal.mid));
  head.addColorStop(1, cssColor(pal.dark));
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = head;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = cssColor(pal.dark);
  ctx.stroke();

  // Specular dot, top-left (§4).
  ctx.beginPath();
  ctx.ellipse(-headR * 0.38, headY - headR * 0.42, headR * 0.22, headR * 0.15, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fill();

  // LUDOWORLD-PARITY §2.5 face variant: minimal circle-drawn eyes + smile
  // and a stronger candy gloss on the sphere. Interim until the rich
  // illustrated pawns land (§8 slot `pawn_<color>.png`).
  if (face) {
    // Stronger glossy highlight — glazed-candy sphere.
    ctx.beginPath();
    ctx.ellipse(-headR * 0.32, headY - headR * 0.38, headR * 0.5, headR * 0.3, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    // Eyes: white ovals + ink pupils + 1px life highlight.
    for (const side of [-1, 1]) {
      const ex = side * headR * 0.34;
      const ey = headY + headR * 0.08;
      ctx.beginPath();
      ctx.ellipse(ex, ey, headR * 0.21, headR * 0.27, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, ey + headR * 0.05, headR * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(LR_COLORS.panelInk);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - headR * 0.05, ey - headR * 0.02, headR * 0.045, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
    }
    // Minimal smile — thin ink arc.
    ctx.beginPath();
    ctx.arc(0, headY + headR * 0.32, headR * 0.32, Math.PI * 0.2, Math.PI * 0.8);
    ctx.strokeStyle = cssRgba(LR_COLORS.panelInk, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
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
