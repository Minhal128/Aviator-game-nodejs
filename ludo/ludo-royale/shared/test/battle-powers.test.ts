/**
 * POWER battle set (inventory model): charges seeded from the shop loadout
 * (clamped to POWER_MATCH_CAP), tokenDrops off, and the four offensive
 * powers — bomb (trap), bolt (knockback), freeze (skip turn), portal (jump
 * to the next safe cell).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  isFrozen,
  isShielded,
  legalMoves,
  POWER_MATCH_CAP,
} from '../src/index.js';
import type { GameState, PowerType, Seat } from '../src/index.js';
import { eventTypes, findEvent, withPieces } from './helpers.js';

/** 2P inventory-model POWER match: no board drops, seeded charges. */
function startedInv(
  charges: ReadonlyArray<Partial<Record<PowerType, number>> | undefined> = [],
): GameState {
  const game = createGame({
    numPlayers: 2,
    powerMode: true,
    tokenDrops: false,
    initialCharges: charges,
  });
  return applyAction(game, { type: 'START' }).state;
}

describe('POWER inventory model — seeding', () => {
  it('seeds charges from the loadout, clamped to POWER_MATCH_CAP', () => {
    const s = startedInv([{ bomb: 9, bolt: 1, freeze: 0 }]);
    expect(s.charges[0]!.bomb).toBe(POWER_MATCH_CAP);
    expect(s.charges[0]!.bolt).toBe(1);
    expect(s.charges[0]!.freeze).toBe(0);
    expect(s.charges[0]!.portal).toBe(0);
    expect(s.charges[1]!.bomb).toBe(0); // missing seats start empty
  });

  it('tokenDrops:false keeps the ring clean forever', () => {
    let s = startedInv([{ }]);
    expect(s.tokens).toHaveLength(0);
    for (let i = 0; i < 30 && s.phase === 'playing'; i++) {
      if (s.turnPhase === 'wait_roll') {
        s = applyAction(s, { type: 'ROLL', seat: s.currentSeat, dice: 1 + (i % 6) }).state;
      } else {
        const pid = legalMoves(s, s.currentSeat, s.dice)[0]!.pieceId;
        s = applyAction(s, { type: 'MOVE', seat: s.currentSeat, pieceId: pid }).state;
      }
      expect(s.tokens).toHaveLength(0);
    }
  });

  it('legacy matches (tokenDrops default) still spawn like before', () => {
    const s = applyAction(
      createGame({ numPlayers: 2, powerMode: true }),
      { type: 'START' },
    ).state;
    expect(s.tokens.length).toBeGreaterThan(0);
  });
});

describe('POWER — bomb', () => {
  it('places a trap on a free non-safe ring cell and explodes an enemy lander', () => {
    let s = startedInv([{ bomb: 1 }]);
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 1 },
      { seat: 1, pieceId: 0, steps: 28 }, // 2P seat1 = YELLOW (entry 26): steps 31 = abs 5
    ]);
    const used = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 5 });
    expect(findEvent(used.events, 'POWER_USED')).toMatchObject({ power: 'bomb', cell: 5 });
    expect(used.state.traps).toEqual([{ seat: 0, cell: 5 }]);
    expect(used.state.charges[0]!.bomb).toBe(0);

    // Red plays its roll; turn passes to blue.
    let t = applyAction(used.state, { type: 'ROLL', seat: 0, dice: 2 }).state;
    t = applyAction(t, { type: 'MOVE', seat: 0, pieceId: 0 }).state;
    expect(t.currentSeat).toBe(1);
    // Yellow rolls 3: steps 28 → 31 = abs (26+31)%52 = 5 → BOOM.
    t = applyAction(t, { type: 'ROLL', seat: 1, dice: 3 }).state;
    const boom = applyAction(t, { type: 'MOVE', seat: 1, pieceId: 0 });
    const trig = findEvent(boom.events, 'TRAP_TRIGGERED');
    expect(trig).toMatchObject({ seat: 0, victimSeat: 1, victimPieceId: 0, cell: 5, blocked: false });
    expect(boom.state.pieces.find((p) => p.seat === 1 && p.pieceId === 0)!.steps).toBe(-1);
    expect(boom.state.traps).toHaveLength(0);
  });

  it('a shield absorbs the blast (shield + trap consumed, piece survives)', () => {
    let s = startedInv([{ bomb: 1 }]);
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 1 },
      { seat: 1, pieceId: 0, steps: 28 },
    ]);
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 5 }).state;
    let t = applyAction(s, { type: 'ROLL', seat: 0, dice: 2 }).state;
    t = applyAction(t, { type: 'MOVE', seat: 0, pieceId: 0 }).state;
    // Shield AFTER the turn reaches yellow — advanceTurn pops the owner's
    // domes, so a pre-turn shield would be gone by now (engine lifetime).
    t.shields.push({ seat: 1, pieceId: 0 });
    t = applyAction(t, { type: 'ROLL', seat: 1, dice: 3 }).state;
    const boom = applyAction(t, { type: 'MOVE', seat: 1, pieceId: 0 });
    const trig = findEvent(boom.events, 'TRAP_TRIGGERED');
    expect(trig).toMatchObject({ blocked: true });
    expect(boom.state.pieces.find((p) => p.seat === 1 && p.pieceId === 0)!.steps).toBe(31);
    expect(boom.state.traps).toHaveLength(0);
    expect(isShielded(boom.state, 1, 0)).toBe(false);
  });

  it('stacking: planting over a RIVAL trap is legal, over your OWN is rejected', () => {
    let s = startedInv([{ bomb: 2 }, { bomb: 1 }]);
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 1 },
      { seat: 1, pieceId: 0, steps: 28 },
    ]);
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 5 }).state;
    // Same seat, same cell -> still rejected (no self-stacking).
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 5 })).toThrow();
    // Red plays out its roll; yellow may then plant on red's hidden trap.
    let t = applyAction(s, { type: 'ROLL', seat: 0, dice: 2 }).state;
    t = applyAction(t, { type: 'MOVE', seat: 0, pieceId: 0 }).state;
    const stacked = applyAction(t, { type: 'USE_POWER', seat: 1, power: 'bomb', cell: 5 });
    expect(stacked.state.traps).toEqual([
      { seat: 0, cell: 5 },
      { seat: 1, cell: 5 },
    ]);
  });

  it('rejects safe cells, occupied cells, duplicates and bad cells', () => {
    let s = startedInv([{ bomb: 2 }]);
    s = withPieces(s, [{ seat: 1, pieceId: 0, steps: 31 }]); // yellow steps 31 = abs 5 occupied
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 8 })).toThrow(); // safe
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 5 })).toThrow(); // occupied
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 99 })).toThrow();
    const ok = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 6 }).state;
    expect(() => applyAction(ok, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 6 })).toThrow(); // duplicate
  });
});

describe('POWER — bolt', () => {
  it('knocks an enemy ring piece back 6 cells (teleport move)', () => {
    let s = startedInv([{ bolt: 1 }]);
    s = withPieces(s, [{ seat: 1, pieceId: 0, steps: 10 }]);
    const res = applyAction(s, {
      type: 'USE_POWER', seat: 0, power: 'bolt', targetSeat: 1, pieceId: 0,
    });
    expect(findEvent(res.events, 'POWER_USED')).toMatchObject({ power: 'bolt', targetSeat: 1 });
    const moved = findEvent(res.events, 'PIECE_MOVED');
    expect(moved).toMatchObject({ seat: 1, pieceId: 0, from: 10, to: 4, teleport: true });
    expect(res.state.pieces.find((p) => p.seat === 1 && p.pieceId === 0)!.steps).toBe(4);
  });

  it('sends a piece within 6 steps of its entry straight to BASE', () => {
    let s = startedInv([{ bolt: 1 }]);
    s = withPieces(s, [{ seat: 1, pieceId: 0, steps: 3 }]);
    const res = applyAction(s, {
      type: 'USE_POWER', seat: 0, power: 'bolt', targetSeat: 1, pieceId: 0,
    });
    expect(res.state.pieces.find((p) => p.seat === 1 && p.pieceId === 0)!.steps).toBe(-1);
  });

  it('rejects shielded, base/lane and own pieces', () => {
    let s = startedInv([{ bolt: 2 }]);
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 5 },
      { seat: 1, pieceId: 0, steps: 10 },
      { seat: 1, pieceId: 1, steps: 53 }, // home lane
    ]);
    s.shields.push({ seat: 1, pieceId: 0 });
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bolt', targetSeat: 1, pieceId: 0 })).toThrow();
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bolt', targetSeat: 1, pieceId: 1 })).toThrow();
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bolt', targetSeat: 0, pieceId: 0 })).toThrow();
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bolt', targetSeat: 1, pieceId: 2 })).toThrow(); // in base
  });
});

describe('POWER — freeze', () => {
  it('the frozen piece sits out exactly one owner turn', () => {
    let s = startedInv([{ freeze: 1 }]);
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 1 },
      { seat: 1, pieceId: 0, steps: 10 },
    ]);
    s = applyAction(s, {
      type: 'USE_POWER', seat: 0, power: 'freeze', targetSeat: 1, pieceId: 0,
    }).state;
    expect(isFrozen(s, 1, 0)).toBe(true);

    // Red plays; blue's roll finds NO legal moves (its only piece is frozen).
    let t = applyAction(s, { type: 'ROLL', seat: 0, dice: 2 }).state;
    t = applyAction(t, { type: 'MOVE', seat: 0, pieceId: 0 }).state;
    expect(t.currentSeat).toBe(1);
    const skipped = applyAction(t, { type: 'ROLL', seat: 1, dice: 3 });
    expect(eventTypes(skipped.events)).toContain('TURN_SKIPPED');
    // The wasted turn thawed the piece as it passed on.
    expect(isFrozen(skipped.state, 1, 0)).toBe(false);

    // Next blue turn the piece moves again.
    let u = applyAction(skipped.state, { type: 'ROLL', seat: 0, dice: 2 }).state;
    u = applyAction(u, { type: 'MOVE', seat: 0, pieceId: 0 }).state;
    expect(legalMoves(u, 1, 3).length).toBeGreaterThan(0);
  });

  it('rejects shielded, frozen-again, base and home targets', () => {
    let s = startedInv([{ freeze: 2 }]);
    s = withPieces(s, [
      { seat: 1, pieceId: 0, steps: 10 },
      { seat: 1, pieceId: 1, steps: 12 },
    ]);
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'freeze', targetSeat: 1, pieceId: 0 }).state;
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'freeze', targetSeat: 1, pieceId: 0 })).toThrow(); // again
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'freeze', targetSeat: 1, pieceId: 2 })).toThrow(); // base
    s.shields.push({ seat: 1, pieceId: 1 });
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'freeze', targetSeat: 1, pieceId: 1 })).toThrow(); // shielded
  });
});

describe('POWER — portal', () => {
  it('jumps the piece to the nearest safe cell ahead (teleport move)', () => {
    let s = startedInv([{ portal: 1 }]);
    s = withPieces(s, [{ seat: 0, pieceId: 0, steps: 3 }]); // red: abs == steps
    const res = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'portal', pieceId: 0 });
    const moved = findEvent(res.events, 'PIECE_MOVED');
    expect(moved).toMatchObject({ seat: 0, pieceId: 0, from: 3, to: 8, teleport: true }); // abs 8 is safe
    expect(res.state.charges[0]!.portal).toBe(0);
  });

  it('skips a safe cell walled by two enemy pieces', () => {
    let s = startedInv([{ portal: 1 }]);
    s = withPieces(s, [
      { seat: 0, pieceId: 0, steps: 3 },
      { seat: 1, pieceId: 0, steps: 34 }, // yellow steps 34 = abs (26+34)%52 = 8
      { seat: 1, pieceId: 1, steps: 34 },
    ]);
    const res = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'portal', pieceId: 0 });
    expect(findEvent(res.events, 'PIECE_MOVED')).toMatchObject({ to: 13 }); // next safe abs 13
  });

  it('rejects pieces with no safe cell ahead on the ring', () => {
    let s = startedInv([{ portal: 1 }]);
    s = withPieces(s, [{ seat: 0, pieceId: 0, steps: 48 }]); // only 49,50 ahead — none safe
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'portal', pieceId: 0 })).toThrow();
  });
});

describe('POWER — per-match cap', () => {
  it('each power stops at its seeded charges (max 2 uses)', () => {
    let s = startedInv([{ bomb: 5 }]); // clamped to 2
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 5 }).state;
    s = applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 6 }).state;
    expect(() => applyAction(s, { type: 'USE_POWER', seat: 0, power: 'bomb', cell: 7 })).toThrow();
  });
});
