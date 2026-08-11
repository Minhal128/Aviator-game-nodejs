/**
 * Server-side turn timers (§5.4): timeout → engine auto-move + strike;
 * two consecutive strikes → the seat flips to AUTO (server plays Easy);
 * any manual action exits AUTO and clears strikes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { DiceMessage, PlayerStatusMessage, TurnMessage } from '@ludo/shared';
import appConfig from '../src/app.config.js';
import { startedQuick2, until } from './helpers.js';

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

describe('LudoRoom timeouts and AUTO mode', () => {
  it('rolls and moves for a silent player on timeout (strike 1)', async () => {
    const rig = await startedQuick2(colyseus, { turnTimerS: 0.15 });
    rig.room.rollDie = () => 6; // guarantee a playable roll

    // Nobody acts: the server should roll a 6 and play the Easy move itself.
    const dice = (await rig.c2.log.next('dice')) as DiceMessage;
    expect(dice.seat).toBe(0);
    expect(dice.value).toBe(6);
    await rig.c2.log.next('moveResult');
    await until(() => (rig.room.matchState?.players[0]?.timeoutStrikes ?? 0) >= 1);
  });

  it('flips the seat to AUTO after 2 consecutive timeouts and keeps playing', async () => {
    const rig = await startedQuick2(colyseus, { turnTimerS: 0.15 });
    rig.room.rollDie = () => {
      // Seat 0 gets playable sixes; seat 1 gets dead 2s (skip, no strikes
      // interference — TIMEOUT still strikes seat 1, but we watch seat 0).
      return rig.room.matchState?.currentSeat === 0 ? 6 : 2;
    };

    const isAutoForSeat0 = (payload: unknown): boolean => {
      const status = payload as PlayerStatusMessage;
      return status.seat === 0 && status.auto && status.connected;
    };
    // Wait for the playerStatus that announces AUTO for seat 0.
    for (;;) {
      const entry = await rig.c2.log.nextAny(6000);
      if (entry.type === 'playerStatus' && isAutoForSeat0(entry.payload)) break;
    }
    // The match must keep flowing without any client input.
    await rig.c2.log.next('moveResult');
    let seat0Auto = false;
    rig.room.state.players.forEach((player) => {
      if (player.seat === 0 && player.auto) seat0Auto = true;
    });
    expect(seat0Auto).toBe(true);
  });

  it('a manual roll exits AUTO and resets the strikes', async () => {
    const rig = await startedQuick2(colyseus, { turnTimerS: 0.15, autoRollDelayMs: 400, autoMoveDelayMs: 400 });
    rig.room.rollDie = () => (rig.room.matchState?.currentSeat === 0 ? 6 : 2);

    // Let seat 0 hit AUTO first.
    for (;;) {
      const entry = await rig.c1.log.nextAny(6000);
      if (entry.type === 'playerStatus') {
        const status = entry.payload as PlayerStatusMessage;
        if (status.seat === 0 && status.auto) break;
      }
    }
    // Wait for a fresh roll-phase turn of seat 0, then act manually before
    // the (slowed) AUTO scheduler does.
    for (;;) {
      const entry = await rig.c1.log.nextAny(6000);
      if (entry.type === 'turn') {
        const turn = entry.payload as TurnMessage;
        if (turn.seat === 0 && turn.phase === 'roll') break;
      }
    }
    rig.c1.room.send('roll', {});
    for (;;) {
      const entry = await rig.c1.log.nextAny(6000);
      if (entry.type === 'playerStatus') {
        const status = entry.payload as PlayerStatusMessage;
        if (status.seat === 0 && !status.auto) break;
      }
    }
    await until(() => (rig.room.matchState?.players[0]?.timeoutStrikes ?? 99) === 0);
  });
});
