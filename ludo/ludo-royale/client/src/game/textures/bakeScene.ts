/**
 * Twilight STAGE background (ARTPASS-GAMEFEEL §1) — replaces the flat
 * bakeWorld gradient. Bakes:
 *  - `world_sky`      5-stop dusk gradient, magenta horizon glow, dim star
 *                     field, far skyline with lit windows, stage floor with
 *                     lit lip, board contact-glow and the original vignette.
 *  - `world_city_near` near skyline strip (own sprite so it can parallax),
 *                     with two domed towers + a beacon pinnacle as our
 *                     signature landmark (no ferris wheel — anti-copy).
 *  - `board_shadow`   soft ellipse that grounds the floating board (§4).
 *  - `fx_star4`       4-point star used by the live twinkle layer.
 * World-space values are fractions of GAME_W/GAME_H per the spec so the
 * bake survives a resolution change.
 */
import type Phaser from 'phaser';
import { BOARD_SIZE, BOARD_Y, GAME_H, GAME_W } from '../layout';
import { LR_BAKE_SCALE, LR_COLORS, cssColor, cssRgba, dp } from '../../theme/tokens';
import { makeCanvas, mulberry32 } from './canvasKit';

/** Near-skyline strip: 24px wider than the screen for the ±8px parallax. */
export const CITY_NEAR_W = GAME_W + 48;
export const CITY_NEAR_H = 300;
/** Deterministic beacon tip (canvas coords) so the live dot can sit on it. */
export const CITY_BEACON_X = Math.round(CITY_NEAR_W * 0.68);
export const CITY_BEACON_Y = 64;

const HORIZON_Y = 0.605 * GAME_H;
const GROUND_Y = 0.62 * GAME_H;

export function bakeScene(scene: Phaser.Scene): void {
  bakeSky(scene);
  bakeCityNear(scene);
  bakeBoardShadow(scene);
  bakeStar4(scene);
}

function bakeSky(scene: Phaser.Scene): void {
  if (scene.textures.exists('world_sky')) return;
  const { ctx, texture } = makeCanvas(scene, 'world_sky', GAME_W, GAME_H);

  // 1. 5-stop dusk gradient (§1.1).
  const sky = ctx.createLinearGradient(0, 0, 0, GAME_H);
  sky.addColorStop(0, cssColor(LR_COLORS.sceneSkyTop));
  sky.addColorStop(0.38, cssColor(LR_COLORS.sceneSkyUpper));
  sky.addColorStop(0.52, cssColor(LR_COLORS.sceneSkyMid));
  sky.addColorStop(0.78, cssColor(LR_COLORS.sceneSkyLower));
  sky.addColorStop(1, cssColor(LR_COLORS.sceneSkyBottom));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  // 2. Magenta dusk glow squashed on the horizon (§1.2).
  ctx.save();
  ctx.translate(GAME_W / 2, 0.6 * GAME_H);
  ctx.scale(1, 0.34);
  const glowR = GAME_W * 0.95;
  const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, glowR);
  glow.addColorStop(0, cssRgba(LR_COLORS.sceneHorizonGlow, 0.55));
  glow.addColorStop(1, cssRgba(LR_COLORS.sceneHorizonGlow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);
  ctx.restore();

  // 3. Warm horizon hairline, peaking at the center (§1.3).
  const line = ctx.createLinearGradient(0, 0, GAME_W, 0);
  line.addColorStop(0, cssRgba(LR_COLORS.sceneHorizonLine, 0));
  line.addColorStop(0.5, cssRgba(LR_COLORS.sceneHorizonLine, 0.4));
  line.addColorStop(1, cssRgba(LR_COLORS.sceneHorizonLine, 0));
  ctx.fillStyle = line;
  ctx.fillRect(0, HORIZON_Y, GAME_W, 4);

  // 4. Dim static star field (the bright twinkles are live sprites) (§1.4).
  const starRand = mulberry32(0x57a2);
  for (let i = 0; i < 62; i++) {
    const x = 12 + starRand() * (GAME_W - 24);
    const y = (0.04 + starRand() * 0.48) * GAME_H;
    const r = 0.6 + starRand() * 0.9;
    const gold = starRand() < 0.25;
    const a = 0.14 + starRand() * 0.28;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = cssRgba(gold ? LR_COLORS.sceneStarGold : LR_COLORS.sceneStar, a);
    ctx.fill();
  }

  // 5. Far skyline band with a hint of lit windows (§1.5).
  const farRand = mulberry32(0xc17a);
  ctx.save();
  let x = -10;
  while (x < GAME_W + 10) {
    const w = 24 + farRand() * 40;
    const h = 40 + farRand() * 110;
    const top = HORIZON_Y - h;
    ctx.fillStyle = cssRgba(LR_COLORS.sceneCityFar, 0.72);
    const shape = farRand();
    if (shape < 0.25) {
      // Domed roof.
      ctx.beginPath();
      ctx.moveTo(x, HORIZON_Y);
      ctx.lineTo(x, top + w / 4);
      ctx.arc(x + w / 2, top + w / 4, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, HORIZON_Y);
      ctx.closePath();
      ctx.fill();
    } else if (shape < 0.5) {
      // Gabled roof.
      ctx.beginPath();
      ctx.moveTo(x, HORIZON_Y);
      ctx.lineTo(x, top + 14);
      ctx.lineTo(x + w / 2, top);
      ctx.lineTo(x + w, top + 14);
      ctx.lineTo(x + w, HORIZON_Y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x, top, w, h);
      if (shape > 0.8) ctx.fillRect(x + w * 0.2, top - 12, w * 0.6, 12); // stepped
    }
    // Sparse warm windows (~8% density).
    for (let wy = top + 10; wy < HORIZON_Y - 8; wy += 12) {
      for (let wx = x + 5; wx < x + w - 6; wx += 10) {
        if (farRand() < 0.08) {
          ctx.fillStyle = cssRgba(LR_COLORS.sceneWindowWarm, 0.45);
          ctx.fillRect(wx, wy, 3, 4);
        }
      }
      ctx.fillStyle = cssRgba(LR_COLORS.sceneCityFar, 0.72);
    }
    x += w + 2 + farRand() * 10;
  }
  ctx.restore();

  // 6. Stage floor + lit platform lip (§1.6).
  ctx.fillStyle = cssColor(LR_COLORS.sceneGround);
  ctx.fillRect(0, GROUND_Y, GAME_W, GAME_H - GROUND_Y);
  ctx.fillStyle = cssRgba(LR_COLORS.sceneGroundLip, 0.6);
  ctx.fillRect(0, GROUND_Y, GAME_W, 3);

  // 7. Board contact-glow on the platform — stage light, not floating (§1.7).
  ctx.save();
  ctx.translate(GAME_W / 2, BOARD_Y + BOARD_SIZE);
  ctx.scale(1, 0.3);
  const spotR = GAME_W * 0.46;
  const spot = ctx.createRadialGradient(0, 0, 10, 0, 0, spotR);
  spot.addColorStop(0, cssRgba(LR_COLORS.worldSpotlight, 0.35));
  spot.addColorStop(1, cssRgba(LR_COLORS.worldSpotlight, 0));
  ctx.fillStyle = spot;
  ctx.fillRect(-spotR, -spotR, spotR * 2, spotR * 2);
  ctx.restore();

  // 8. Edge vignette — identical to the previous bakeWorld (§1.8).
  const cx = GAME_W / 2;
  const vig = ctx.createRadialGradient(cx, GAME_H / 2, GAME_W * 0.45, cx, GAME_H / 2, GAME_W * 1.05);
  vig.addColorStop(0, cssRgba(LR_COLORS.worldVignette, 0));
  vig.addColorStop(1, cssRgba(LR_COLORS.worldVignette, 0.55));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  texture.refresh();
}

function bakeCityNear(scene: Phaser.Scene): void {
  if (scene.textures.exists('world_city_near')) return;
  const { ctx, texture } = makeCanvas(scene, 'world_city_near', CITY_NEAR_W, CITY_NEAR_H);
  const rand = mulberry32(0x3e5c);
  const baseY = CITY_NEAR_H;

  const windows = (bx: number, bw: number, top: number): void => {
    for (let wy = top + 12; wy < baseY - 10; wy += 16) {
      for (let wx = bx + 7; wx < bx + bw - 9; wx += 13) {
        if (rand() < 0.14) {
          const cool = rand() < 0.2;
          ctx.fillStyle = cssRgba(cool ? LR_COLORS.sceneWindowCool : LR_COLORS.sceneWindowWarm, 0.8);
          ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
  };

  ctx.fillStyle = cssColor(LR_COLORS.sceneCityNear);
  let x = -12;
  let domes = 0;
  while (x < CITY_NEAR_W + 12) {
    // Leave a gap where the signature pinnacle goes.
    if (x > CITY_BEACON_X - 34 && x < CITY_BEACON_X + 14) {
      x = CITY_BEACON_X + 14;
      continue;
    }
    const w = 40 + rand() * 50;
    const h = 120 + rand() * 120;
    const top = baseY - h;
    ctx.fillStyle = cssColor(LR_COLORS.sceneCityNear);
    if (domes < 2 && rand() < 0.3) {
      // Signature domed tower (§1: our landmark until the illustrator lands).
      domes++;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, top + w / 3);
      ctx.arc(x + w / 2, top + w / 3, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, baseY);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x, top, w, h);
    }
    windows(x, w, top);
    x += w + 4 + rand() * 12;
  }

  // Thin beacon pinnacle — the live red dot pulses at its tip in-scene.
  ctx.fillStyle = cssColor(LR_COLORS.sceneCityNear);
  ctx.fillRect(CITY_BEACON_X - 14, baseY - 190, 28, 190);
  ctx.beginPath();
  ctx.moveTo(CITY_BEACON_X - 14, baseY - 190);
  ctx.lineTo(CITY_BEACON_X, CITY_BEACON_Y + 6);
  ctx.lineTo(CITY_BEACON_X + 14, baseY - 190);
  ctx.closePath();
  ctx.fill();

  texture.refresh();
}

function bakeBoardShadow(scene: Phaser.Scene): void {
  if (scene.textures.exists('board_shadow')) return;
  const w = BOARD_SIZE;
  const h = Math.round(BOARD_SIZE * 0.3);
  const { ctx, texture } = makeCanvas(scene, 'board_shadow', w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(1, h / w);
  const g = ctx.createRadialGradient(0, 0, 8, 0, 0, w / 2);
  g.addColorStop(0, cssRgba(LR_COLORS.worldVignette, 0.5));
  g.addColorStop(1, cssRgba(LR_COLORS.worldVignette, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -w / 2, w, w);
  ctx.restore();
  texture.refresh();
}

function bakeStar4(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx_star4')) return;
  const S = LR_BAKE_SCALE;
  const size = 24 * S;
  const { ctx, texture } = makeCanvas(scene, 'fx_star4', size, size);
  ctx.translate(size / 2, size / 2);
  const outer = dp(6) * S;
  const inner = dp(2.4) * S;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = cssColor(LR_COLORS.sceneStar);
  ctx.shadowColor = cssColor(LR_COLORS.sceneStar);
  ctx.shadowBlur = 4 * S;
  ctx.fill();
  texture.refresh();
}
