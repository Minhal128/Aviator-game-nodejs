import { describe, expect, it } from 'vitest';
import { move, playFullGame, roll, startedGame } from './helpers.js';

describe('determinism (§5.5: RNG is external, the engine is a pure reducer)', () => {
  it('replays a full CPU match identically from the same seed', () => {
    const a = playFullGame(4, ['hard', 'medium', 'easy', 'easy'], 42);
    const b = playFullGame(4, ['hard', 'medium', 'easy', 'easy'], 42);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.actions).toBe(b.actions);
  });

  it('replays identically across 10 different seeds', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const a = playFullGame(2, ['hard', 'hard'], seed);
      const b = playFullGame(2, ['hard', 'hard'], seed);
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }
  });

  it('diverges when the dice stream differs', () => {
    const a = playFullGame(4, ['easy', 'easy', 'easy', 'easy'], 1);
    const b = playFullGame(4, ['easy', 'easy', 'easy', 'easy'], 2);
    expect(JSON.stringify(a.state.rngLog)).not.toBe(JSON.stringify(b.state.rngLog));
  });

  it('logs exactly the injected dice sequence in order', () => {
    let state = startedGame(4);
    state = roll(state, 3).state; // seat 0: no moves, skip
    state = move(roll(state, 6).state, 0).state; // seat 1: exit + extra turn
    state = move(roll(state, 2).state, 0).state; // seat 1 again: advance
    state = roll(state, 5).state; // seat 2: skip
    expect(state.rngLog).toEqual([3, 6, 2, 5]);
  });
});
