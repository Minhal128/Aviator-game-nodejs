/**
 * POWER mode textures (Ludo World parity): the four board tokens — a golden
 * "+1" tag plus three glossy blue medallions (double dice / dice picker /
 * shield dome) — and the translucent immunity dome the shielded pawn wears.
 * All procedural; readable at cell size (~44dp).
 */
import type Phaser from 'phaser';
import { LR_BAKE_SCALE, dp } from '../../theme/tokens';
import { makeCanvas, roundedRectPath } from './canvasKit';

/** Logical token diameter on the board. */
export const TOKEN_SIZE = dp(46);

export function bakePowers(scene: Phaser.Scene): void {
  bakePlusTag(scene);
  bakeMedallion(scene, 'power_double', drawDoubleDice);
  bakeMedallion(scene, 'power_pick', drawPickDie);
  bakeMedallion(scene, 'power_shield', drawShieldPawn);
  // Battle set (shop model): tinted medallions so each power reads at a
  // glance — slate bomb, ember bolt, ice freeze, violet portal.
  bakeTintedMedallion(scene, 'power_bomb', ['#8E97AD', '#525C74', '#262C3E'], drawBomb);
  bakeTintedMedallion(scene, 'power_bolt', ['#FFE1A0', '#F5A623', '#B35E00'], drawBolt);
  bakeTintedMedallion(scene, 'power_freeze', ['#D5F4FF', '#5BC2EE', '#1D6FA8'], drawSnowflake);
  bakeTintedMedallion(scene, 'power_portal', ['#E4CCFF', '#9B5CF6', '#5B21B6'], drawPortal);
  bakePowerOrb(scene);
  bakeTrapMarker(scene);
  bakeIce(scene);
  bakeDome(scene);
}

/** Same glossy disc as bakeMedallion, with a custom body palette. */
function bakeTintedMedallion(
  scene: Phaser.Scene,
  key: string,
  palette: [string, string, string] | string[],
  drawIcon: (ctx: CanvasRenderingContext2D, c: number, half: number) => void,
): void {
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const size = TOKEN_SIZE + 8;
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const half = TOKEN_SIZE / 2;

  const body = ctx.createRadialGradient(c - half * 0.3, c - half * 0.4, half * 0.2, c, c, half);
  body.addColorStop(0, palette[0] ?? '#8FC7FF');
  body.addColorStop(0.55, palette[1] ?? '#3D8BFF');
  body.addColorStop(1, palette[2] ?? '#1D55C8');
  ctx.beginPath();
  ctx.arc(c, c, half, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(20, 24, 40, 0.85)';
  ctx.stroke();

  drawIcon(ctx, c, half);

  ctx.beginPath();
  ctx.ellipse(c, c - half * 0.55, half * 0.62, half * 0.26, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fill();
  texture.refresh();
}

function drawBomb(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  // Round black bomb + short fuse with a spark.
  const r = half * 0.52;
  const body = ctx.createRadialGradient(c - r * 0.4, c - r * 0.3, r * 0.2, c, c + half * 0.08, r);
  body.addColorStop(0, '#4A4F63');
  body.addColorStop(1, '#15181F');
  ctx.beginPath();
  ctx.arc(c, c + half * 0.08, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.stroke();
  // Cap + fuse.
  ctx.fillStyle = '#2A2F3F';
  ctx.fillRect(c - half * 0.12, c - half * 0.58, half * 0.24, half * 0.2);
  ctx.beginPath();
  ctx.moveTo(c, c - half * 0.55);
  ctx.quadraticCurveTo(c + half * 0.3, c - half * 0.8, c + half * 0.42, c - half * 0.6);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#C9A15A';
  ctx.stroke();
  // Spark.
  ctx.beginPath();
  ctx.arc(c + half * 0.44, c - half * 0.6, half * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD34D';
  ctx.fill();
  // Glint.
  ctx.beginPath();
  ctx.arc(c - r * 0.35, c - r * 0.15, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
}

function drawBolt(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  // Classic zig-zag bolt, white-hot core with an ink outline.
  const s = half * 0.9;
  ctx.beginPath();
  ctx.moveTo(c + s * 0.14, c - s * 0.78);
  ctx.lineTo(c - s * 0.32, c + s * 0.1);
  ctx.lineTo(c - s * 0.02, c + s * 0.1);
  ctx.lineTo(c - s * 0.18, c + s * 0.78);
  ctx.lineTo(c + s * 0.36, c - s * 0.12);
  ctx.lineTo(c + s * 0.04, c - s * 0.12);
  ctx.closePath();
  ctx.fillStyle = '#FFF7DE';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(90, 40, 0, 0.85)';
  ctx.stroke();
}

function drawSnowflake(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  const r = half * 0.62;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + dx * r, c + dy * r);
    ctx.stroke();
    // Side ticks at 60% of the spoke.
    const bx = c + dx * r * 0.6;
    const by = c + dy * r * 0.6;
    for (const side of [-1, 1]) {
      const ba = a + (side * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(ba) * r * 0.24, by + Math.sin(ba) * r * 0.24);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(c, c, half * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
}

function drawPortal(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  // Swirl: two offset arcs spiralling into a bright core.
  ctx.lineCap = 'round';
  for (const [r0, a0, a1, w, col] of [
    [half * 0.58, -0.4, Math.PI * 1.05, 4.5, '#FFFFFF'],
    [half * 0.38, Math.PI * 0.7, Math.PI * 2.1, 4, '#E8D5FF'],
  ] as const) {
    ctx.beginPath();
    ctx.arc(c, c, r0, a0, a1);
    ctx.lineWidth = w;
    ctx.strokeStyle = col;
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(c, c, 1, c, c, half * 0.22);
  core.addColorStop(0, '#FFFFFF');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(c, c, half * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();
}

/**
 * The single in-match POWER button: a glossy violet energy orb with a gold
 * ring and a white bolt — the scene adds the pulsing glow + charge badge.
 */
function bakePowerOrb(scene: Phaser.Scene): void {
  const key = 'power_orb';
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const size = dp(84);
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const r = size / 2 - 4;

  // Gold ring.
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = '#8A5A00';
  ctx.fill();
  const ring = ctx.createLinearGradient(0, c - r, 0, c + r);
  ring.addColorStop(0, '#FFE08A');
  ring.addColorStop(1, '#D99000');
  ctx.beginPath();
  ctx.arc(c, c, r - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  // Violet orb body.
  const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.15, c, c, r * 0.82);
  body.addColorStop(0, '#B9A6FF');
  body.addColorStop(0.55, '#7B5CF0');
  body.addColorStop(1, '#4527A8');
  ctx.beginPath();
  ctx.arc(c, c, r * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  // White bolt glyph.
  const s = r * 0.62;
  ctx.beginPath();
  ctx.moveTo(c + s * 0.14, c - s * 0.8);
  ctx.lineTo(c - s * 0.34, c + s * 0.12);
  ctx.lineTo(c - s * 0.02, c + s * 0.12);
  ctx.lineTo(c - s * 0.18, c + s * 0.8);
  ctx.lineTo(c + s * 0.38, c - s * 0.1);
  ctx.lineTo(c + s * 0.04, c - s * 0.1);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  // Specular sweep.
  ctx.beginPath();
  ctx.ellipse(c, c - r * 0.45, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  texture.refresh();
}

/** Armed bomb marker sitting on a board cell (visible to everyone). */
function bakeTrapMarker(scene: Phaser.Scene): void {
  const key = 'fx_trap';
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const size = TOKEN_SIZE + 8;
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const half = TOKEN_SIZE / 2;
  // Danger pad under the bomb.
  roundedRectPath(ctx, c - half, c - half, TOKEN_SIZE, TOKEN_SIZE, dp(10));
  ctx.fillStyle = 'rgba(230, 57, 80, 0.28)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(230, 57, 80, 0.9)';
  ctx.stroke();
  ctx.setLineDash([]);
  drawBomb(ctx, c, half * 0.9);
  texture.refresh();
}

/** Translucent ice block a frozen pawn wears (sibling of the shield dome). */
function bakeIce(scene: Phaser.Scene): void {
  const key = 'fx_ice';
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const w = dp(58);
  const h = dp(64);
  const { ctx, texture } = makeCanvas(scene, key, w * S, h * S);
  ctx.scale(S, S);
  const body = ctx.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, 'rgba(214, 244, 255, 0.75)');
  body.addColorStop(0.6, 'rgba(122, 204, 240, 0.55)');
  body.addColorStop(1, 'rgba(56, 140, 200, 0.65)');
  roundedRectPath(ctx, 2, 2, w - 4, h - 4, dp(12));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.stroke();
  // Cracks.
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.moveTo(w * 0.28, h * 0.2);
  ctx.lineTo(w * 0.44, h * 0.42);
  ctx.lineTo(w * 0.34, h * 0.6);
  ctx.moveTo(w * 0.66, h * 0.3);
  ctx.lineTo(w * 0.56, h * 0.52);
  ctx.lineTo(w * 0.7, h * 0.74);
  ctx.stroke();
  texture.refresh();
}

function bakePlusTag(scene: Phaser.Scene): void {
  const key = 'power_plus';
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const size = TOKEN_SIZE + 8;
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const half = TOKEN_SIZE / 2;

  const body = ctx.createLinearGradient(0, c - half, 0, c + half);
  body.addColorStop(0, '#FFE08A');
  body.addColorStop(0.6, '#FFC93C');
  body.addColorStop(1, '#E8A200');
  roundedRectPath(ctx, c - half, c - half, TOKEN_SIZE, TOKEN_SIZE, dp(10));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(122, 74, 4, 0.9)';
  ctx.stroke();
  // Top gloss.
  ctx.beginPath();
  ctx.ellipse(c, c - half * 0.5, half * 0.7, half * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fill();
  // The "+1".
  ctx.font = `800 ${Math.round(TOKEN_SIZE * 0.52)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#6B3E00';
  ctx.fillText('+1', c, c + 1);
  texture.refresh();
}

function bakeMedallion(
  scene: Phaser.Scene,
  key: string,
  drawIcon: (ctx: CanvasRenderingContext2D, c: number, half: number) => void,
): void {
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const size = TOKEN_SIZE + 8;
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const half = TOKEN_SIZE / 2;

  // Glossy blue disc with a darker rim (Ludo World's token look).
  const body = ctx.createRadialGradient(c - half * 0.3, c - half * 0.4, half * 0.2, c, c, half);
  body.addColorStop(0, '#8FC7FF');
  body.addColorStop(0.55, '#3D8BFF');
  body.addColorStop(1, '#1D55C8');
  ctx.beginPath();
  ctx.arc(c, c, half, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(10, 40, 110, 0.9)';
  ctx.stroke();

  drawIcon(ctx, c, half);

  // Specular sweep on top.
  ctx.beginPath();
  ctx.ellipse(c, c - half * 0.55, half * 0.62, half * 0.26, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fill();
  texture.refresh();
}

/** Small white die with ink pips, rotated `angle`, centered at (x, y). */
function miniDie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  pips: ReadonlyArray<[number, number]>,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  roundedRectPath(ctx, -size / 2, -size / 2, size, size, size * 0.24);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(30, 40, 70, 0.7)';
  ctx.stroke();
  ctx.fillStyle = '#25304F';
  for (const [px, py] of pips) {
    ctx.beginPath();
    ctx.arc(px * size * 0.28, py * size * 0.28, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDoubleDice(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  const s = half * 0.78;
  miniDie(ctx, c - half * 0.3, c + half * 0.1, s, -0.28, [[-1, -1], [0, 0], [1, 1]]);
  miniDie(ctx, c + half * 0.34, c - half * 0.14, s, 0.24, [[-1, -1], [1, -1], [-1, 1], [1, 1]]);
}

function drawPickDie(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  miniDie(ctx, c, c + half * 0.12, half * 0.95, -0.12, [[-1, -1], [0, 0], [1, 1]]);
  // The red picker knob on top.
  ctx.beginPath();
  ctx.arc(c + half * 0.05, c - half * 0.45, half * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#E63950';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(90, 10, 25, 0.85)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c - half * 0.01, c - half * 0.5, half * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
}

function drawShieldPawn(ctx: CanvasRenderingContext2D, c: number, half: number): void {
  // Red pawn silhouette (head + cone).
  ctx.fillStyle = '#E23A3A';
  ctx.strokeStyle = 'rgba(120, 16, 16, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c, c - half * 0.28, half * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c - half * 0.1, c - half * 0.12);
  ctx.quadraticCurveTo(c - half * 0.42, c + half * 0.38, c - half * 0.34, c + half * 0.42);
  ctx.lineTo(c + half * 0.34, c + half * 0.42);
  ctx.quadraticCurveTo(c + half * 0.42, c + half * 0.38, c + half * 0.1, c - half * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Glass dome over it.
  ctx.beginPath();
  ctx.arc(c, c + half * 0.05, half * 0.62, Math.PI, 0);
  ctx.lineTo(c + half * 0.62, c + half * 0.42);
  ctx.lineTo(c - half * 0.62, c + half * 0.42);
  ctx.closePath();
  ctx.fillStyle = 'rgba(210, 240, 255, 0.35)';
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(240, 252, 255, 0.85)';
  ctx.stroke();
}

/** Translucent bubble a shielded pawn wears on the board. */
function bakeDome(scene: Phaser.Scene): void {
  const key = 'fx_dome';
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const size = dp(84);
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const r = size / 2 - 3;
  const body = ctx.createRadialGradient(c - r * 0.3, c - r * 0.45, r * 0.15, c, c, r);
  body.addColorStop(0, 'rgba(220, 245, 255, 0.42)');
  body.addColorStop(0.7, 'rgba(140, 210, 255, 0.22)');
  body.addColorStop(1, 'rgba(90, 180, 255, 0.4)');
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(235, 250, 255, 0.8)';
  ctx.stroke();
  // Curved highlight.
  ctx.beginPath();
  ctx.ellipse(c - r * 0.35, c - r * 0.42, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fill();
  texture.refresh();
}
