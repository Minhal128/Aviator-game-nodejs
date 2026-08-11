/**
 * Shop cosmetics bakery — pawn skins, chat-bubble styles and the small
 * shop/backpack preview tiles (board themes bake in bakeBoard).
 *
 * PAWN SKINS (`token_skin` items) composite an accessory OVER the current
 * `piece_<color>` texture (Jose's art when loaded, the procedural pawn as
 * fallback), so a skin never downgrades the base look. The head position is
 * MEASURED from the pixels (topmost opaque row around the center column) —
 * accessories sit correctly on both art and procedural pawns. Baked lazily:
 * one red preview per skin at splash, the 4-color set at match start.
 *
 * BUBBLE SKINS (`bubble_skin` items) are palettes AvatarChip reads when it
 * draws the speech bubble; only the preview tile is baked here.
 */
import type Phaser from 'phaser';
import type { PlayerColor } from '@ludo/shared';
import { LR_COLORS, cssColor, cssRgba } from '../../theme/tokens';
import { makeCanvas, roundedRectPath } from './canvasKit';

const COLORS: readonly PlayerColor[] = ['red', 'blue', 'yellow', 'green'];

// ---------------------------------------------------------------------------
// Pawn skins
// ---------------------------------------------------------------------------

export const TOKEN_SKINS = ['face', 'crown', 'aura'] as const;
export type TokenSkinId = (typeof TOKEN_SKINS)[number] | 'classic';

/** Texture key a piece wears for a skin ('classic' = the base texture). */
export function pieceSkinKey(color: PlayerColor, skin: TokenSkinId): string {
  return skin === 'classic' ? `piece_${color}` : `piece_${color}_s_${skin}`;
}

/** Server asset_key → skin id ('classic' when unknown/stale). */
export function normalizeTokenSkin(key: string): TokenSkinId {
  return (TOKEN_SKINS as readonly string[]).includes(key) ? (key as TokenSkinId) : 'classic';
}

/** Bake the 4-color set of one skin (match start). */
export function ensureTokenSkin(scene: Phaser.Scene, skin: TokenSkinId): void {
  if (skin === 'classic') return;
  for (const color of COLORS) bakeSkinnedPawn(scene, pieceSkinKey(color, skin), color, skin);
}

function bakeSkinnedPawn(
  scene: Phaser.Scene,
  key: string,
  color: PlayerColor,
  skin: Exclude<TokenSkinId, 'classic'>,
): void {
  if (scene.textures.exists(key)) return;
  const src = scene.textures.get(`piece_${color}`).getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement;
  const w = src.width;
  const h = src.height;
  const { ctx, texture } = makeCanvas(scene, key, w, h);

  // Aura paints BEHIND the pawn, everything else on top.
  if (skin === 'aura') {
    const glow = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.05, w / 2, h * 0.55, h * 0.5);
    glow.addColorStop(0, 'rgba(96, 240, 255, 0.5)');
    glow.addColorStop(0.6, 'rgba(150, 120, 255, 0.28)');
    glow.addColorStop(1, 'rgba(150, 120, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0);

  // Head metrics measured from pixels: topmost opaque row near the center,
  // then the opaque width a bit below it (the head sphere).
  const data = ctx.getImageData(0, 0, w, h).data;
  const alphaAt = (x: number, y: number): number => data[(y * w + x) * 4 + 3] ?? 0;
  let topY = 0;
  outer: for (let y = 0; y < h; y++) {
    for (let x = Math.floor(w * 0.32); x < w * 0.68; x += 2) {
      if (alphaAt(x, y) > 60) {
        topY = y;
        break outer;
      }
    }
  }
  const headRow = Math.min(h - 1, Math.floor(topY + h * 0.1));
  let left = Math.floor(w * 0.5);
  let right = Math.ceil(w * 0.5);
  for (let x = 0; x < w; x++) if (alphaAt(x, headRow) > 60) left = Math.min(left, x);
  for (let x = w - 1; x >= 0; x--) if (alphaAt(x, headRow) > 60) right = Math.max(right, x);
  const headW = Math.max(w * 0.2, right - left);
  const cx = (left + right) / 2;

  if (skin === 'face') {
    // Candy gloss + white-oval eyes with ink pupils + a thin smile.
    const eyeY = topY + h * 0.14;
    const dx = headW * 0.2;
    const eyeR = headW * 0.1;
    ctx.beginPath();
    ctx.ellipse(cx - headW * 0.16, topY + h * 0.07, headW * 0.22, headW * 0.12, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
    for (const side of [-1, 1]) {
      const ex = cx + side * dx;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, eyeY + eyeR * 0.25, eyeR * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(LR_COLORS.panelInk);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.25, eyeY - eyeR * 0.1, eyeR * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, eyeY + headW * 0.22, headW * 0.16, Math.PI * 0.2, Math.PI * 0.8);
    ctx.strokeStyle = cssRgba(LR_COLORS.panelInk, 0.55);
    ctx.lineWidth = Math.max(1.5, w * 0.012);
    ctx.stroke();
  } else if (skin === 'crown') {
    // Gold 3-spike crown resting on the head top, candy outline + jewels.
    const cw = headW * 0.74;
    const ch = h * 0.11;
    const baseY = topY + h * 0.045;
    const grad = ctx.createLinearGradient(cx, baseY - ch, cx, baseY);
    grad.addColorStop(0, cssColor(LR_COLORS.gold300));
    grad.addColorStop(1, cssColor(LR_COLORS.gold700));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - cw / 2, baseY);
    ctx.lineTo(cx - cw / 2, baseY - ch * 0.72);
    ctx.lineTo(cx - cw * 0.22, baseY - ch * 0.3);
    ctx.lineTo(cx, baseY - ch);
    ctx.lineTo(cx + cw * 0.22, baseY - ch * 0.3);
    ctx.lineTo(cx + cw / 2, baseY - ch * 0.72);
    ctx.lineTo(cx + cw / 2, baseY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.strokeStyle = cssColor(LR_COLORS.gold700);
    ctx.lineWidth = Math.max(1.5, w * 0.014);
    ctx.fill();
    ctx.stroke();
    // Ball tips + a ruby jewel on the band.
    for (const [sx, sy] of [
      [-cw / 2, -ch * 0.72],
      [0, -ch],
      [cw / 2, -ch * 0.72],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + sx, baseY + sy, Math.max(1.6, w * 0.016), 0, Math.PI * 2);
      ctx.fillStyle = cssColor(LR_COLORS.gold300);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, baseY - ch * 0.28, Math.max(1.8, w * 0.02), 0, Math.PI * 2);
    ctx.fillStyle = cssColor(LR_COLORS.danger);
    ctx.fill();
    ctx.restore();
  } else {
    // aura: neon base ring + additive sparkles over the body.
    const baseY = h * 0.9;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w / 2, baseY, headW * 0.85, headW * 0.28, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(96, 240, 255, 0.75)';
    ctx.lineWidth = Math.max(2, w * 0.02);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const spark = (sx: number, sy: number, r: number): void => {
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.quadraticCurveTo(sx, sy, sx + r, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy + r);
      ctx.quadraticCurveTo(sx, sy, sx - r, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy - r);
      ctx.fillStyle = 'rgba(180, 240, 255, 0.9)';
      ctx.fill();
    };
    spark(cx - headW * 0.55, topY + h * 0.16, w * 0.035);
    spark(cx + headW * 0.6, topY + h * 0.3, w * 0.028);
    spark(cx + headW * 0.35, h * 0.62, w * 0.04);
    spark(cx - headW * 0.5, h * 0.72, w * 0.025);
    ctx.restore();
  }

  texture.refresh();
}

// ---------------------------------------------------------------------------
// Bubble skins
// ---------------------------------------------------------------------------

export const BUBBLE_SKINS = ['gold', 'candy', 'ink'] as const;
export type BubbleSkinId = (typeof BUBBLE_SKINS)[number] | 'classic';

export interface BubbleStyle {
  fill: number;
  stroke: number;
  /** CSS color of the phrase text (contrast against fill). */
  text: string;
}

export const BUBBLE_STYLES: Readonly<Record<BubbleSkinId, BubbleStyle>> = {
  classic: { fill: 0xffffff, stroke: 0xd9d2f0, text: '#3b3468' },
  gold: { fill: 0xffd75e, stroke: 0xc98a12, text: '#5a3c00' },
  candy: { fill: 0xff9fce, stroke: 0xd6488f, text: '#5c1338' },
  ink: { fill: 0x3b3468, stroke: 0x8c83d5, text: '#ffffff' },
};

export function normalizeBubbleSkin(key: string): BubbleSkinId {
  return (BUBBLE_SKINS as readonly string[]).includes(key) ? (key as BubbleSkinId) : 'classic';
}

// ---------------------------------------------------------------------------
// Shop / backpack preview tiles
// ---------------------------------------------------------------------------

/**
 * Bake every preview the shop and backpack grids resolve: one red pawn per
 * skin, one bubble per style (incl. classic) and one mini board per theme
 * (incl. classic). Runs at splash AFTER pieces/art are ready.
 */
export function bakeShopPreviews(scene: Phaser.Scene): void {
  for (const skin of TOKEN_SKINS) bakeSkinnedPawn(scene, pieceSkinKey('red', skin), 'red', skin);
  for (const id of ['classic', ...BUBBLE_SKINS] as const) bakeBubblePreview(scene, id);
  bakeThemePreview(scene, 'board_prev_classic', 0xfdf3dc, 0xfffdf6, 0x5b5aa8);
  bakeThemePreview(scene, 'board_prev_ocean', 0x8ec7e6, 0xd9edf9, 0x1e5680);
  bakeThemePreview(scene, 'board_prev_night', 0x14102c, 0x2c2558, 0x0d0a20);
}

function bakeBubblePreview(scene: Phaser.Scene, id: BubbleSkinId): void {
  const key = `bubble_prev_${id}`;
  if (scene.textures.exists(key)) return;
  const s = BUBBLE_STYLES[id];
  const { ctx, texture } = makeCanvas(scene, key, 120, 96);
  roundedRectPath(ctx, 10, 12, 100, 58, 20);
  ctx.fillStyle = cssColor(s.fill);
  ctx.fill();
  ctx.strokeStyle = cssColor(s.stroke);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(48, 68);
  ctx.lineTo(72, 68);
  ctx.lineTo(58, 86);
  ctx.closePath();
  ctx.fillStyle = cssColor(s.fill);
  ctx.fill();
  for (const dx of [-22, 0, 22]) {
    ctx.beginPath();
    ctx.arc(60 + dx, 41, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = s.text;
    ctx.fill();
  }
  texture.refresh();
}

/** Mini board swatch: tray + surface + the 4 player corners + medallion. */
function bakeThemePreview(scene: Phaser.Scene, key: string, tray: number, surface: number, medallion: number): void {
  if (scene.textures.exists(key)) return;
  const { ctx, texture } = makeCanvas(scene, key, 120, 120);
  roundedRectPath(ctx, 4, 4, 112, 112, 18);
  ctx.fillStyle = cssColor(tray);
  ctx.fill();
  ctx.strokeStyle = cssColor(LR_COLORS.gold500);
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRectPath(ctx, 14, 14, 92, 92, 12);
  ctx.fillStyle = cssColor(surface);
  ctx.fill();
  const corners: Array<[number, number, number]> = [
    [14, 14, 0xe94f4f],
    [70, 14, 0x3d8bfd],
    [14, 70, 0x37b45f],
    [70, 70, 0xf4b62a],
  ];
  ctx.save();
  roundedRectPath(ctx, 14, 14, 92, 92, 12);
  ctx.clip();
  for (const [x, y, color] of corners) {
    ctx.fillStyle = cssRgba(color, 0.92);
    ctx.fillRect(x, y, 36, 36);
  }
  ctx.restore();
  roundedRectPath(ctx, 48, 48, 24, 24, 7);
  ctx.fillStyle = cssColor(medallion);
  ctx.fill();
  texture.refresh();
}
