import { describe, expect, it } from 'vitest';
import { HOME_STEPS, PIECES_PER_PLAYER } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { playFullGame } from './helpers.js';

function expectSaneEnd(state: GameState, numPlayers: number): void {
  expect(state.phase).toBe('finished');
  expect(state.winnerOrder.length).toBeGreaterThanOrEqual(1);
  // Every seat holds a unique place 1..N.
  const places = state.players.map((p) => p.place).sort((a, b) => a - b);
  expect(places).toEqual(Array.from({ length: numPlayers }, (_, i) => i + 1));
  // The audit log only ever contains real dice values.
  expect(state.rngLog.length).toBeGreaterThan(0);
  expect(state.rngLog.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(true);
}

describe('CPU-vs-CPU smoke (100+ full matches, no exceptions)', () => {
  it('finishes 100 seeded 4P matches with mixed AI levels', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { state } = playFullGame(4, ['hard', 'medium', 'easy', 'easy'], seed);
      expectSaneEnd(state, 4);
      // playForSecond default: 1st and 2nd are decided by play.
      expect(state.winnerOrder.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('finishes 100 seeded 2P matches and the winner has all pieces HOME', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { state } = playFullGame(2, ['hard', 'easy'], seed);
      expectSaneEnd(state, 2);
      const winner = state.winnerOrder[0];
      const homePieces = state.pieces.filter(
        (p) => p.seat === winner && p.steps === HOME_STEPS,
      );
      expect(homePieces).toHaveLength(PIECES_PER_PLAYER);
    }
  });

  it('finishes 25 seeded 3P matches', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { state } = playFullGame(3, ['medium', 'medium', 'hard'], seed);
      expectSaneEnd(state, 3);
    }
  });

  it('also terminates with every optional rule disabled', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = playFullGame(4, ['easy', 'easy', 'easy', 'easy'], seed, {
        blockEnabled: false,
        extraTurnOnCapture: false,
        tripleSixForfeit: false,
        playForSecond: false,
      });
      expectSaneEnd(state, 4);
      expect(state.winnerOrder.length).toBe(1); // ends at the first winner
    }
  });
});
