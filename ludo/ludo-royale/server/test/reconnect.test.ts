/**
 * Reconnection & forfeit (§6.6/§6.7): unexpected drop → 60s grace with AUTO
 * play, reconnect restores the seat, grace expiry forfeits it, and an
 * explicit forfeit ends a 2P match immediately.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { MatchEndMessage, PlayerStatusMessage } from '@ludo/shared';
import appConfig from '../src/app.config.js';
import { connectClient, MessageLog, startedQuick2, tuneFast, until } from './helpers.js';
import type { LudoRoom } from '../src/rooms/LudoRoom.js';

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

describe('LudoRoom reconnection and forfeit', () => {
  it('drop → playerStatus disconnected+auto; reconnect within grace restores the seat', async () => {
    const rig = await startedQuick2(colyseus, { graceS: 3 });
    rig.room.rollDie = () => 6;
    const token = rig.c1.room.reconnectionToken;

    // Unconsented leave simulates a network drop.
    await rig.c1.room.leave(false);
    for (;;) {
      const entry = await rig.c2.log.nextAny(6000);
      if (entry.type === 'playerStatus') {
        const status = entry.payload as PlayerStatusMessage;
        if (status.seat === 0 && !status.connected && status.auto) break;
      }
    }
    // The match never stalls: AUTO plays seat 0's pending turn (§6.6).
    await rig.c2.log.next('moveResult');

    const rejoined = await colyseus.sdk.reconnect(token);
    const rejoinedLog = new MessageLog(rejoined);
    for (;;) {
      const entry = await rig.c2.log.nextAny(6000);
      if (entry.type === 'playerStatus') {
        const status = entry.payload as PlayerStatusMessage;
        if (status.seat === 0 && status.connected && !status.auto) break;
      }
    }
    // The reconnected client gets a fresh `turn` to restore its HUD.
    await rejoinedLog.next('turn');
    expect(rejoined.sessionId).toBe(rig.c1.room.sessionId);
  });

  it('grace expiry forfeits the seat and ends a 2P match with the survivor first', async () => {
    const rig = await startedQuick2(colyseus, { graceS: 0.15 });
    await rig.c1.room.leave(false); // drop and never come back

    const end = (await rig.c2.log.next('matchEnd', 8000)) as MatchEndMessage;
    const first = end.ranking.find((r) => r.place === 1);
    const second = end.ranking.find((r) => r.place === 2);
    expect(first?.seat).toBe(1);
    expect(second?.seat).toBe(0);
    await until(() => rig.room.state.phase === 'finished');
  });

  it('explicit forfeit message retires the seat and ends the 2P match (§6.7)', async () => {
    const rig = await startedQuick2(colyseus);
    rig.c1.room.send('forfeit', {});
    const end = (await rig.c2.log.next('matchEnd')) as MatchEndMessage;
    const first = end.ranking.find((r) => r.place === 1);
    expect(first?.seat).toBe(1);

    // §6.7: the forfeited seat's pieces are retired to BASE.
    let seat0PiecesInBase = 0;
    rig.room.state.pieces.forEach((piece) => {
      if (piece.seat === 0 && piece.steps === -1) seat0PiecesInBase += 1;
    });
    expect(seat0PiecesInBase).toBe(4);
    let seat0Forfeited = false;
    rig.room.state.players.forEach((player) => {
      if (player.seat === 0) seat0Forfeited = player.forfeited;
    });
    expect(seat0Forfeited).toBe(true);
  });

  it('a lobby leave frees the seat with no forfeit and no grace (§6.6)', async () => {
    const room = (await colyseus.createRoom('quick', { size: 3 })) as unknown as LudoRoom;
    tuneFast(room);
    const c1 = await connectClient(colyseus, room, 'lobby-a1');
    await connectClient(colyseus, room, 'lobby-b2');
    expect(room.state.players.size).toBe(2);

    await c1.room.leave(true);
    await until(() => room.state.players.size === 1);
    // Remaining player was re-seated to 0 and became host.
    let seat = -1;
    room.state.players.forEach((player) => {
      seat = player.seat;
    });
    expect(seat).toBe(0);
  });
});
