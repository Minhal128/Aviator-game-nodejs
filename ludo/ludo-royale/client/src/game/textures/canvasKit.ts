/**
 * Small 2D-canvas helpers for the procedural texture bakery. Canvas 2D (via
 * Phaser CanvasTexture) instead of Phaser.Graphics because it gives baked
 * soft shadows, gradients and rotated paths — the "flat premium, AO baked"
 * look of STYLE-GUIDE §3 — with zero binary assets.
 */
import type Phaser from 'phaser';

export interface Baked {
  ctx: CanvasRenderingContext2D;
  texture: Phaser.Textures.CanvasTexture;
}

export function makeCanvas(scene: Phaser.Scene, key: string, w: number, h: number): Baked {
  const texture = scene.textures.createCanvas(key, w, h);
  if (!texture) throw new Error(`could not create canvas texture "${key}"`);
  return { ctx: texture.getContext(), texture };
}

/** arcTo-based rounded rect (no reliance on ctx.roundRect availability). */
export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 5-point star path. Rounding comes from stroking with lineJoin 'round'. */
export function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Tiny deterministic PRNG so procedural frames are identical every boot. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
