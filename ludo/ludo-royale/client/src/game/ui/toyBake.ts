/**
 * Shared "toy" bakery + press-sink interaction (ARTPASS-GAMEFEEL §2/§4/§5).
 * Buttons, mode cards, ink panels and pennant ribbons all draw from here so
 * the whole UI shares one molded-plastic language: two-part drop shadow
 * (baked as a SEPARATE sprite so pressing can shrink it), gradient body,
 * light lip on top / dark lip on bottom, gloss, exterior outline.
 * Every texture is cached per style+size.
 */
import Phaser from 'phaser';
import { LR_ART, LR_BAKE_SCALE, LR_COLORS, cssColor, cssRgba, dp } from '../../theme/tokens';
import { haptic } from '../../core/haptics';
import { sfx } from '../../core/audio';
import { makeCanvas, roundedRectPath } from '../textures/canvasKit';
import { reducedMotion } from '../fx/Juice';

export type ToyStyle =
  | 'brand'
  | 'surface'
  | 'danger'
  | 'success'
  | 'amber'
  | 'online'
  | 'cpu'
  | 'local'
  | 'collect'
  | 'double'
  | 'muted';

interface ToyStyleSpec {
  /** Gradient start / end and the "-dark" variant used by bevel + outline. */
  a: number;
  b: number;
  dark: number;
  diagonal: boolean;
  /** LUDOWORLD-PARITY §2.2: thick 3D base slab painted dp(12) below the body. */
  slab?: boolean;
}

const STYLE: Readonly<Record<ToyStyle, ToyStyleSpec>> = {
  brand: { a: LR_COLORS.brand1, b: LR_COLORS.brand2, dark: LR_COLORS.brand700, diagonal: true },
  surface: { a: LR_COLORS.surface, b: LR_COLORS.surface, dark: LR_COLORS.borderStrong, diagonal: false },
  danger: { a: LR_COLORS.danger, b: LR_COLORS.sceneRibbonRedDk, dark: LR_COLORS.sceneRibbonRedDk, diagonal: false },
  success: { a: LR_COLORS.success, b: LR_COLORS.successDark, dark: LR_COLORS.successDeep, diagonal: false },
  amber: { a: LR_COLORS.gold500, b: LR_COLORS.gold700, dark: LR_COLORS.gold700, diagonal: false },
  // LUDOWORLD-PARITY §2.3 mode cards — each mode owns a warm saturated body.
  online: { a: LR_COLORS.cardOnlineA, b: LR_COLORS.cardOnlineB, dark: LR_COLORS.cardOnlineDark, diagonal: false, slab: true },
  cpu: { a: LR_COLORS.cardCpuA, b: LR_COLORS.cardCpuB, dark: LR_COLORS.cardCpuDark, diagonal: false, slab: true },
  local: { a: LR_COLORS.cardLocalA, b: LR_COLORS.cardLocalB, dark: LR_COLORS.cardLocalDark, diagonal: false, slab: true },
  // LUDOWORLD-PARITY §1.8/§6.6 glossy popup CTAs.
  collect: { a: LR_COLORS.collectA, b: LR_COLORS.collectB, dark: LR_COLORS.collectDark, diagonal: false, slab: true },
  double: { a: LR_COLORS.doubleA, b: LR_COLORS.doubleB, dark: LR_COLORS.doubleDark, diagonal: false, slab: true },
  // LW gray "Start" while the table lacks players — pressable but inert.
  muted: { a: 0x9aa3b8, b: 0x7f889c, dark: 0x636b7d, diagonal: false, slab: true },
};

/** Extra canvas padding around toy bodies so the exterior outline fits. */
export const TOY_PAD = dp(4);

/**
 * Layers 2-6 of the §2 stack (body, dark lip, light lip, gloss, outline).
 * The 2-part shadow (layer 1) lives in its own texture — see ensureToyShadow.
 */
export function ensureToyBody(scene: Phaser.Scene, style: ToyStyle, w: number, h: number, r: number): string {
  const key = `toy_${style}_${w}x${h}x${r}`;
  if (scene.textures.exists(key)) return key;
  const S = LR_BAKE_SCALE;
  const spec = STYLE[style];
  // §2.2 base slab needs headroom below the body; pad symmetrically so the
  // body keeps sitting at the sprite's visual center (hit-area invariant).
  const slabDrop: number = spec.slab === true ? dp(12) : 0;
  const padY = TOY_PAD + slabDrop;
  const { ctx, texture } = makeCanvas(scene, key, (w + TOY_PAD * 2) * S, (h + padY * 2) * S);
  ctx.scale(S, S);
  ctx.translate(TOY_PAD, padY);

  // LUDOWORLD-PARITY §2.2: base slab — same rounded rect in the "-dark"
  // color, offset dp(12) down, painted BEFORE the body so only its bottom
  // edge shows. The card reads as an extruded physical piece; the §2
  // press-sink then pushes the body into its own base.
  if (slabDrop > 0) {
    roundedRectPath(ctx, 0, slabDrop, w, h, r);
    ctx.fillStyle = cssColor(spec.dark);
    ctx.fill();
  }

  // Body gradient.
  const body = spec.diagonal
    ? ctx.createLinearGradient(0, 0, w, h)
    : ctx.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, cssColor(spec.a));
  body.addColorStop(1, cssColor(spec.b));
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.fillStyle = body;
  ctx.fill();

  // Bevels: inner strokes clipped to the silhouette (half of a 2x-width
  // stroke stays inside — the classic inner-stroke trick).
  ctx.save();
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();
  const darkLip = ctx.createLinearGradient(0, 0, 0, h);
  darkLip.addColorStop(0.45, cssRgba(spec.dark, 0));
  darkLip.addColorStop(1, cssRgba(spec.dark, 0.5));
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = darkLip;
  ctx.lineWidth = dp(3) * 2;
  ctx.stroke();
  const lightLip = ctx.createLinearGradient(0, 0, 0, h);
  lightLip.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  lightLip.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = lightLip;
  ctx.lineWidth = dp(2) * 2;
  ctx.stroke();
  ctx.restore();

  // Gloss: top 42%, inset dp(4) (same sheen bakeDice already uses).
  const inset = dp(4);
  const glossH = h * 0.42;
  const gloss = ctx.createLinearGradient(0, inset, 0, inset + glossH);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  roundedRectPath(ctx, inset, inset, w - inset * 2, glossH, Math.max(4, r - inset));
  ctx.fillStyle = gloss;
  ctx.fill();

  // Exterior outline: lifts the piece off the stage instead of floating.
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = cssColor(spec.dark);
  ctx.lineWidth = dp(2);
  ctx.stroke();

  texture.refresh();
  return key;
}

/** Canvas padding around the detached shadow (room for the soft blur). */
export const TOY_SHADOW_PAD = dp(24);

/**
 * Two-part drop shadow (§2.1) baked centered so the sprite's own y-offset
 * (LR_ART.sink.shadowRestDp → shadowPressDp) animates the press. Uses the
 * offscreen-shape trick: shape drawn out of canvas, only its shadow lands.
 */
export function ensureToyShadow(scene: Phaser.Scene, w: number, h: number, r: number): string {
  const key = `toysh_${w}x${h}x${r}`;
  if (scene.textures.exists(key)) return key;
  const S = LR_BAKE_SCALE;
  const pad = TOY_SHADOW_PAD;
  const cw = (w + pad * 2) * S;
  const ch = (h + pad * 2) * S;
  const { ctx, texture } = makeCanvas(scene, key, cw, ch);
  const off = ch * 2;

  const pass = (blur: number, alpha: number): void => {
    ctx.save();
    ctx.shadowColor = cssRgba(LR_COLORS.sceneShadowInk, alpha);
    ctx.shadowBlur = blur * S;
    ctx.shadowOffsetY = off;
    roundedRectPath(ctx, pad * S, pad * S - off, w * S, h * S, r * S);
    ctx.fillStyle = cssColor(LR_COLORS.sceneShadowInk);
    ctx.fill();
    ctx.restore();
  };
  pass(dp(18), 0.28); // soft / ambient
  pass(dp(4), 0.45); // hard / contact

  texture.refresh();
  return key;
}

/**
 * Chrome panel with toy bevel + gold hairline (§4.6): match HUD pill,
 * board-side chrome. LUDOWORLD-PARITY §1.6/§3: surfaces are candy-violet
 * `hudInk` (panelInk stays text/ink only). Alpha'd fill so the stage still
 * breathes through slightly.
 */
export function ensureInkPanel(
  scene: Phaser.Scene,
  w: number,
  h: number,
  r: number,
  fillAlpha: number = 0.88,
): string {
  const key = `inkpanel_${w}x${h}x${r}`;
  if (scene.textures.exists(key)) return key;
  const S = LR_BAKE_SCALE;
  const pad = dp(12);
  const { ctx, texture } = makeCanvas(scene, key, (w + pad * 2) * S, (h + pad * 2) * S);
  ctx.scale(S, S);
  ctx.translate(pad, pad);

  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.sceneShadowInk, 0.35);
  ctx.shadowBlur = dp(10) * S;
  ctx.shadowOffsetY = dp(4) * S;
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.fillStyle = cssRgba(LR_COLORS.hudInk, fillAlpha);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();
  const lipLight = ctx.createLinearGradient(0, 0, 0, h);
  lipLight.addColorStop(0, cssRgba(LR_COLORS.sceneBevelLight, 0.9));
  lipLight.addColorStop(0.45, cssRgba(LR_COLORS.sceneBevelLight, 0));
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = lipLight;
  ctx.lineWidth = dp(2) * 2;
  ctx.stroke();
  const lipDark = ctx.createLinearGradient(0, 0, 0, h);
  lipDark.addColorStop(0.55, cssRgba(LR_COLORS.sceneBevelDark, 0));
  lipDark.addColorStop(1, cssRgba(LR_COLORS.sceneBevelDark, 0.9));
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = lipDark;
  ctx.lineWidth = dp(3) * 2;
  ctx.stroke();
  ctx.restore();

  // Premium gold hairline just inside the edge (Clash-Royale rim, subtle).
  roundedRectPath(ctx, 2, 2, w - 4, h - 4, Math.max(4, r - 2));
  ctx.strokeStyle = cssRgba(LR_COLORS.gold500, 0.35);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  texture.refresh();
  return key;
}

/** Pennant ribbon geometry shared by badges (§2) and celebration (§5). */
export interface PennantSpec {
  w: number;
  h: number;
  /** Depth of the V-notch cut into the tail end(s). */
  notch: number;
  /** 'right' = badge pennant (pin on the left); 'both' = celebration banner. */
  tails: 'right' | 'both';
  gradTop: number;
  gradBottom: number;
  /** Gold pinstripes above/below (celebration banner) vs single white line. */
  goldPinstripes: boolean;
  /** x positions (from left) where a darker fold triangle is drawn under. */
  folds: readonly number[];
}

export function ensurePennant(scene: Phaser.Scene, key: string, spec: PennantSpec): string {
  if (scene.textures.exists(key)) return key;
  const S = LR_BAKE_SCALE;
  const foldH = dp(8);
  const { ctx, texture } = makeCanvas(scene, key, (spec.w + 8) * S, (spec.h + foldH + 8) * S);
  ctx.scale(S, S);
  ctx.translate(4, 2);
  const { w, h, notch } = spec;

  const band = (): void => {
    ctx.beginPath();
    if (spec.tails === 'both') {
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - notch, h / 2);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.lineTo(notch, h / 2);
    } else {
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w - notch, h / 2);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
    }
    ctx.closePath();
  };

  // Baked drop shadow, then the red-gold gradient body.
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.sceneShadowInk, 0.35);
  ctx.shadowBlur = dp(5) * S;
  ctx.shadowOffsetY = dp(2) * S;
  band();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, cssColor(spec.gradTop));
  g.addColorStop(1, cssColor(spec.gradBottom));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.save();
  band();
  ctx.clip();
  if (spec.goldPinstripes) {
    ctx.fillStyle = cssColor(LR_COLORS.gold500);
    ctx.fillRect(0, 3, w, 2);
    ctx.fillRect(0, h - 5, w, 2);
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(0, 2, w, 2);
  }
  // Gloss across the top half.
  const gloss = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, w, h * 0.55);
  ctx.restore();

  // Darker fold triangles where the ribbon meets the panel (sells the drape).
  ctx.fillStyle = cssRgba(spec.gradBottom, 0.4);
  for (const fx of spec.folds) {
    ctx.beginPath();
    ctx.moveTo(fx, h);
    ctx.lineTo(fx + dp(12), h);
    ctx.lineTo(fx, h + foldH);
    ctx.closePath();
    ctx.fill();
  }

  texture.refresh();
  return key;
}

export interface ToyPressParts {
  /** Everything that visually sinks (bg + label + icons). */
  body: Phaser.GameObjects.Container;
  /** The detached shadow sprite (rest y = dp(shadowRestDp), alpha .9). */
  shadow: Phaser.GameObjects.Image;
}

/** UX sprint §2: ghost second taps inside this window never re-fire onTap. */
const DOUBLE_TAP_MS = 300;

/**
 * §2 press: body sinks dp(5) + squashes while the shadow shrinks/rises —
 * the object visibly travels down to its shadow. Replaces the uniform
 * pressFeedback scale for toy buttons/cards. Reduced motion: alpha dip only.
 * Every accepted tap also fires a 10ms haptic tick (§4, self-guarded).
 */
export function attachToyPress(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  parts: ToyPressParts,
  onTap: () => void,
): void {
  const sink = LR_ART.sink;
  const bodyRestY = parts.body.y;
  const shadowRestScale = parts.shadow.scaleX;
  let pressed = false;
  let lastTapAt = 0;

  const release = (): void => {
    if (reducedMotion()) {
      scene.tweens.add({ targets: target, alpha: 1, duration: 120 });
      return;
    }
    scene.tweens.killTweensOf([parts.body, parts.shadow]);
    scene.tweens.add({
      targets: parts.body,
      y: bodyRestY,
      scaleY: 1,
      duration: sink.outMs,
      ease: 'Back.easeOut',
    });
    scene.tweens.add({
      targets: parts.shadow,
      y: dp(sink.shadowRestDp),
      scale: shadowRestScale,
      alpha: sink.shadowRestAlpha,
      duration: sink.outMs,
      ease: 'Back.easeOut',
    });
  };

  target.on(Phaser.Input.Events.POINTER_DOWN, () => {
    sfx('tap');
    pressed = true;
    if (reducedMotion()) {
      target.setAlpha(0.85);
      return;
    }
    scene.tweens.killTweensOf([parts.body, parts.shadow]);
    scene.tweens.add({
      targets: parts.body,
      y: bodyRestY + dp(sink.dropDp),
      scaleY: sink.bodyScaleY,
      duration: sink.inMs,
      ease: 'Quad.easeIn',
    });
    scene.tweens.add({
      targets: parts.shadow,
      y: dp(sink.shadowPressDp),
      scale: shadowRestScale * sink.shadowScale,
      alpha: sink.shadowAlpha,
      duration: sink.inMs,
      ease: 'Quad.easeIn',
    });
  });
  target.on(Phaser.Input.Events.POINTER_UP, () => {
    if (!pressed) return;
    pressed = false;
    release();
    // Anti double-tap (§2): fast second taps and touch+mouse event dupes
    // used to double-fire navigation — the visual release still plays, the
    // action only fires once per window.
    const now = performance.now();
    if (now - lastTapAt < DOUBLE_TAP_MS) return;
    lastTapAt = now;
    haptic('tap');
    onTap();
  });
  target.on(Phaser.Input.Events.POINTER_OUT, () => {
    if (!pressed) return;
    pressed = false;
    release();
  });
}
