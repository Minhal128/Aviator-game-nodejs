/**
 * Portrait 9:16 layout constants (ARQUITECTURA §4.1: 720×1280 logical,
 * Scale.FIT). Positions follow STYLE-GUIDE §3's vertical split: HUD pill,
 * board with corner-anchored rival chips, action zone with dice at the
 * bottom (thumb reach).
 */
import { dp } from '../theme/tokens';

export const GAME_W = 720;
export const GAME_H = 1280;

// LW parity (Jose feedback "mucha sobra"): the board fills the width —
// CELL 47 -> 705 of 720 logical px, and it starts higher under the header.
export const CELL = 47;
export const GRID = 15;
export const BOARD_SIZE = CELL * GRID; // 705
export const BOARD_X = (GAME_W - BOARD_SIZE) / 2;
// 210 (not 190): leaves air for the dice bubble beside the TOP corner chips.
export const BOARD_Y = 210;
export const FRAME_PAD = 14;

export const HUD = {
  y: 36,
  h: 60,
  marginX: 16,
} as const;

/**
 * LW parity (capturas de Jose): EVERY seat's chip floats on its own board
 * corner (uniform size); the die travels beside the ACTIVE chip as a GO
 * bubble, so the bottom strip only holds banner + Emoji/Chat pills + the
 * POWER row.
 */
export const CHIP = {
  radius: dp(80) / 2, // 40 — big, readable avatars (Jose: "mas grandes")
  rivalRadius: dp(80) / 2,
  youRadius: dp(80) / 2,
  topY: 148,
  bottomY: 952,
  leftX: 78,
  rightX: GAME_W - 78,
} as const;

export const ACTION = {
  bannerY: 985,
  toastY: 926,
  // Bottom band, two lines: the POWER charges rail fills the strip under
  // the dice; Emoji + Chat + the power orb share ONE bottom row.
  pillX: 128,
  chatX: 356,
  emojiY: 1212,
  chatY: 1212,
  railY: 1128,
  powerX: 620,
  powerY: 1212,
} as const;

export const DEPTH = {
  world: 0,
  board: 1,
  pieces: 10,
  dice: 20,
  hud: 30,
  fx: 40,
  banner: 50,
  toast: 52,
  emoteWheel: 55,
  modal: 60,
} as const;
