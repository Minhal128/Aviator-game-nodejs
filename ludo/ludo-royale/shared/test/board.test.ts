import { describe, expect, it } from 'vitest';
import {
  ENTRY_CELLS,
  SAFE_CELLS,
  isHome,
  isInBase,
  isInLane,
  isOnTrack,
  isSafeCell,
  seatColors,
  toAbsoluteCell,
  trackDistance,
} from '../src/index.js';

describe('board geometry (ARQUITECTURA §5.1)', () => {
  it('has exactly the 8 safe cells: 4 entries + 4 stars', () => {
    expect([...SAFE_CELLS].sort((a, b) => a - b)).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
  });

  it('places entry cells at RED=0, BLUE=13, YELLOW=26, GREEN=39', () => {
    expect(ENTRY_CELLS).toEqual({ red: 0, blue: 13, yellow: 26, green: 39 });
  });

  it('marks every entry cell as safe', () => {
    for (const cell of Object.values(ENTRY_CELLS)) {
      expect(isSafeCell(cell)).toBe(true);
    }
  });

  it('maps steps 0 to the color entry cell', () => {
    expect(toAbsoluteCell('red', 0)).toBe(0);
    expect(toAbsoluteCell('blue', 0)).toBe(13);
    expect(toAbsoluteCell('yellow', 0)).toBe(26);
    expect(toAbsoluteCell('green', 0)).toBe(39);
  });

  it('wraps around the 52-cell ring', () => {
    expect(toAbsoluteCell('green', 20)).toBe(7); // (39 + 20) % 52
    expect(toAbsoluteCell('yellow', 30)).toBe(4); // (26 + 30) % 52
  });

  it('returns null off the ring (base, lane, home)', () => {
    expect(toAbsoluteCell('red', -1)).toBeNull();
    expect(toAbsoluteCell('red', 51)).toBeNull();
    expect(toAbsoluteCell('red', 57)).toBeNull();
  });

  it('classifies steps values at the boundaries', () => {
    expect(isInBase(-1)).toBe(true);
    expect(isOnTrack(0)).toBe(true);
    expect(isOnTrack(50)).toBe(true);
    expect(isOnTrack(51)).toBe(false);
    expect(isInLane(51)).toBe(true);
    expect(isInLane(56)).toBe(true);
    expect(isInLane(57)).toBe(false);
    expect(isHome(57)).toBe(true);
  });

  it('assigns colors per player count (2P uses opposite corners)', () => {
    expect(seatColors(2)).toEqual(['red', 'yellow']);
    expect(seatColors(3)).toEqual(['red', 'blue', 'yellow']);
    expect(seatColors(4)).toEqual(['red', 'blue', 'yellow', 'green']);
  });

  it('computes clockwise track distance with wrap', () => {
    expect(trackDistance(0, 5)).toBe(5);
    expect(trackDistance(50, 2)).toBe(4);
    expect(trackDistance(5, 5)).toBe(0);
  });
});
