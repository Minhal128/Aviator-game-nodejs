/**
 * Small shared FX textures: soft dot (dust/trails), 4-point sparkle
 * (capture bursts), confetti rectangle, selection ring, radial glow, ray
 * wheel (victory) and the emote speech bubble. All white where tintable.
 * LUDOWORLD-PARITY §3 adds the procedural gold coin + faceted violet gem
 * (interim HUD/reward currency art until the rich PNGs land — §8 slots
 * `coin.png` / `gem.png` load under the same keys and win automatically).
 */
import type Phaser from 'phaser';
import { LR_BAKE_SCALE, LR_COLORS, cssColor, cssRgba } from '../../theme/tokens';
import { makeCanvas, roundedRectPath, starPath } from './canvasKit';

export function bakeFx(scene: Phaser.Scene): void {
  bakeDot(scene);
  bakeSpark(scene);
  bakeConfetti(scene);
  bakeRing(scene);
  bakeGlow(scene);
  bakeRays(scene);
  bakeBubble(scene);
  bakeCoin(scene);
  bakeGem(scene);
}

function bakeDot(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_dot')) return;
  const { ctx, texture } = makeCanvas(scene, 'fx_dot', 24, 24);
  const g = ctx.createRadialGradient(12, 12, 1, 12, 12, 11);
  g.addColorStop(0, 'rgba(255, 255, 255, 1)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 24, 24);
  texture.refresh();
}

function bakeSpark(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_spark')) return;
  const { ctx, texture } = makeCanvas(scene, 'fx_spark', 28, 28);
  ctx.translate(14, 14);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 13 : 4;
    const a = (i * Math.PI) / 4;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  texture.refresh();
}

function bakeConfetti(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_confetti')) return;
  const { ctx, texture } = makeCanvas(scene, 'fx_confetti', 10, 14);
  roundedRectPath(ctx, 0.5, 0.5, 9, 13, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  texture.refresh();
}

function bakeRing(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_ring')) return;
  const S = LR_BAKE_SCALE;
  const { ctx, texture } = makeCanvas(scene, 'fx_ring', 64 * S, 64 * S);
  ctx.scale(S, S);
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  ctx.stroke();
  texture.refresh();
}

function bakeGlow(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_glow')) return;
  const { ctx, texture } = makeCanvas(scene, 'fx_glow', 128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  texture.refresh();
}

function bakeRays(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_rays')) return;
  const size = 360;
  const { ctx, texture } = makeCanvas(scene, 'fx_rays', size, size);
  ctx.translate(size / 2, size / 2);
  for (let i = 0; i < 12; i++) {
    const a0 = (i * Math.PI) / 6;
    const a1 = a0 + Math.PI / 12;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, size / 2 - 2, a0, a1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fill();
  }
  texture.refresh();
}

function bakeBubble(scene: Phaser.Scene): void {
  if (scene.textures.exists('ui_bubble')) return;
  const S = LR_BAKE_SCALE;
  const w = 76;
  const h = 62;
  const { ctx, texture } = makeCanvas(scene, 'ui_bubble', w * S, h * S);
  ctx.scale(S, S);
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.sceneShadowInk, 0.3);
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, 4, 4, w - 8, h - 20, 14);
  ctx.fillStyle = cssColor(LR_COLORS.surface);
  ctx.fill();
  // Tail toward the avatar below.
  ctx.beginPath();
  ctx.moveTo(w / 2 - 8, h - 17);
  ctx.lineTo(w / 2 + 8, h - 17);
  ctx.lineTo(w / 2, h - 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  texture.refresh();
}

/**
 * LUDOWORLD-PARITY §3.2 — procedural shiny gold coin `coin_gold` (64×64 @2x):
 * radial gold disc, inner rim ring, embossed 5-point star, candy gloss.
 */
function bakeCoin(scene: Phaser.Scene): void {
  if (scene.textures.exists('coin_gold')) return;
  const S = LR_BAKE_SCALE;
  const size = 64;
  const { ctx, texture } = makeCanvas(scene, 'coin_gold', size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;

  // 1. Disc: gold300 top-left → gold500 body → gold700 edge.
  const disc = ctx.createRadialGradient(c - 6, c - 8, 4, c, c, c - 2);
  disc.addColorStop(0, cssColor(LR_COLORS.gold300));
  disc.addColorStop(0.62, cssColor(LR_COLORS.gold500));
  disc.addColorStop(1, cssColor(LR_COLORS.gold700));
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = cssColor(LR_COLORS.gold700);
  ctx.stroke();

  // 2. Inner ring (coin rim).
  ctx.beginPath();
  ctx.arc(c, c, c - 8, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = cssRgba(LR_COLORS.gold700, 0.6);
  ctx.stroke();

  // 3. Embossed star: gold700 inner-shadow pass, then the gold300 star.
  starPath(ctx, c, c + 1.5, 13, 5.5);
  ctx.fillStyle = cssRgba(LR_COLORS.gold700, 0.85);
  ctx.fill();
  ctx.save();
  ctx.lineJoin = 'round';
  starPath(ctx, c, c, 13, 5.5);
  ctx.fillStyle = cssColor(LR_COLORS.gold300);
  ctx.strokeStyle = cssColor(LR_COLORS.gold300);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fill();
  ctx.restore();

  // 4. Specular gloss, top-left — the caramel shine.
  ctx.beginPath();
  ctx.ellipse(c - 8, c - 10, 10, 6, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill();

  texture.refresh();
}

/**
 * LUDOWORLD-PARITY §3.3 — procedural faceted violet gem `gem_violet`
 * (64×64 @2x): hexagonal silhouette split into triangular facets between
 * gem300 (lit, top) and gem700 (shadow, bottom), white highlight facet,
 * thin gem700 contour.
 */
function bakeGem(scene: Phaser.Scene): void {
  if (scene.textures.exists('gem_violet')) return;
  const S = LR_BAKE_SCALE;
  const size = 64;
  const { ctx, texture } = makeCanvas(scene, 'gem_violet', size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;

  // Hexagonal silhouette (clockwise from the top point) + facet apex.
  const pts: readonly [number, number][] = [
    [c, 6],
    [c + 20, 20],
    [c + 14, 48],
    [c, 58],
    [c - 14, 48],
    [c - 20, 20],
  ];
  const apex: readonly [number, number] = [c, 28];
  const facet = (i: number, fill: string): void => {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(apex[0], apex[1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Facets: lit crown up top, mid sides, deep shadow toward the culet.
  facet(0, cssColor(LR_COLORS.gem300)); // top → upper-right (lit)
  facet(1, cssColor(LR_COLORS.gem500)); // upper-right → lower-right
  facet(2, cssColor(LR_COLORS.gem700)); // lower-right → bottom (shadow)
  facet(3, cssColor(LR_COLORS.gem700)); // bottom → lower-left (shadow)
  facet(4, cssColor(LR_COLORS.gem500)); // lower-left → upper-left
  facet(5, cssColor(LR_COLORS.gem300)); // upper-left → top (lit)

  // Crystal highlight: the upper-left lit facet flashes white.
  facet(5, 'rgba(255, 255, 255, 0.5)');

  // Thin contour.
  ctx.beginPath();
  ctx.moveTo(pts[0]?.[0] ?? c, pts[0]?.[1] ?? 6);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = cssRgba(LR_COLORS.gem700, 0.5);
  ctx.stroke();

  texture.refresh();
}
