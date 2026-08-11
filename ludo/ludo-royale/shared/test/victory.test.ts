import { describe, expect, it } from 'vitest';
import type { GameState, Seat } from '../src/index.js';
import { eventTypes, findEvent, move, roll, startedGame, withPieces } from './helpers.js';

/** Seat with pieces 57/57/57/55: the next exact 2 finishes it. */
function almostDone(state: GameState, seat: Seat): GameState {
  return withPieces(state, [
    { seat, pieceId: 0, steps: 57 },
    { seat, pieceId: 1, steps: 57 },
    { seat, pieceId: 2, steps: 57 },
    { seat, pieceId: 3, steps: 55 },
  ]);
}

describe('victory and finish order (§5.2.8)', () => {
  it('finishing the 4th piece awards 1st place', () => {
    const state = almostDone(startedGame(4), 0);
    const { events } = move(roll(state, 2).state, 3);
    expect(findEvent(events, 'PLAYER_FINISHED')).toMatchObject({ seat: 0, place: 1 });
  });

  it('ends a 2P match at the first winner', () => {
    const state = almostDone(startedGame(2), 0);
    const { state: after, events } = move(roll(state, 2).state, 3);
    expect(after.phase).toBe('finished');
    expect(findEvent(events, 'MATCH_ENDED')?.ranking).toEqual([
      { seat: 0, place: 1 },
      { seat: 1, place: 2 },
    ]);
  });

  it('keeps a 4P match running until 2nd place is decided (playForSecond)', () => {
    let state = almostDone(startedGame(4), 0);
    state = withPieces(state, [
      { seat: 2, pieceId: 0, steps: 30 },
      { seat: 3, pieceId: 0, steps: 10 },
    ]);
    // Seat 0 finishes: the earned extra turn is void and play continues.
    state = move(roll(state, 2).state, 3).state;
    expect(state.phase).toBe('playing');
    expect(state.currentSeat).toBe(1);

    // Seat 1 finishes: match ends, survivors rank by board progress.
    state = almostDone(state, 1);
    const { state: after, events } = move(roll(state, 2).state, 3);
    expect(after.phase).toBe('finished');
    expect(findEvent(events, 'MATCH_ENDED')?.ranking).toEqual([
      { seat: 0, place: 1 },
      { seat: 1, place: 2 },
      { seat: 2, place: 3 }, // progress 30
      { seat: 3, place: 4 }, // progress 10
    ]);
  });

  it('ranks survivors by progress (reversed fixture)', () => {
    let state = almostDone(startedGame(4), 0);
    state = withPieces(state, [
      { seat: 2, pieceId: 0, steps: 10 },
      { seat: 3, pieceId: 0, steps: 30 },
    ]);
    state = move(roll(state, 2).state, 3).state;
    state = almostDone(state, 1);
    const { events } = move(roll(state, 2).state, 3);
    const ranking = findEvent(events, 'MATCH_ENDED')?.ranking;
    expect(ranking).toContainEqual({ seat: 3, place: 3 });
    expect(ranking).toContainEqual({ seat: 2, place: 4 });
  });

  it('breaks equal progress by seat order', () => {
    const state = almostDone(startedGame(4, { playForSecond: false }), 0);
    const { events } = move(roll(state, 2).state, 3);
    expect(findEvent(events, 'MATCH_ENDED')?.ranking).toEqual([
      { seat: 0, place: 1 },
      { seat: 1, place: 2 },
      { seat: 2, place: 3 },
      { seat: 3, place: 4 },
    ]);
  });

  it('ends a 4P match at the first winner when playForSecond is off', () => {
    let state = almostDone(startedGame(4, { playForSecond: false }), 0);
    state = withPieces(state, [{ seat: 2, pieceId: 0, steps: 30 }]);
    const { state: after, events } = move(roll(state, 2).state, 3);
    expect(after.phase).toBe('finished');
    expect(findEvent(events, 'MATCH_ENDED')?.ranking).toEqual([
      { seat: 0, place: 1 },
      { seat: 2, place: 2 }, // progress 30 beats the empty boards
      { seat: 1, place: 3 },
      { seat: 3, place: 4 },
    ]);
  });

  it('skips a finished player in the turn rotation', () => {
    let state = almostDone(startedGame(4), 0);
    state = move(roll(state, 2).state, 3).state; // seat 0 done, turn → seat 1
    expect(state.currentSeat).toBe(1);
    state = roll(state, 3).state; // seat 1 skips (all in base)
    expect(state.currentSeat).toBe(2);
    state = roll(state, 3).state;
    expect(state.currentSeat).toBe(3);
    state = roll(state, 3).state;
    expect(state.currentSeat).toBe(1); // wraps past the finished seat 0
  });

  it('plays 3P to 2nd place and closes with unique places 1..3', () => {
    let state = almostDone(startedGame(3), 0);
    state = move(roll(state, 2).state, 3).state;
    expect(state.phase).toBe('playing');
    state = almostDone(state, 1);
    const { state: after, events } = move(roll(state, 2).state, 3);
    expect(after.phase).toBe('finished');
    const places = findEvent(events, 'MATCH_ENDED')?.ranking.map((r) => r.place);
    expect(places).toEqual([1, 2, 3]);
    expect(eventTypes(events)).toContain('MATCH_ENDED');
  });
});
