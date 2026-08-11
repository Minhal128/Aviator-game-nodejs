import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getPlayer, IllegalActionError, ERR } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { eventTypes, findEvent, move, roll, startedGame, stepsForAbs, withPieces } from './helpers.js';

function expectIllegal(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(IllegalActionError);
    expect((err as IllegalActionError).code).toBe(code);
    return;
  }
  throw new Error(`expected IllegalActionError ${code}`);
}

describe('createGame / START', () => {
  it('creates a 4P lobby with 16 pieces in BASE', () => {
    const state = createGame({ numPlayers: 4 });
    expect(state.phase).toBe('lobby');
    expect(state.pieces).toHaveLength(16);
    expect(state.pieces.every((p) => p.steps === -1)).toBe(true);
    expect(state.currentSeat).toBe(0);
    expect(state.dice).toBe(0);
  });

  it('creates a 2P game with red and yellow on opposite corners', () => {
    const state = createGame({ numPlayers: 2 });
    expect(state.pieces).toHaveLength(8);
    expect(state.players.map((p) => p.color)).toEqual(['red', 'yellow']);
  });

  it('rejects a startingSeat outside the player count', () => {
    expect(() => createGame({ numPlayers: 2, startingSeat: 2 })).toThrow(RangeError);
  });

  it('START moves the match to playing and announces the first turn', () => {
    const { state, events } = applyAction(createGame({ numPlayers: 4 }), { type: 'START' });
    expect(state.phase).toBe('playing');
    expect(state.turnPhase).toBe('wait_roll');
    expect(eventTypes(events)).toEqual(['MATCH_STARTED', 'TURN_CHANGED']);
  });

  it('START twice throws BAD_PHASE', () => {
    const started = startedGame(4);
    expectIllegal(() => applyAction(started, { type: 'START' }), ERR.BAD_PHASE);
  });

  it('sets the turn deadline from the injected now', () => {
    const { state } = applyAction(createGame({ numPlayers: 2, turnTimerS: 15 }), {
      type: 'START',
      now: 1_000_000,
    });
    expect(state.turnDeadline).toBe(1_000_000 + 15_000);
  });
});

describe('action validation', () => {
  it('rejects ROLL before START', () => {
    expectIllegal(
      () => applyAction(createGame({ numPlayers: 4 }), { type: 'ROLL', seat: 0, dice: 6 }),
      ERR.BAD_PHASE,
    );
  });

  it('rejects a roll from the wrong seat', () => {
    const state = startedGame(4);
    expectIllegal(() => applyAction(state, { type: 'ROLL', seat: 2, dice: 6 }), ERR.NOT_YOUR_TURN);
  });

  it('rejects out-of-range dice values', () => {
    const state = startedGame(4);
    expectIllegal(() => roll(state, 0), ERR.ILLEGAL_MOVE);
    expectIllegal(() => roll(state, 7), ERR.ILLEGAL_MOVE);
    expectIllegal(() => roll(state, 2.5), ERR.ILLEGAL_MOVE);
  });

  it('rejects MOVE while waiting for a roll', () => {
    const state = startedGame(4);
    expectIllegal(() => move(state, 0), ERR.BAD_PHASE);
  });

  it('rejects moving a piece that has no legal move', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 5 }]);
    const { state } = roll(base, 2); // only piece 0 can move
    expectIllegal(() => move(state, 1), ERR.ILLEGAL_MOVE);
    expectIllegal(() => move(state, 9), ERR.ILLEGAL_MOVE);
  });

  it('rejects a second ROLL while a move is pending', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 5 }]);
    const { state } = roll(base, 2);
    expectIllegal(() => roll(state, 3), ERR.BAD_PHASE);
  });
});

describe('roll resolution (§5.2.7)', () => {
  it('skips the turn automatically when no move is legal', () => {
    const state = startedGame(4);
    const { state: after, events } = roll(state, 3);
    expect(eventTypes(events)).toEqual(['DICE_ROLLED', 'TURN_SKIPPED', 'TURN_CHANGED']);
    expect(findEvent(events, 'TURN_SKIPPED')?.reason).toBe('no_moves');
    expect(after.currentSeat).toBe(1);
    expect(after.dice).toBe(0);
  });

  it('enters wait_move with the playable pieces highlighted', () => {
    const { state, events } = roll(startedGame(4), 6);
    expect(state.turnPhase).toBe('wait_move');
    expect(state.dice).toBe(6);
    expect(findEvent(events, 'DICE_ROLLED')?.legalPieceIds).toEqual([0, 1, 2, 3]);
    expect(findEvent(events, 'DICE_ROLLED')?.extraTurn).toBe(true);
  });

  it('records every injected dice value in rngLog (§5.5)', () => {
    let state = startedGame(4);
    state = roll(state, 3).state; // seat 0 skips
    state = roll(state, 5).state; // seat 1 skips
    state = roll(state, 6).state; // seat 2 rolls a six
    expect(state.rngLog).toEqual([3, 5, 6]);
  });
});

describe('extra turns (§5.2.5)', () => {
  it('re-rolls after playing a six', () => {
    const { state, events } = move(roll(startedGame(4), 6).state, 0);
    expect(findEvent(events, 'EXTRA_TURN')?.reasons).toEqual(['six']);
    expect(state.currentSeat).toBe(0);
    expect(state.turnPhase).toBe('wait_roll');
    expect(state.dice).toBe(0);
  });

  it('re-rolls after a capture', () => {
    const base = withPieces(startedGame(4), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 5) },
    ]);
    const { state, events } = move(roll(base, 3).state, 0);
    expect(findEvent(events, 'CAPTURE')).toMatchObject({ victimSeat: 1, victimPieceId: 0, cell: 5 });
    expect(findEvent(events, 'EXTRA_TURN')?.reasons).toEqual(['capture']);
    expect(state.currentSeat).toBe(0);
    // the victim went back to BASE
    expect(state.pieces.find((p) => p.seat === 1 && p.pieceId === 0)?.steps).toBe(-1);
  });

  it('does not re-roll on capture when the rule is off', () => {
    const base = withPieces(startedGame(4, { extraTurnOnCapture: false }), [
      { seat: 0, pieceId: 0, steps: 2 },
      { seat: 1, pieceId: 0, steps: stepsForAbs('blue', 5) },
    ]);
    const { state, events } = move(roll(base, 3).state, 0);
    expect(findEvent(events, 'EXTRA_TURN')).toBeUndefined();
    expect(state.currentSeat).toBe(1);
  });

  it('re-rolls after putting a piece into HOME', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 55 }]);
    const { state, events } = move(roll(base, 2).state, 0);
    expect(findEvent(events, 'PIECE_MOVED')?.reachedHome).toBe(true);
    expect(findEvent(events, 'EXTRA_TURN')?.reasons).toEqual(['home']);
    expect(state.currentSeat).toBe(0);
  });
});

describe('three consecutive sixes (§5.2.6)', () => {
  function twoSixesPlayed(): GameState {
    let state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 10 }]);
    state = move(roll(state, 6).state, 0).state; // six #1, piece to 16
    state = move(roll(state, 6).state, 0).state; // six #2, piece to 22
    return state;
  }

  it('counts sixes across extra turns and forfeits on the third', () => {
    const state = twoSixesPlayed();
    expect(state.consecutiveSixes).toBe(2);
    const { state: after, events } = roll(state, 6);
    expect(findEvent(events, 'TURN_SKIPPED')?.reason).toBe('triple_six');
    // the third roll is never played: the piece stays where it was
    expect(after.pieces.find((p) => p.seat === 0 && p.pieceId === 0)?.steps).toBe(22);
    expect(after.currentSeat).toBe(1);
    expect(after.consecutiveSixes).toBe(0);
    expect(after.rngLog).toEqual([6, 6, 6]);
  });

  it('lets the third six play out when tripleSixForfeit is off', () => {
    let state = withPieces(startedGame(4, { tripleSixForfeit: false }), [
      { seat: 0, pieceId: 0, steps: 10 },
    ]);
    state = move(roll(state, 6).state, 0).state;
    state = move(roll(state, 6).state, 0).state;
    const { state: after } = roll(state, 6);
    expect(after.turnPhase).toBe('wait_move');
    expect(after.currentSeat).toBe(0);
  });

  it('resets the streak on a non-six roll', () => {
    let state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 10 }]);
    state = move(roll(state, 6).state, 0).state;
    const after = move(roll(state, 3).state, 0).state;
    expect(after.consecutiveSixes).toBe(0);
  });
});

describe('purity and determinism of applyAction', () => {
  it('never mutates the input state', () => {
    const state = startedGame(4);
    const snapshot = JSON.stringify(state);
    roll(state, 6);
    roll(state, 3);
    applyAction(state, { type: 'FORFEIT', seat: 2 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('produces identical results for identical inputs', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 5 }]);
    const a = roll(base, 2);
    const b = roll(base, 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('timeout → auto-move (§5.4)', () => {
  it('rolls and moves for the player on a wait_roll timeout', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 5 }]);
    const { state, events } = applyAction(base, { type: 'TIMEOUT', dice: 3 });
    expect(findEvent(events, 'PLAYER_TIMEOUT')?.strikes).toBe(1);
    expect(findEvent(events, 'PIECE_MOVED')).toMatchObject({ seat: 0, pieceId: 0, to: 8 });
    expect(state.currentSeat).toBe(1);
    expect(getPlayer(state, 0).timeoutStrikes).toBe(1);
  });

  it('moves for the player on a wait_move timeout', () => {
    const base = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 5 }]);
    const rolled = roll(base, 2).state;
    const { state, events } = applyAction(rolled, { type: 'TIMEOUT' });
    expect(findEvent(events, 'PIECE_MOVED')?.to).toBe(7);
    expect(state.currentSeat).toBe(1);
  });

  it('requires an injected dice value during wait_roll', () => {
    const state = startedGame(4);
    expectIllegal(() => applyAction(state, { type: 'TIMEOUT' }), ERR.BAD_PHASE);
  });

  it('skips the turn instead when autoMoveOnTimeout is off', () => {
    const base = withPieces(startedGame(4, { autoMoveOnTimeout: false }), [
      { seat: 0, pieceId: 0, steps: 5 },
    ]);
    const { state, events } = applyAction(base, { type: 'TIMEOUT' });
    expect(findEvent(events, 'TURN_SKIPPED')?.reason).toBe('timeout');
    expect(state.rngLog).toEqual([]); // no dice consumed
    expect(state.currentSeat).toBe(1);
  });

  it('still enforces the triple-six forfeit on a timed-out roll', () => {
    let state = withPieces(startedGame(4), [{ seat: 0, pieceId: 0, steps: 10 }]);
    state = move(roll(state, 6).state, 0).state;
    state = move(roll(state, 6).state, 0).state;
    const { events } = applyAction(state, { type: 'TIMEOUT', dice: 6 });
    expect(findEvent(events, 'TURN_SKIPPED')?.reason).toBe('triple_six');
  });

  it('accumulates strikes across timeouts and resets them on a manual action', () => {
    // 2P: seat 0 times out, seat 1 wastes a roll, seat 0 acts manually.
    const base = withPieces(startedGame(2), [{ seat: 0, pieceId: 0, steps: 5 }]);
    let state = applyAction(base, { type: 'TIMEOUT', dice: 3 }).state; // piece to 8
    expect(getPlayer(state, 0).timeoutStrikes).toBe(1);
    state = roll(state, 3).state; // seat 1: all in base, skip back to seat 0
    expect(state.currentSeat).toBe(0);
    state = roll(state, 2).state; // manual roll
    expect(getPlayer(state, 0).timeoutStrikes).toBe(0);
  });
});

describe('forfeit (§6.7)', () => {
  it('ends a 2P match immediately, remaining player takes 1st place', () => {
    const state = startedGame(2);
    const { state: after, events } = applyAction(state, { type: 'FORFEIT', seat: 0 });
    expect(findEvent(events, 'PLAYER_FORFEITED')).toMatchObject({ seat: 0, place: 2 });
    expect(findEvent(events, 'MATCH_ENDED')?.ranking).toEqual([
      { seat: 1, place: 1 },
      { seat: 0, place: 2 },
    ]);
    expect(after.phase).toBe('finished');
  });

  it('retires the pieces of the forfeiting seat', () => {
    const base = withPieces(startedGame(4), [{ seat: 2, pieceId: 0, steps: 20 }]);
    const { state } = applyAction(base, { type: 'FORFEIT', seat: 2 });
    expect(state.pieces.filter((p) => p.seat === 2).every((p) => p.steps === -1)).toBe(true);
    expect(state.phase).toBe('playing'); // 3 actives keep playing
    expect(state.currentSeat).toBe(0); // not the forfeiter's turn: no change
  });

  it('passes the turn when the current player forfeits', () => {
    const state = startedGame(4);
    const { state: after } = applyAction(state, { type: 'FORFEIT', seat: 0 });
    expect(after.currentSeat).toBe(1);
  });

  it('rejects a double forfeit', () => {
    const { state } = applyAction(startedGame(4), { type: 'FORFEIT', seat: 2 });
    expectIllegal(() => applyAction(state, { type: 'FORFEIT', seat: 2 }), ERR.BAD_PHASE);
  });

  it('fills places bottom-up until one player remains, who takes 1st', () => {
    let state = startedGame(4);
    state = applyAction(state, { type: 'FORFEIT', seat: 1 }).state; // place 4
    state = applyAction(state, { type: 'FORFEIT', seat: 2 }).state; // place 3
    const { state: after, events } = applyAction(state, { type: 'FORFEIT', seat: 3 }); // place 2
    expect(after.phase).toBe('finished');
    expect(findEvent(events, 'MATCH_ENDED')?.ranking).toEqual([
      { seat: 0, place: 1 },
      { seat: 3, place: 2 },
      { seat: 2, place: 3 },
      { seat: 1, place: 4 },
    ]);
  });
});
