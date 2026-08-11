/** Text factories bound to the token type scale (STYLE-GUIDE §7). */
import type Phaser from 'phaser';
import { LR_COLORS, LR_FONTS, cssColor, cssRgba, dp } from '../../theme/tokens';

export function uiText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  sizePx: number,
  color: number = LR_COLORS.text,
  weight: '500' | '600' | '700' | '800' = '600',
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, str, {
      fontFamily: LR_FONTS.ui,
      fontSize: `${sizePx}px`,
      fontStyle: weight,
      color: cssColor(color),
    })
    .setOrigin(0.5);
}

export function displayText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  sizePx: number,
  color: number = LR_COLORS.text,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, str, {
      fontFamily: LR_FONTS.display,
      fontSize: `${sizePx}px`,
      fontStyle: '800',
      color: cssColor(color),
    })
    .setOrigin(0.5);
}

export interface GameTextOptions {
  /** 4-corner gradient tint (tl, tr, bl, br) — gold for rewards, brand for logo. */
  tint?: readonly [number, number, number, number];
  /** Override the ink outline (e.g. ribbon titles use sceneRibbonInk). */
  strokeColor?: number;
  stroke?: boolean;
  hardShadow?: boolean;
}

/**
 * Level-A game typography (LUDOWORLD-PARITY §7): hero titles / big numbers
 * get a chunky outline (size·0.14, clamped dp(4)–dp(9)) + a blur-less hard
 * shadow in purple ink — the "game, not web" signature. Stroke defaults to
 * the cool dark-violet outline (white titles over the scene); GOLD titles
 * and numbers pass `titleStrokeBrown` / `titleStrokeDark`, warm-card titles
 * pass `titleStrokeBrown`. NEVER use on body copy or below dp(16); uiText
 * stays Level C untouched.
 */
export function gameText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  sizePx: number,
  opts: GameTextOptions = {},
): Phaser.GameObjects.Text {
  const txt = scene.add
    .text(x, y, str, {
      fontFamily: LR_FONTS.display,
      fontSize: `${sizePx}px`,
      fontStyle: '800',
      color: '#ffffff',
    })
    .setOrigin(0.5);
  if (opts.stroke ?? true) {
    const thickness = Math.round(Math.min(Math.max(sizePx * 0.14, dp(4)), dp(9)));
    txt.setStroke(cssColor(opts.strokeColor ?? LR_COLORS.titleStrokeCool), thickness);
  }
  if (opts.hardShadow ?? true) {
    txt.setShadow(0, dp(4), cssRgba(LR_COLORS.sceneShadowInk, 0.55), 0, false, true);
  }
  if (opts.tint) {
    txt.setTint(opts.tint[0], opts.tint[1], opts.tint[2], opts.tint[3]);
  }
  return txt;
}
