/**
 * seatColors rotation (vs-CPU color pick): seat 0 takes the chosen color
 * while the geometric spread around the ring stays identical — 2P always
 * lands on opposite corners, and no layout ever duplicates a color.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS, createGame, seatColors, trackDistance, toAbsoluteCell } from '../src/index.js';
import type { PlayerColor } from '../src/index.js';

describe('seatColors with a seat-zero anchor', () => {
  it('defaults keep the historical layouts', () => {
    expect(seatColors(2)).toEqual(['red', 'yellow']);
    expect(seatColors(3)).toEqual(['red', 'blue', 'yellow']);
    expect(seatColors(4)).toEqual(['red', 'blue', 'yellow', 'green']);
  });

  it('anchors seat 0 to the chosen color for every size', () => {
    for (const color of PLAYER_COLORS) {
      for (const n of [2, 3, 4] as const) {
        expect(seatColors(n, color)[0]).toBe(color);
      }
    }
  });

  it('2P stays on opposite corners for every anchor', () => {
    for (const color of PLAYER_COLORS) {
      const [a, b] = seatColors(2, color) as [PlayerColor, PlayerColor];
      const absA = toAbsoluteCell(a, 0);
      const absB = toAbsoluteCell(b, 0);
      expect(absA).not.toBeNull();
      expect(absB).not.toBeNull();
      expect(trackDistance(absA as number, absB as number)).toBe(26);
    }
  });

  it('never repeats a color in any layout', () => {
    for (const color of PLAYER_COLORS) {
      for (const n of [2, 3, 4] as const) {
        const set = new Set(seatColors(n, color));
        expect(set.size).toBe(n);
      }
    }
  });

  it('createGame honors seatZeroColor', () => {
    const s = createGame({ numPlayers: 2, seatZeroColor: 'blue' });
    expect(s.players[0]?.color).toBe('blue');
    expect(s.players[1]?.color).toBe('green');
  });

  it('createGame without the option is unchanged', () => {
    const s = createGame({ numPlayers: 2 });
    expect(s.players.map((p) => p.color)).toEqual(['red', 'yellow']);
  });
});
