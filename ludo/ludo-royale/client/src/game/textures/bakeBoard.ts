/**
 * Bakes the full 15×15 board into one texture (STYLE-GUIDE §3, re-skinned by
 * LUDOWORLD-PARITY §5): cream tray frame with a thick gold gradient border,
 * near-white play surface (untouched — legibility rule), hairline cells,
 * tinted home lanes, colored start cells with arrow, rounded-star safe
 * cells, 6×6 home yards with inset slots, and the OWN center medallion
 * (violet rounded square, 4 gold-rimmed gates, gold crown). Baked at 2× and
 * displayed at 0.5 scale.
 */
import type Phaser from 'phaser';
import { ENTRY_CELLS, SAFE_CELLS } from '@ludo/shared';
import type { PlayerColor } from '@ludo/shared';
import {
  ENTRY_DIR,
  GATE_DIR,
  LANE_GRID,
  TRACK_GRID,
  YARD_ORIGIN,
} from '../boardMap';
import type { GridPos } from '../boardMap';
import { CELL, FRAME_PAD } from '../layout';
import { LR_BAKE_SCALE, LR_COLORS, LR_PLAYERS, cssColor, cssRgba, dp } from '../../theme/tokens';
import { makeCanvas, roundedRectPath, starPath } from './canvasKit';

const COLORS: readonly PlayerColor[] = ['red', 'blue', 'yellow', 'green'];

// ---------------------------------------------------------------------------
// Board themes (`board_theme` shop items): same bake, different neutral
// palette — tray, play surface, neutral cells, hairlines, yard pads and the
// center medallion. Player colors and the gold frame stay untouched.
// ---------------------------------------------------------------------------

export const BOARD_THEMES = ['ocean', 'night'] as const;
export type BoardThemeId = (typeof BOARD_THEMES)[number] | 'classic';

interface ThemePalette {
  tray: number;
  surface: number;
  cell: number;
  cellLine: number;
  pad: number;
  medallion: number;
}

const THEME_PALETTES: Readonly<Record<BoardThemeId, ThemePalette>> = {
  classic: {
    tray: LR_COLORS.sceneCream,
    surface: LR_COLORS.boardSurface,
    cell: LR_COLORS.surface,
    cellLine: LR_COLORS.cellLine,
    pad: LR_COLORS.surface2,
    medallion: LR_COLORS.hudInk,
  },
  ocean: {
    tray: 0x8ec7e6,
    surface: 0xd9edf9,
    cell: 0xeaf6fd,
    cellLine: 0x9ec8dd,
    pad: 0xc9e4f4,
    medallion: 0x1e5680,
  },
  // Midnight NEON: near-black stage, luminous violet grid (futurist skin).
  night: {
    tray: 0x14102c,
    surface: 0x241e4a,
    cell: 0x2c2558,
    cellLine: 0x7b6cff,
    pad: 0x352c68,
    medallion: 0x0d0a20,
  },
};

/** Texture key per theme ('classic' keeps the legacy 'board' key). */
export function boardTextureKey(theme: BoardThemeId): string {
  return theme === 'classic' ? 'board' : `board_${theme}`;
}

/** Server asset_key → theme id ('classic' when unknown/stale). */
export function normalizeBoardTheme(key: string): BoardThemeId {
  return (BOARD_THEMES as readonly string[]).includes(key) ? (key as BoardThemeId) : 'classic';
}

export function bakeBoard(scene: Phaser.Scene, theme: BoardThemeId = 'classic'): void {
  const key = boardTextureKey(theme);
  if (scene.textures.exists(key)) return;
  const P = THEME_PALETTES[theme];
  const size = CELL * 15;
  const full = size + FRAME_PAD * 2;
  const S = LR_BAKE_SCALE;
  const { ctx, texture } = makeCanvas(scene, key, full * S, full * S);
  ctx.scale(S, S);
  ctx.translate(FRAME_PAD, FRAME_PAD);

  const cellXY = (p: GridPos): [number, number] => [p.col * CELL, p.row * CELL];

  // Elevated frame with a soft baked drop shadow (no real-time light).
  // LUDOWORLD-PARITY §5.1: cream toy tray with a thick gold gradient border
  // (was navy ink) — a premium toy tray floating on the violet stage.
  const frameR = dp(28) + 6;
  const fx0 = -FRAME_PAD + 2;
  const fw = size + FRAME_PAD * 2 - 4;
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.sceneShadowInk, 0.45);
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  roundedRectPath(ctx, fx0, fx0, fw, fw, frameR);
  ctx.fillStyle = cssColor(P.tray);
  ctx.fill();
  ctx.restore();

  // Frame bevel on cream: light lip up, warm gold lip down (same language
  // as the CelebrationPanel body — clipped inner strokes).
  ctx.save();
  roundedRectPath(ctx, fx0, fx0, fw, fw, frameR);
  ctx.clip();
  const frameLight = ctx.createLinearGradient(fx0, fx0, fx0, fx0 + fw);
  frameLight.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  frameLight.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
  roundedRectPath(ctx, fx0, fx0, fw, fw, frameR);
  ctx.strokeStyle = frameLight;
  ctx.lineWidth = 4;
  ctx.stroke();
  const frameDark = ctx.createLinearGradient(fx0, fx0, fx0, fx0 + fw);
  frameDark.addColorStop(0.6, cssRgba(LR_COLORS.gold700, 0));
  frameDark.addColorStop(1, cssRgba(LR_COLORS.gold700, 0.25));
  roundedRectPath(ctx, fx0, fx0, fw, fw, frameR);
  ctx.strokeStyle = frameDark;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.restore();

  // Thick gold gradient border (§5.1) + gold hairline just inside it.
  const frameGold = ctx.createLinearGradient(fx0, fx0, fx0, fx0 + fw);
  frameGold.addColorStop(0, cssColor(LR_COLORS.gold300));
  frameGold.addColorStop(1, cssColor(LR_COLORS.gold700));
  roundedRectPath(ctx, fx0 + 2, fx0 + 2, fw - 4, fw - 4, frameR - 2);
  ctx.strokeStyle = frameGold;
  ctx.lineWidth = dp(4);
  ctx.stroke();
  roundedRectPath(ctx, fx0 + 6, fx0 + 6, fw - 12, fw - 12, frameR - 6);
  ctx.strokeStyle = cssRgba(LR_COLORS.gold500, 0.35);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Futurist pass (Jose): the gold border EMITS light — outer glow halo +
  // a cool inner edge-light, like a lit display bezel.
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.gold300, 0.85);
  ctx.shadowBlur = dp(10);
  roundedRectPath(ctx, fx0 + 2, fx0 + 2, fw - 4, fw - 4, frameR - 2);
  ctx.strokeStyle = cssRgba(LR_COLORS.gold300, 0.35);
  ctx.lineWidth = dp(2);
  ctx.stroke();
  ctx.restore();
  roundedRectPath(ctx, fx0 + 9, fx0 + 9, fw - 18, fw - 18, frameR - 9);
  ctx.strokeStyle = 'rgba(170, 220, 255, 0.28)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Play surface.
  roundedRectPath(ctx, 0, 0, size, size, dp(20));
  ctx.fillStyle = cssColor(P.surface);
  ctx.fill();

  // Track + lane cells: white fill, hairline separators + §4.4 micro-bevel
  // (embossed tile lip; low alpha so the surface stays calm at distance).
  const drawCell = (p: GridPos, fill: string): void => {
    const [x, y] = cellXY(p);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, CELL, CELL);
    // Physical tile read (Jose: "no parece papel"): vertical light falloff
    // + a darker bottom lip, so every cell has thickness.
    const tile = ctx.createLinearGradient(x, y, x, y + CELL);
    tile.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    tile.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
    tile.addColorStop(1, 'rgba(0, 0, 0, 0.05)');
    ctx.fillStyle = tile;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.fillStyle = cssRgba(LR_COLORS.borderStrong, 0.18);
    ctx.fillRect(x + 1, y + CELL - 3, CELL - 2, 2);
    ctx.strokeStyle = cssColor(P.cellLine);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + CELL - 1.5);
    ctx.lineTo(x + 1.5, y + 1.5);
    ctx.lineTo(x + CELL - 1.5, y + 1.5);
    ctx.stroke();
    ctx.strokeStyle = cssRgba(LR_COLORS.borderStrong, 0.25);
    ctx.beginPath();
    ctx.moveTo(x + CELL - 1.5, y + 1.5);
    ctx.lineTo(x + CELL - 1.5, y + CELL - 1.5);
    ctx.lineTo(x + 1.5, y + CELL - 1.5);
    ctx.stroke();
  };

  const entryByAbs = new Map<number, PlayerColor>();
  for (const c of COLORS) entryByAbs.set(ENTRY_CELLS[c], c);

  TRACK_GRID.forEach((p, abs) => {
    const entryColor = entryByAbs.get(abs);
    drawCell(p, entryColor ? cssColor(LR_PLAYERS[entryColor].mid) : cssColor(P.cell));
  });

  // Home lanes: five tinted cells (the 6th lane cell is the medallion gate).
  // ARTPASS §4.3: light overlay so the lanes read as color channels, not
  // washed-out white. Common track cells stay untouched (legibility rule).
  for (const c of COLORS) {
    for (let i = 0; i < 5; i++) {
      const p = LANE_GRID[c][i];
      if (!p) continue;
      drawCell(p, cssColor(LR_PLAYERS[c].tint));
      const [lx, ly] = cellXY(p);
      // Energy channel: intensity RAMPS toward the medallion + a thin
      // luminous core line, so the lane reads as a powered strip.
      ctx.fillStyle = cssRgba(LR_PLAYERS[c].light, 0.1 + i * 0.07);
      ctx.fillRect(lx + 1, ly + 1, CELL - 2, CELL - 2);
      ctx.save();
      ctx.shadowColor = cssRgba(LR_PLAYERS[c].mid, 0.8);
      ctx.shadowBlur = 6;
      ctx.fillStyle = cssRgba(LR_PLAYERS[c].mid, 0.2 + i * 0.08);
      const horizontal = LANE_GRID[c][0]!.row === 7;
      if (horizontal) {
        ctx.fillRect(lx + 2, ly + CELL / 2 - 2, CELL - 4, 4);
      } else {
        ctx.fillRect(lx + CELL / 2 - 2, ly + 2, 4, CELL - 4);
      }
      ctx.restore();
    }
  }

  // Safe cells: rounded 5-point star with a soft cream inner glow.
  for (const abs of SAFE_CELLS) {
    const p = TRACK_GRID[abs];
    if (!p) continue;
    const [x, y] = cellXY(p);
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const onColor = entryByAbs.has(abs);
    ctx.save();
    ctx.lineJoin = 'round';
    if (onColor) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    } else {
      ctx.shadowColor = cssRgba(LR_COLORS.gold300, 0.7);
      ctx.shadowBlur = 12;
      ctx.fillStyle = cssRgba(LR_COLORS.gold300, 0.6);
      ctx.strokeStyle = cssColor(LR_COLORS.gold500);
    }
    starPath(ctx, cx, cy, CELL * 0.32, CELL * 0.14);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // Lane-turn arrows (LW parity): a small arrow in the LANE's color on the
  // edge cell you turn in from, pointing into the colored channel.
  for (const c of COLORS) {
    const prev = TRACK_GRID[(ENTRY_CELLS[c] + 50) % TRACK_GRID.length];
    const lane0 = LANE_GRID[c][0];
    if (!prev || !lane0) continue;
    const [px, py] = cellXY(prev);
    const cx = px + CELL / 2;
    const cy = py + CELL / 2;
    const dx = lane0.col - prev.col;
    const dy = lane0.row - prev.row;
    const a = CELL * 0.17;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(a, 0);
    ctx.lineTo(-a * 0.6, a * 0.8);
    ctx.lineTo(-a * 0.6, -a * 0.8);
    ctx.closePath();
    ctx.fillStyle = cssColor(LR_PLAYERS[c].mid);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Start-cell arrows (movement direction out of the yard).
  for (const c of COLORS) {
    const p = TRACK_GRID[ENTRY_CELLS[c]];
    if (!p) continue;
    const [x, y] = cellXY(p);
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const d = ENTRY_DIR[c];
    const a = CELL * 0.16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(d.y, d.x));
    ctx.beginPath();
    ctx.moveTo(a, 0);
    ctx.lineTo(-a * 0.6, a * 0.8);
    ctx.lineTo(-a * 0.6, -a * 0.8);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.restore();
  }

  // Home yards, LUDO WORLD full-bleed read (Jose reference): the whole 6x6
  // corner block is the player color to the board edge; inside it sits a
  // DARKER rounded square (the yard) with the four slot pads — no white
  // circle. Clipped to the play surface so corners stay rounded.
  ctx.save();
  roundedRectPath(ctx, 0, 0, size, size, dp(20));
  ctx.clip();
  for (const c of COLORS) {
    const o = YARD_ORIGIN[c];
    const [x, y] = cellXY(o);
    const w = CELL * 6;
    const pal = LR_PLAYERS[c];
    // Full-bleed quadrant block with a soft top light.
    ctx.fillStyle = cssColor(pal.mid);
    ctx.fillRect(x, y, w, w);
    const light = ctx.createLinearGradient(x, y, x, y + w);
    light.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    light.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    light.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
    ctx.fillStyle = light;
    ctx.fillRect(x, y, w, w);
    // Inner darker yard square (recessed) + subtle bottom light lip.
    const yx = x + CELL * 0.9;
    const yw = w - CELL * 1.8;
    roundedRectPath(ctx, yx, y + CELL * 0.9, yw, yw, dp(18));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.fill();
    roundedRectPath(ctx, yx + 1.5, y + CELL * 0.9 + 1.5, yw - 3, yw - 3, dp(16));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Neon edge: the recessed yard glows in its own color (futurist pass).
    ctx.save();
    ctx.shadowColor = cssRgba(pal.light, 0.9);
    ctx.shadowBlur = dp(7);
    roundedRectPath(ctx, yx + 3, y + CELL * 0.9 + 3, yw - 6, yw - 6, dp(15));
    ctx.strokeStyle = cssRgba(pal.light, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    roundedRectPath(ctx, yx + 1.5, y + CELL * 0.9 + 1.5, yw - 3, yw - 3, dp(16));
    ctx.save();
    roundedRectPath(ctx, yx, y + CELL * 0.9, yw, yw, dp(18));
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(yx + 4, y + CELL * 0.9 + yw - 3);
    ctx.lineTo(yx + yw - 4, y + CELL * 0.9 + yw - 3);
    ctx.stroke();
    ctx.restore();
    // Four slot pads directly on the yard square.
    const cx = x + w / 2;
    const cy = y + w / 2;
    for (let i = 0; i < 4; i++) {
      const sx = cx + (i % 2 === 0 ? -1 : 1) * 0.95 * CELL;
      const sy = cy + (i < 2 ? -1 : 1) * 0.95 * CELL;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, CELL * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(P.pad);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(sx, sy, CELL * 0.55 - 1.5, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = cssRgba(LR_COLORS.borderStrong, 0.9);
      ctx.lineWidth = 3;
      ctx.stroke();
      // Soft luminous ring around each slot pad.
      ctx.save();
      ctx.shadowColor = cssRgba(pal.light, 0.8);
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, CELL * 0.55 + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = cssRgba(pal.light, 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  // Center medallion (§5.2): violet `hudInk` rounded square (candy chrome,
  // not navy) + 4 colored gates with gold rim.
  const mx = CELL * 6;
  const mw = CELL * 3;
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.sceneShadowInk, 0.35);
  ctx.shadowBlur = 8;
  roundedRectPath(ctx, mx + 2, mx + 2, mw - 4, mw - 4, dp(24));
  ctx.fillStyle = cssColor(P.medallion);
  ctx.fill();
  ctx.restore();
  // Futurist core: the medallion frame emits gold light.
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.gold300, 0.9);
  ctx.shadowBlur = dp(9);
  roundedRectPath(ctx, mx + 3, mx + 3, mw - 6, mw - 6, dp(22));
  ctx.strokeStyle = cssRgba(LR_COLORS.gold300, 0.65);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  const mc = mx + mw / 2;
  for (const c of COLORS) {
    const d = GATE_DIR[c];
    // The gate triangle points inward from its board-edge side.
    const bx = mc - d.x * (mw / 2 - 4);
    const by = mc - d.y * (mw / 2 - 4);
    const tipX = mc - d.x * (mw / 2 - 4 - CELL * 1.05);
    const tipY = mc - d.y * (mw / 2 - 4 - CELL * 1.05);
    const px = d.y * CELL * 1.1;
    const py = d.x * CELL * 1.1;
    ctx.beginPath();
    ctx.moveTo(bx + px, by + py);
    ctx.lineTo(bx - px, by - py);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fillStyle = cssColor(LR_PLAYERS[c].mid);
    ctx.fill();
    ctx.strokeStyle = cssColor(LR_COLORS.gold700);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // (The gold ring + crown live in their OWN texture — see bakeBoardCrown —
  // so the LW view rotation never tips the emblem sideways.)

  // Subtle inner border of the play surface (baked inset).
  roundedRectPath(ctx, 1.5, 1.5, size - 3, size - 3, dp(20) - 1);
  ctx.strokeStyle = cssRgba(LR_COLORS.borderStrong, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  texture.refresh();
}

/**
 * Center emblem (gold ring + 3-spike crown) as its OWN texture: BoardView
 * overlays it unrotated so the crown stays upright under the LW camera.
 */
export function bakeBoardCrown(scene: Phaser.Scene): void {
  if (scene.textures.exists('board_crown')) return;
  const S = LR_BAKE_SCALE;
  const size = 64;
  const mc = size / 2;
  const { ctx, texture } = makeCanvas(scene, 'board_crown', size * S, size * S);
  ctx.scale(S, S);

  const ring = ctx.createLinearGradient(mc, mc - 24, mc, mc + 24);
  ring.addColorStop(0, cssColor(LR_COLORS.gold300));
  ring.addColorStop(1, cssColor(LR_COLORS.gold700));
  ctx.beginPath();
  ctx.arc(mc, mc, 26, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();

  const crown = ctx.createLinearGradient(mc, mc - 14, mc, mc + 12);
  crown.addColorStop(0, cssColor(LR_COLORS.gold300));
  crown.addColorStop(1, cssColor(LR_COLORS.gold500));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(mc - 15, mc + 10);
  ctx.lineTo(mc - 15, mc - 4);
  ctx.lineTo(mc - 8, mc + 2);
  ctx.lineTo(mc, mc - 12);
  ctx.lineTo(mc + 8, mc + 2);
  ctx.lineTo(mc + 15, mc - 4);
  ctx.lineTo(mc + 15, mc + 10);
  ctx.closePath();
  ctx.fillStyle = crown;
  ctx.strokeStyle = crown;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fill();
  for (const sx of [-15, 0, 15]) {
    ctx.beginPath();
    ctx.arc(mc + sx, mc + (sx === 0 ? -13 : -5), 2.4, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(LR_COLORS.gold300);
    ctx.fill();
  }
  ctx.restore();
  texture.refresh();
}
