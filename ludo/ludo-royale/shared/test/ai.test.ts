import { describe, expect, it } from 'vitest';
import { applyAction, chooseMove, legalMoves, pickMove } from '../src/index.js';
import type { AiLevel } from '../src/index.js';
import { mulberry32, roll, startedGame, stepsForAbs, withPieces } from './helpers.js';

const LEVELS: AiLevel[] = ['easy', 'medium', 'hard'];

describe('AI legality property (§5.6: only legal moves, ever)', () => {
  it('all three levels return legal moves across 500+ random states (2/3/4P)', () => {
    let sampled = 0;
    let seed = 1;
    while (sampled < 500) {
      const players = ([2, 3, 4] as const)[seed % 3] ?? 4;
      const rand = mulberry32(seed++);
      let state = startedGame(players);
      let guard = 0;
      while (state.phase === 'playing' && guard++ < 3000) {
        if (state.turnPhase === 'wait_roll') {
          const dice = 1 + Math.floor(rand() * 6);
          state = applyAction(state, { type: 'ROLL', seat: state.currentSeat, dice }).state;
          continue;
        }
        const legal = legalMoves(state, state.currentSeat, state.dice);
        expect(legal.length).toBeGreaterThan(0);
        for (const level of LEVELS) {
          const md = chooseMove(state, state.currentSeat, state.dice, level, rand);
          expect(md).not.toBeNull();
          expect(legal.some((m) => m.pieceId === md?.pieceId && m.to === md?.to)).toBe(true);
        }
        sampled++;
        // Progress with a random legal move to diversify the sampled positions.
        const chosen = legal[Math.floor(rand() * legal.length)] ?? legal[0];
        if (!chosen) throw new Error('unreachable: legal set is non-empty');
        state = applyAction(state, {
          type: 'MOVE',
          seat: state.currentSeat,
          pieceId: chosen.pieceId,
        }).state;
      }
    }
    expect(sampled).toBeGreaterThanOrEqual(500);
  });

  it('every level returns null when nothing is legal', () => {
    const state = startedGame(4); // all pieces in BASE
    for (const level of LEVELS) {
      expect(chooseMove(state, 0, 3, level)).toBeNull();
    }
  });
});

describe('easy — "Casual" heuristic', () => {
  // Fixture: piece 0 can capture, piece 1 can only advance.
  function captureOrAdvance() {
    return withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 0, pieceId: 1, steps: 20 },
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 5) },
    ]);
  }

  it('takes the capture when the injected rand is below 0.5', () => {
    const md = chooseMove(captureOrAdvance(), 0, 3, 'easy', () => 0.3);
    expect(md?.pieceId).toBe(0);
    expect(md?.captures).toHaveLength(1);
  });

  it('falls back to a uniform pick when the capture coin flip misses', () => {
    const md = chooseMove(captureOrAdvance(), 0, 3, 'easy', () => 0.9);
    expect(md?.pieceId).toBe(1); // floor(0.9 * 2) = index 1
  });
});

describe('medium — "Retador" priority ladder', () => {
  it('prefers HOME over a capture', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 55 }, // dice 2 → HOME
      { seat: 0, pieceId: 1, steps: 10 }, // dice 2 → captures on abs 12
      { seat: 2, pieceId: 0, steps: stepsForAbs('yellow', 12) },
    ]);
    expect(chooseMove(state, 0, 2, 'medium')?.pieceId).toBe(0);
  });

  it('prefers a capture over leaving BASE', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 3 }, // dice 6 → captures on abs 9
      { seat: 2, pieceId: 0, steps: stepsForAbs('yellow', 9) },
    ]);
    const md = chooseMove(state, 0, 6, 'medium');
    expect(md?.pieceId).toBe(0);
    expect(md?.captures).toHaveLength(1);
  });

  it('leaves BASE on a six when there is no home/capture', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 20 }]);
    expect(chooseMove(state, 0, 6, 'medium')?.from).toBe(-1);
  });

  it('rescues an endangered piece into a safe cell', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 5 }, // threatened, dice 3 → star cell 8
      { seat: 0, pieceId: 1, steps: 30 }, // otherwise the "most advanced" pick
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 3) }, // 2 cells behind piece 0
    ]);
    expect(chooseMove(state, 0, 3, 'medium')?.pieceId).toBe(0);
  });

  it('advances the most advanced piece when nothing is urgent', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 5 },
      { seat: 0, pieceId: 1, steps: 30 },
    ]);
    expect(chooseMove(state, 0, 3, 'medium')?.pieceId).toBe(1);
  });
});

describe('hard — "Experto" weighted scoring', () => {
  it('prefers a capture over plain progress', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 2 }, // dice 3 → capture on abs 5
      { seat: 0, pieceId: 1, steps: 40 }, // much more progress, no capture
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 5) },
    ]);
    expect(chooseMove(state, 0, 3, 'hard')?.pieceId).toBe(0);
  });

  it('prefers HOME over a longer advance', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 55 },
      { seat: 0, pieceId: 1, steps: 10 },
    ]);
    expect(chooseMove(state, 0, 2, 'hard')?.pieceId).toBe(0);
  });

  it('avoids landing where an enemy can strike next turn', () => {
    // piece 0 has more progress but its destination (abs 23) sits 2 cells in
    // front of a blue attacker; piece 1's destination (abs 20) is behind it.
    const threatened = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 20 },
      { seat: 0, pieceId: 1, steps: 17 },
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 21) },
    ]);
    expect(chooseMove(threatened, 0, 3, 'hard')?.pieceId).toBe(1);

    // Without the attacker the higher-progress move wins.
    const calm = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 20 },
      { seat: 0, pieceId: 1, steps: 17 },
    ]);
    expect(chooseMove(calm, 0, 3, 'hard')?.pieceId).toBe(0);
  });

  it('pushes a piece out of BASE while fewer than 2 are in play', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 1, steps: 15 }]);
    expect(chooseMove(state, 0, 6, 'hard')?.from).toBe(-1);
  });

  it('drops the exit bonus once 2 pieces are already out', () => {
    // With the bonus gone, exiting scores 40 (safe entry) and moving piece 1
    // onto star 21 scores ~49 — the safe advance must win.
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 1, steps: 15 },
      { seat: 0, pieceId: 2, steps: 2 },
    ]);
    expect(chooseMove(state, 0, 6, 'hard')?.pieceId).toBe(1);
  });
});

describe('pickMove wrapper (ARQUITECTURA §5.6 signature)', () => {
  it('returns the pieceId for the current seat', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 55 }]);
    const state = roll(base, 2).state;
    expect(pickMove('medium', state, state.dice)).toBe(0);
  });

  it('returns null when the current seat cannot move', () => {
    expect(pickMove('hard', startedGame(4), 3)).toBeNull();
  });
});
