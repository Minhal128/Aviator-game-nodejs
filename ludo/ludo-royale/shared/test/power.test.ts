/**
 * POWER mode (Ludo World parity): deterministic token drops, landing
 * collection, the four powers (plus / double / pick / shield) and their
 * edge rules — streak handling, refunds on timeout, shield expiry.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  isShielded,
  legalMoves,
  POWER_CHARGE_CAP,
  POWER_INITIAL_TOKENS,
  POWER_MAX_TOKENS,
  SAFE_CELLS,
} from '../src/index.js';
import type { GameState, PowerType, Seat } from '../src/index.js';
import { eventTypes, findEvent, mulberry32, stepsForAbs, withPieces } from './helpers.js';

function startedPower(numPlayers: 2 | 3 | 4 = 2, startingSeat: Seat = 0): GameState {
  const game = createGame({ numPlayers, startingSeat, powerMode: true });
  return applyAction(game, { type: 'START' }).state;
}

/** Grant charges directly (test-only shortcut). */
function withCharges(state: GameState, seat: Seat, grant: Partial<Record<PowerType, number>>): GameState {
  const next = structuredClone(state);
  Object.assign(next.charges[seat]!, grant);
  return next;
}

describe('POWER — token spawns', () => {
  it('classic matches never spawn tokens', () => {
    const state = applyAction(createGame({ numPlayers: 2 }), { type: 'START' }).state;
    expect(state.tokens).toHaveLength(0);
    const after = applyAction(state, { type: 'ROLL', seat: 0, dice: 3 }).state;
    expect(after.tokens).toHaveLength(0);
  });

  it('a POWER match opens with the initial tokens on free non-safe ring cells', () => {
    const state = startedPower();
    expect(state.tokens).toHaveLength(POWER_INITIAL_TOKENS);
    for (const t of state.tokens) {
      expect(t.cell).toBeGreaterThanOrEqual(0);
      expect(t.cell).toBeLessThan(52);
      expect(SAFE_CELLS.has(t.cell)).toBe(false);
    }
    // Distinct cells.
    expect(new Set(state.tokens.map((t) => t.cell)).size).toBe(POWER_INITIAL_TOKENS);
  });

  it('spawns are deterministic: same action log → same board', () => {
    const run = () => {
      let s = startedPower();
      const rand = mulberry32(0xbeef);
      for (let i = 0; i < 30 && s.phase === 'playing'; i++) {
        if (s.turnPhase === 'wait_roll') {
          s = applyAction(s, { type: 'ROLL', seat: s.currentSeat, dice: 1 + Math.floor(rand() * 6) }).state;
        } else {
          const pid = legalMoves(s, s.currentSeat, s.dice)[0]!.pieceId;
          s = applyAction(s, { type: 'MOVE', seat: s.currentSeat, pieceId: pid }).state;
        }
      }
      return s.tokens;
    };
    expect(run()).toEqual(run());
  });

  it('never exceeds the board cap', () => {
    let s = startedPower();
    const rand = mulberry32(0x7007);
    for (let i = 0; i < 200 && s.phase === 'playing'; i++) {
      if (s.turnPhase === 'wait_roll') {
        s = applyAction(s, { type: 'ROLL', seat: s.currentSeat, dice: 1 + Math.floor(rand() * 6) }).state;
      } else {
        const moves = legalMoves(s, s.currentSeat, s.dice);
        const pid = moves[Math.floor(rand() * moves.length)]!.pieceId;
        s = applyAction(s, { type: 'MOVE', seat: s.currentSeat, pieceId: pid }).state;
      }
      expect(s.tokens.length).toBeLessThanOrEqual(POWER_MAX_TOKENS);
    }
  });
});

describe('POWER — collection', () => {
  it('landing on a token collects it and caps at POWER_CHARGE_CAP', () => {
    let s = startedPower();
    // Clear spawned tokens and plant one exactly 3 cells ahead of red's piece.
    s = withPieces(s, [{ seat: 0, pieceId: 0, steps: 1 }]);
    s.tokens = [{ cell: 4, power: 'shield' }]; // red steps 4 = abs cell 4
    s = applyAction(s, { type: 'ROLL', seat: 0, dice: 3 }).state;
    const res = applyAction(s, { type: 'MOVE', seat: 0, pieceId: 0 });
    const collected = findEvent(res.events, 'TOKEN_COLLECTED');
    expect(collected).toMatchObject({ seat: 0, cell: 4, power: 'shield', charges: 1 });
    expect(res.state.tokens.some((t) => t.cell === 4)).toBe(false);
    expect(res.state.charges[0]!.shield).toBe(1);

    // Cap: grant CAP charges and collect one more — wasted, still consumed.
    let capped = withCharges(startedPower(), 0, { plus: POWER_CHARGE_CAP });
    capped = withPieces(capped, [{ seat: 0, pieceId: 0, steps: 1 }]);
    capped.tokens = [{ cell: 4, power: 'plus' }];
    capped = applyAction(capped, { type: 'ROLL', seat: 0, dice: 3 }).state;
    const cappedRes = applyAction(capped, { type: 'MOVE', seat: 0, pieceId: 0 });
    expect(cappedRes.state.charges[0]!.plus).toBe(POWER_CHARGE_CAP);
    expect(cappedRes.state.tokens.some((t) => t.cell === 4)).toBe(false);
  });
});

describe('POWER — pick', () => {
  it('the next roll resolves to the chosen face', () => {
    let s = withCharges(startedPower(), 0, { pick: 1 });
    const used = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'pick', face: 6 });
    expect(findEvent(used.events, 'POWER_USED')).toMatchObject({ power: 'pick', face: 6 });
    expect(used.state.charges[0]!.pick).toBe(0);
    // The injected dice value is ignored — the pick owns this roll.
    const rolled = applyAction(used.state, { type: 'ROLL', seat: 0, dice: 2 });
    const dice = findEvent(rolled.events, 'DICE_ROLLED');
    expect(dice).toMatchObject({ value: 6, picked: true });
    expect(rolled.state.turnPhase).toBe('wait_move'); // 6 exits base
  });

  it('a picked six does not feed the triple-six forfeit', () => {
    let s = withCharges(startedPower(), 0, { pick: 1 });
    s = withPieces(s, [{ seat: 0, pieceId: 0, steps: 5 }]);
    s.consecutiveSixes = 2; // two natural sixes already rolled
    const used = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'pick', face: 6 }).state;
    const rolled = applyAction(used, { type: 'ROLL', seat: 0, dice: 1 });
    // No TURN_SKIPPED(triple_six): the pick is exempt.
    expect(eventTypes(rolled.events)).not.toContain('TURN_SKIPPED');
    expect(rolled.state.consecutiveSixes).toBe(2); // streak frozen, not fed
  });

  it('requires a charge and a valid face', () => {
    const s = startedPower();
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'pick', face: 6 })).toThrow();
    const armed = withCharges(s, 0, { pick: 1 });
    expect(() => applyAction(armed, { type: 'USE_POWER', seat: 0, power: 'pick', face: 9 })).toThrow();
  });
});

describe('POWER — double', () => {
  it('rolls two dice and moves their sum, without the six re-roll', () => {
    let s = withCharges(startedPower(), 0, { double: 1 });
    s = withPieces(s, [{ seat: 0, pieceId: 0, steps: 10 }]);
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'double' }).state;
    expect(s.pendingRoll).toEqual({ kind: 'double' });
    const rolled = applyAction(s, { type: 'ROLL', seat: 0, dice: 4, dice2: 2 });
    const dice = findEvent(rolled.events, 'DICE_ROLLED');
    expect(dice).toMatchObject({ value: 6, parts: [4, 2], extraTurn: false });
    const moved = applyAction(rolled.state, { type: 'MOVE', seat: 0, pieceId: 0 });
    // Sum of 6 does NOT grant the six extra turn: turn passes to seat 1.
    expect(moved.state.currentSeat).toBe(1);
    expect(moved.state.pieces.find((p) => p.seat === 0 && p.pieceId === 0)!.steps).toBe(16);
  });

  it('a double roll without dice2 is rejected', () => {
    let s = withCharges(startedPower(), 0, { double: 1 });
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'double' }).state;
    expect(() => applyAction(s, { type: 'ROLL', seat: 0, dice: 4 })).toThrow();
  });

  it('an armed modifier is refunded on timeout', () => {
    let s = withCharges(startedPower(), 0, { double: 1 });
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'double' }).state;
    expect(s.charges[0]!.double).toBe(0);
    const timedOut = applyAction(s, { type: 'TIMEOUT', dice: 3 });
    expect(timedOut.state.charges[0]!.double).toBe(1);
    expect(timedOut.state.pendingRoll).toBeNull();
  });
});

describe('POWER — shield', () => {
  it('blocks captures until the owner turn comes back', () => {
    // Seat 1 shields a piece; red lands on it and captures nothing.
    // NOTE: 2P seats are red + YELLOW (opposite corners).
    let s = startedPower(2, 1);
    const enemyColor = s.players[1]!.color;
    s = withPieces(s, [
      { seat: 1, pieceId: 0, steps: stepsForAbs(enemyColor, 5) },
      { seat: 0, pieceId: 0, steps: 2 }, // red at abs 2, 3 short of the dome
    ]);
    s = withCharges(s, 1, { shield: 1 });
    const shielded = applyAction(s, { type: 'USE_POWER', seat: 1, power: 'shield', pieceId: 0 });
    expect(isShielded(shielded.state, 1, 0)).toBe(true);
    expect(shielded.state.charges[1]!.shield).toBe(0);

    // Seat 1 rolls/moves something else, then red tries to capture the dome.
    let st = applyAction(shielded.state, { type: 'ROLL', seat: 1, dice: 6 }).state;
    st = applyAction(st, { type: 'MOVE', seat: 1, pieceId: 1 }).state; // exits base (extra turn)
    st = applyAction(st, { type: 'ROLL', seat: 1, dice: 2 }).state;
    st = applyAction(st, { type: 'MOVE', seat: 1, pieceId: 1 }).state;

    expect(st.currentSeat).toBe(0);
    st = applyAction(st, { type: 'ROLL', seat: 0, dice: 3 }).state;
    const res = applyAction(st, { type: 'MOVE', seat: 0, pieceId: 0 });
    expect(eventTypes(res.events)).not.toContain('CAPTURE');
    // The domed piece never moved — both pieces share abs cell 5 now.
    expect(res.state.pieces.find((p) => p.seat === 1 && p.pieceId === 0)!.steps).toBe(
      stepsForAbs(enemyColor, 5),
    );
    expect(res.state.pieces.find((p) => p.seat === 0 && p.pieceId === 0)!.steps).toBe(5);

    // The dome owner's turn starts → it pops.
    expect(res.state.currentSeat).toBe(1);
    expect(isShielded(res.state, 1, 0)).toBe(false);
  });

  it('only ring pieces can be shielded', () => {
    const s = withCharges(startedPower(), 0, { shield: 1 });
    // Piece 0 is in BASE.
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'shield', pieceId: 0 })).toThrow();
  });
});

describe('POWER — plus', () => {
  it('advances one cell during the roll phase and the player still rolls', () => {
    let s = withCharges(startedPower(), 0, { plus: 1 });
    s = withPieces(s, [{ seat: 0, pieceId: 0, steps: 7 }]);
    const res = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'plus', pieceId: 0 });
    expect(findEvent(res.events, 'PIECE_MOVED')).toMatchObject({ from: 7, to: 8 });
    expect(res.state.turnPhase).toBe('wait_roll');
    expect(res.state.currentSeat).toBe(0);
    expect(res.state.charges[0]!.plus).toBe(0);
    // And the roll still works afterwards.
    const rolled = applyAction(res.state, { type: 'ROLL', seat: 0, dice: 2 });
    expect(rolled.state.turnPhase).toBe('wait_move');
  });

  it('can capture and can finish a piece exactly into HOME', () => {
    let s = withCharges(startedPower(2, 0), 0, { plus: 2 });
    const enemyColor = s.players[1]!.color; // 2P pairs red with YELLOW
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 10 },
      { seat: 1, pieceId: 0, steps: stepsForAbs(enemyColor, 11) },
    ]);
    const cap = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'plus', pieceId: 0 });
    expect(eventTypes(cap.events)).toContain('CAPTURE');

    let h = withCharges(startedPower(), 0, { plus: 1 });
    h = withPieces(h, [{ seat: 0, pieceId: 0, steps: 56 }]);
    const home = applyAction(h, { type: 'USE_POWER', seat: 0, power: 'plus', pieceId: 0 });
    expect(findEvent(home.events, 'PIECE_MOVED')).toMatchObject({ to: 57, reachedHome: true });
  });

  it('cannot move a BASE piece', () => {
    const s = withCharges(startedPower(), 0, { plus: 1 });
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'plus', pieceId: 0 })).toThrow();
  });
});

describe('POWER — guards', () => {
  it('USE_POWER is rejected in classic matches and out of turn', () => {
    const classic = applyAction(createGame({ numPlayers: 2 }), { type: 'START' }).state;
    expect(() =>
      applyAction(classic, { type: 'USE_POWER', seat: 0, power: 'double' }),
    ).toThrow();

    const power = withCharges(startedPower(), 1, { double: 1 });
    expect(() =>
      applyAction(power, { type: 'USE_POWER', seat: 1, power: 'double' }),
    ).toThrow(); // seat 1 is not on turn
  });
});
