/**
 * Room lifecycle (§6.2): fill → countdown → playing, protocol flow of a
 * scripted opening, and a complete live 2P match driven purely through
 * client messages (the Sprint-2 acceptance case).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { DiceMessage, MatchEndMessage, MoveResultMessage, TurnMessage } from '@ludo/shared';
import appConfig from '../src/app.config.js';
import { playUntilEnd, quick2, scriptDice, startedQuick2, until } from './helpers.js';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

describe('LudoRoom lifecycle', () => {
  it('fills a 2P quick room, counts down and starts with seat 0 to roll', async () => {
    const rig = await quick2(colyseus);
    expect(rig.room.state.phase === 'lobby' || rig.room.state.phase === 'countdown').toBe(true);

    const turn1 = (await rig.c1.log.next('turn')) as TurnMessage;
    const turn2 = (await rig.c2.log.next('turn')) as TurnMessage;
    expect(turn1.seat).toBe(0);
    expect(turn1.phase).toBe('roll');
    expect(turn2.seat).toBe(0);
    expect(turn1.deadline).toBeGreaterThan(Date.now() - 1000);
    expect(rig.room.state.phase).toBe('playing');
  });

  it('mirrors the engine into the schema: 2 players (red/yellow) and 8 pieces in base', async () => {
    const rig = await startedQuick2(colyseus);
    expect(rig.room.state.numPlayers).toBe(2);
    expect(rig.room.state.pieces.length).toBe(8);

    const colors: string[] = [];
    rig.room.state.players.forEach((player) => colors.push(player.color));
    colors.sort();
    // §5.1/board.ts: 2P games take opposite corners.
    expect(colors).toEqual(['red', 'yellow']);

    let allInBase = true;
    rig.room.state.pieces.forEach((piece) => {
      if (piece.steps !== -1) allInBase = false;
    });
    expect(allInBase).toBe(true);
  });

  it('roll → dice broadcast with legal pieces; move → moveResult with path + extra turn on a six', async () => {
    const rig = await startedQuick2(colyseus);
    scriptDice(rig.room, [6]);

    rig.c1.room.send('roll', {});
    const dice = (await rig.c2.log.next('dice')) as DiceMessage;
    expect(dice.seat).toBe(0);
    expect(dice.value).toBe(6);
    // All four pieces can leave BASE on a six.
    expect(dice.legalPieceIds).toEqual([0, 1, 2, 3]);
    expect(dice.extraTurn).toBe(true);

    // The move sub-phase gets its own turn message (§6.5).
    const movePhase = (await rig.c1.log.next('turn')) as TurnMessage;
    expect(movePhase.phase).toBe('move');

    rig.c1.room.send('move', { pieceId: 2 });
    const moved = (await rig.c2.log.next('moveResult')) as MoveResultMessage;
    expect(moved.seat).toBe(0);
    expect(moved.pieceId).toBe(2);
    expect(moved.path).toEqual([0]); // BASE → entry cell
    expect(moved.reachedHome).toBe(false);
    expect(moved.extraTurn).toBe(true); // the six re-rolls

    const again = (await rig.c1.log.next('turn')) as TurnMessage;
    expect(again.seat).toBe(0);
    expect(again.phase).toBe('roll');
  });

  it('skips the turn automatically when the roll has no legal moves', async () => {
    const rig = await startedQuick2(colyseus);
    scriptDice(rig.room, [3]); // everything in BASE and no six → nothing to move

    rig.c1.room.send('roll', {});
    const skipped = (await rig.c1.log.next('turnSkipped')) as { seat: number; reason: string };
    expect(skipped.seat).toBe(0);
    expect(skipped.reason).toBe('no_moves');
    const turn = (await rig.c1.log.next('turn')) as TurnMessage;
    expect(turn.seat).toBe(1);
  });

  it('plays a complete live 2P match to matchEnd through the protocol', async () => {
    const rig = await startedQuick2(colyseus);
    // Seat 0 always receives the exact remaining of its lead piece (capped
    // at 6), so every roll of theirs is playable and the match must finish;
    // seat 1 crawls with 2s and never leaves BASE.
    rig.room.rollDie = () => {
      const match = rig.room.matchState;
      if (!match || match.currentSeat !== 0) return 2;
      const mine = match.pieces.filter((p) => p.seat === 0 && p.steps < 57);
      const lead = mine.reduce((best, p) => (p.steps > best ? p.steps : best), -1);
      if (lead < 0) return 6; // everything in BASE — exit with a six
      const remaining: number = 57 - lead;
      return remaining < 6 ? remaining : 6;
    };

    const end: MatchEndMessage = await playUntilEnd(rig);
    expect(end.potTotal).toBe(0);
    expect(end.ranking).toHaveLength(2);
    const first = end.ranking.find((r) => r.place === 1);
    expect(first?.seat).toBe(0);
    expect(rig.room.state.phase).toBe('finished');
    await until(() => rig.c2.log.received('matchEnd'));
  }, 90000);
});
