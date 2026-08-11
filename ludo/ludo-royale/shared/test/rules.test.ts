import { describe, expect, it } from 'vitest';
import { describeMove, legalMoves } from '../src/index.js';
import { startedGame, stepsForAbs, withPieces } from './helpers.js';

describe('exit from BASE (§5.2.1)', () => {
  it('refuses to leave BASE with 1-5', () => {
    const state = startedGame(4);
    for (const dice of [1, 2, 3, 4, 5]) {
      expect(describeMove(state, 0, 0, dice)).toBeNull();
    }
  });

  it('leaves BASE with a 6, landing on the entry cell (steps 0)', () => {
    const state = startedGame(4);
    const md = describeMove(state, 0, 0, 6);
    expect(md).not.toBeNull();
    expect(md?.from).toBe(-1);
    expect(md?.to).toBe(0);
    expect(md?.path).toEqual([0]);
    expect(md?.extraTurn).toBe(true); // the six itself grants the re-roll
  });

  it('yields no legal moves when everything is in BASE and dice is not 6', () => {
    const state = startedGame(4);
    expect(legalMoves(state, 0, 3)).toEqual([]);
  });

  it('offers all four exits on a 6 from a fresh board', () => {
    const state = startedGame(4);
    expect(legalMoves(state, 0, 6).map((m) => m.pieceId)).toEqual([0, 1, 2, 3]);
  });

  it('cannot exit onto an enemy wall sitting on the entry cell', () => {
    // Two blue pieces parked on RED's entry (abs 0) form a wall there.
    const blueSteps = stepsForAbs('blue', 0);
    const state = withPieces(startedGame(4), [
      { seat: 1, pieceId: 0, steps: blueSteps },
      { seat: 1, pieceId: 1, steps: blueSteps },
    ]);
    expect(legalMoves(state, 0, 6)).toEqual([]);
  });

  it('coexists with a single enemy on the entry cell (safe, no capture)', () => {
    const state = withPieces(startedGame(4), [
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 0) },
    ]);
    const md = describeMove(state, 0, 0, 6);
    expect(md).not.toBeNull();
    expect(md?.captures).toEqual([]);
  });
});

describe('movement and overshoot (§5.1, §5.2.2)', () => {
  it('advances by the dice value with a cell-by-cell path', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 10 }]);
    const md = describeMove(state, 0, 0, 4);
    expect(md?.to).toBe(14);
    expect(md?.path).toEqual([11, 12, 13, 14]);
  });

  it('crosses from the ring into the home lane', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 48 }]);
    const md = describeMove(state, 0, 0, 5);
    expect(md?.to).toBe(53);
    expect(md?.captures).toEqual([]);
  });

  it('rejects overshooting HOME (exact landing required)', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 55 }]);
    expect(describeMove(state, 0, 0, 4)).toBeNull();
    expect(describeMove(state, 0, 0, 3)).toBeNull();
  });

  it('lands exactly on HOME at steps 57', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 55 }]);
    const md = describeMove(state, 0, 0, 2);
    expect(md?.to).toBe(57);
    expect(md?.reachesHome).toBe(true);
    expect(md?.extraTurn).toBe(true); // reaching HOME grants the re-roll
  });

  it('accepts the maximum lane jump 51 + 6 = 57', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 51 }]);
    expect(describeMove(state, 0, 0, 6)?.to).toBe(57);
  });

  it('gives a piece at HOME no further moves', () => {
    const state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 57 }]);
    for (const dice of [1, 2, 3, 4, 5, 6]) {
      expect(describeMove(state, 0, 0, dice)).toBeNull();
    }
  });
});

describe('capture (§5.2.3)', () => {
  it('captures a single enemy on a non-safe ring cell', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 5) },
    ]);
    const md = describeMove(state, 0, 0, 3);
    expect(md?.captures).toEqual([{ seat: 1, pieceId: 0 }]);
    expect(md?.extraTurn).toBe(true); // capture grants the re-roll
  });

  it('never captures on a safe cell (star)', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 5 },
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 8) },
    ]);
    const md = describeMove(state, 0, 0, 3); // lands on star cell 8
    expect(md).not.toBeNull();
    expect(md?.captures).toEqual([]);
    expect(md?.extraTurn).toBe(false);
  });

  it('does not treat own pieces as capturable (stacking is allowed)', () => {
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 0, pieceId: 1, steps: 5 },
    ]);
    const md = describeMove(state, 0, 0, 3); // lands on own piece at steps 5
    expect(md).not.toBeNull();
    expect(md?.captures).toEqual([]);
  });
});

describe('wall / block (§5.2.4)', () => {
  it('cannot land on an enemy wall of 2+ pieces', () => {
    const blueSteps = stepsForAbs('blue', 5);
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 1, pieceId: 0, steps: blueSteps },
      { seat: 1, pieceId: 1, steps: blueSteps },
    ]);
    expect(describeMove(state, 0, 0, 3)).toBeNull();
  });

  it('a wall on a safe cell also blocks landing', () => {
    const blueSteps = stepsForAbs('blue', 8);
    const state = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 5 },
      { seat: 1, pieceId: 0, steps: blueSteps },
      { seat: 1, pieceId: 1, steps: blueSteps },
    ]);
    expect(describeMove(state, 0, 0, 3)).toBeNull();
  });

  it('captures the whole stack when blocks are disabled', () => {
    const blueSteps = stepsForAbs('blue', 5);
    const state = withPieces(startedGame(4, { blockEnabled: false }), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 1, pieceId: 0, steps: blueSteps },
      { seat: 1, pieceId: 1, steps: blueSteps },
    ]);
    const md = describeMove(state, 0, 0, 3);
    expect(md?.captures).toHaveLength(2);
  });
});

describe('inactive players', () => {
  it('gives a finished player no moves', () => {
    let state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 10 }]);
    state = structuredClone(state);
    const player = state.players.find((p) => p.seat === 0);
    if (player) player.place = 1;
    expect(legalMoves(state, 0, 3)).toEqual([]);
  });
});
