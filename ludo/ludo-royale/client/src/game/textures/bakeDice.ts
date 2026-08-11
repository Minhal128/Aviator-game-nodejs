/**
 * Procedural dice frames (STYLE-GUIDE §4/§5.1): rounded cube with a soft top
 * light and pips. 6 face frames + 10 tumble frames where the rotation is
 * FAKED per frame (rotated/squashed body, random pip faces), exactly like a
 * baked spritesheet would behave. Deterministic PRNG so the frames are
 * identical every boot.
 *
 * DICE SKINS (shop `dice_skin` items): the same baker parameterized by a
 * small palette. `bakeDice` (splash) bakes the classic set + one face_5
 * PREVIEW per skin (shop/backpack tiles need only that); the full 16-frame
 * set of a skin is baked lazily by `ensureDiceSkin` when a match actually
 * uses it. The skin id travels in lr_shop_items.asset_key.
 */
import type Phaser from 'phaser';
import { LR_BAKE_SCALE, LR_COLORS, LR_MOTION, cssColor, cssRgba, dp } from '../../theme/tokens';
import { makeCanvas, mulberry32, roundedRectPath } from './canvasKit';

/** Logical die body size on screen (~132dp idle). */
export const DIE_SIZE = dp(132);
const CANVAS = DIE_SIZE + 24;

const PIPS: Readonly<Record<number, readonly [number, number][]>> = {
  1: [[0, 0]],
  2: [[-0.5, -0.5], [0.5, 0.5]],
  3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  6: [[-0.5, -0.55], [-0.5, 0], [-0.5, 0.55], [0.5, -0.55], [0.5, 0], [0.5, 0.55]],
};

/** Body/pip palette of one die variant (plain CSS colors, not tokens). */
interface DicePalette {
  bodyTop: string;
  bodyMid: string;
  bodyBottom: string;
  border: string;
  pip: string;
}

export const DICE_SKINS = ['gold', 'ruby', 'mint', 'galaxy'] as const;
export type DiceSkinId = (typeof DICE_SKINS)[number] | 'classic';

const SKIN_PALETTES: Readonly<Record<(typeof DICE_SKINS)[number], DicePalette>> = {
  gold: {
    bodyTop: '#FFEDB0',
    bodyMid: '#FFC93C',
    bodyBottom: '#DE9A05',
    border: 'rgba(122, 74, 4, 0.9)',
    pip: '#FFFFFF',
  },
  ruby: {
    bodyTop: '#FF93A6',
    bodyMid: '#E63950',
    bodyBottom: '#A61B32',
    border: 'rgba(92, 10, 26, 0.9)',
    pip: '#FFFFFF',
  },
  mint: {
    bodyTop: '#B5F7DD',
    bodyMid: '#3ED598',
    bodyBottom: '#159A6E',
    border: 'rgba(8, 84, 58, 0.9)',
    pip: '#FFFFFF',
  },
  galaxy: {
    bodyTop: '#8D6BFF',
    bodyMid: '#5433CC',
    bodyBottom: '#28156E',
    border: 'rgba(22, 9, 64, 0.95)',
    pip: '#FFD75E',
  },
};

/** Texture key of a face frame for a skin ('classic' keeps the legacy keys). */
export function diceFaceKey(skin: DiceSkinId, value: number): string {
  return skin === 'classic' ? `dice_face_${value}` : `dice_${skin}_face_${value}`;
}

/** Animation key of the tumble loop for a skin. */
export function diceTumbleAnim(skin: DiceSkinId): string {
  return skin === 'classic' ? 'dice_tumble' : `dice_${skin}_tumble`;
}

/**
 * LW "GO" speech bubble the die sits in, beside the active player's chip.
 * Tail on the LEFT edge (flipX for right-side chips).
 */
export function bakeGoBubble(scene: Phaser.Scene): void {
  const key = 'go_bubble';
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  // RAW logical px (not dp): the sprite renders at 1/LR_BAKE_SCALE, so the
  // on-screen bubble is exactly 98x70 — small enough to never crowd the chip.
  const w = 86;
  const h = 70;
  const tail = 12;
  // Transparent padding on every side so a full-contour drop shadow can bloom
  // without the canvas edge clipping it (Jose: shadow all around, not just below).
  const pad = 8;
  const { ctx, texture } = makeCanvas(scene, key, (w + tail + pad * 2) * S, (h + pad * 2) * S);
  ctx.scale(S, S);
  ctx.translate(tail + pad, pad);
  // Small clean WHITE speech bubble with a clear tail (Jose's reference):
  // the die (or the GO) lives inside; it floats BESIDE the avatar chip.
  const bodyPath = () => roundedRectPath(ctx, 2, 2, w - 4, h - 7, 24);
  const tailPath = () => {
    ctx.beginPath();
    ctx.moveTo(4, h * 0.3);
    ctx.lineTo(-tail + 2, h * 0.5);
    ctx.lineTo(4, h * 0.7);
    ctx.closePath();
  };
  ctx.save();
  // Even soft shadow around the WHOLE silhouette (offset 0 = same halo on
  // every edge, not a heavy band below).
  ctx.shadowColor = 'rgba(20, 10, 50, 0.5)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  bodyPath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  tailPath();
  ctx.fill();
  ctx.restore();
  // Silhouette stroke FIRST, fills after: the fills cover the inner half of
  // each stroke and the body/tail seam, leaving one crisp outer outline.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(58, 34, 112, 0.3)';
  ctx.lineJoin = 'round';
  bodyPath();
  ctx.stroke();
  tailPath();
  ctx.stroke();
  tailPath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#eeeaf9');
  bodyPath();
  ctx.fillStyle = grad;
  ctx.fill();
  // Tiny top gloss so it reads candy, not flat.
  const gloss = ctx.createLinearGradient(0, 4, 0, h * 0.4);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  roundedRectPath(ctx, 8, 5, w - 16, h * 0.3, 16);
  ctx.fillStyle = gloss;
  ctx.fill();
  texture.refresh();
}

export function bakeDice(scene: Phaser.Scene): void {
  bakeSkinSet(scene, 'classic');
  // One face_5 preview per skin so the shop/backpack tiles always resolve.
  for (const skin of DICE_SKINS) {
    bakeFrame(scene, diceFaceKey(skin, 5), 5, 0, 1, 1, SKIN_PALETTES[skin]);
  }
}

/**
 * Bake the full frame set + tumble animation of one skin on demand (match
 * start). Same PRNG seed as classic, so every skin tumbles with identical
 * poses — only the paint differs.
 */
export function ensureDiceSkin(scene: Phaser.Scene, skin: DiceSkinId): void {
  // Runtime guard: callers may cast a server-provided asset_key.
  if (skin !== 'classic' && !(DICE_SKINS as readonly string[]).includes(skin)) return;
  bakeSkinSet(scene, skin);
}

function bakeSkinSet(scene: Phaser.Scene, skin: DiceSkinId): void {
  const pal = skin === 'classic' ? undefined : SKIN_PALETTES[skin];
  for (let v = 1; v <= 6; v++) {
    bakeFrame(scene, diceFaceKey(skin, v), v, 0, 1, 1, pal);
  }
  const prefix = skin === 'classic' ? 'dice_tumble' : `dice_${skin}_tumble`;
  const rand = mulberry32(0x1d05);
  for (let i = 0; i < LR_MOTION.dice.tumbleFrames; i++) {
    const angle = (i / LR_MOTION.dice.tumbleFrames) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const squash = 0.9 + rand() * 0.2;
    const face = 1 + Math.floor(rand() * 6);
    bakeFrame(scene, `${prefix}_${i}`, face, angle, squash, 2 - squash, pal);
  }
  ensureTumbleAnimation(scene, skin);
}

function bakeFrame(
  scene: Phaser.Scene,
  key: string,
  face: number,
  angle: number,
  sx: number,
  sy: number,
  pal?: DicePalette,
): void {
  if (scene.textures.exists(key)) return;
  const S = LR_BAKE_SCALE;
  const { ctx, texture } = makeCanvas(scene, key, CANVAS * S, CANVAS * S);
  ctx.scale(S, S);
  ctx.translate(CANVAS / 2, CANVAS / 2);
  ctx.rotate(angle);
  ctx.scale(sx, sy);

  const half = DIE_SIZE / 2;
  const r = DIE_SIZE * 0.22;

  const body = ctx.createLinearGradient(0, -half, 0, half);
  body.addColorStop(0, pal ? pal.bodyTop : cssColor(LR_COLORS.surface));
  body.addColorStop(0.75, pal ? pal.bodyMid : cssColor(LR_COLORS.surface2));
  body.addColorStop(1, pal ? pal.bodyBottom : cssColor(LR_COLORS.surfaceSunken));
  roundedRectPath(ctx, -half, -half, DIE_SIZE, DIE_SIZE, r);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal ? pal.border : cssRgba(LR_COLORS.borderStrong, 0.8);
  ctx.stroke();

  // Soft top-light sheen.
  const sheen = ctx.createLinearGradient(0, -half, 0, -half * 0.1);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  roundedRectPath(ctx, -half + 4, -half + 4, DIE_SIZE - 8, half * 0.8, r * 0.8);
  ctx.fillStyle = sheen;
  ctx.fill();

  const pipR = DIE_SIZE * 0.09;
  const spread = half * 0.58;
  for (const [px, py] of PIPS[face] ?? []) {
    ctx.beginPath();
    ctx.arc(px * spread * 1.35, py * spread * 1.35, pipR, 0, Math.PI * 2);
    ctx.fillStyle = pal ? pal.pip : cssColor(LR_COLORS.panelInk);
    ctx.fill();
    if (pal) {
      // Colored bodies need a grounded pip: thin dark ring for contrast.
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = pal.border;
      ctx.stroke();
    }
  }

  texture.refresh();
}

function ensureTumbleAnimation(scene: Phaser.Scene, skin: DiceSkinId): void {
  const animKey = diceTumbleAnim(skin);
  if (scene.anims.exists(animKey)) return;
  const prefix = skin === 'classic' ? 'dice_tumble' : `dice_${skin}_tumble`;
  const frames: Phaser.Types.Animations.AnimationFrame[] = [];
  for (let i = 0; i < LR_MOTION.dice.tumbleFrames; i++) {
    frames.push({ key: `${prefix}_${i}`, frame: '__BASE' });
  }
  scene.anims.create({
    key: animKey,
    frames,
    frameRate: LR_MOTION.dice.tumbleFps,
    repeat: -1,
  });
}

/**
 * Recessed tray the action-zone die SITS in (Jose feedback: the die must
 * look attached, not floating) - dark violet socket with an inner shadow.
 */
export function bakeDiceTray(scene: Phaser.Scene): void {
  if (scene.textures.exists('dice_tray')) return;
  const w = dp(196);
  const h = dp(178);
  const r = dp(36);
  const S = LR_BAKE_SCALE;
  const { ctx, texture } = makeCanvas(scene, 'dice_tray', w * S, h * S);
  ctx.scale(S, S);
  roundedRectPath(ctx, 2, 4, w - 4, h - 8, r);
  ctx.fillStyle = cssRgba(LR_COLORS.hudInk, 0.9);
  ctx.fill();
  ctx.save();
  roundedRectPath(ctx, 2, 4, w - 4, h - 8, r);
  ctx.clip();
  const inner = ctx.createLinearGradient(0, 4, 0, h - 4);
  inner.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
  inner.addColorStop(0.35, 'rgba(0, 0, 0, 0)');
  inner.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  roundedRectPath(ctx, 3.5, 5.5, w - 7, h - 11, r - 2);
  ctx.strokeStyle = cssRgba(LR_COLORS.gold500, 0.45);
  ctx.lineWidth = 2;
  ctx.stroke();
  texture.refresh();
}
