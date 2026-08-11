/**
 * Anti-cheat (§6.8): the client only sends intents; everything else is
 * rejected with a §6.5 err code — wrong turn, wrong phase, illegal or
 * malformed moves, emote flooding, duplicate identities, repeat offenders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import { ERR } from '@ludo/shared';
import type { ErrMessage } from '@ludo/shared';
import appConfig from '../src/app.config.js';
import { connectClient, identity, quick2, scriptDice, startedQuick2, until } from './helpers.js';
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

describe('LudoRoom anti-cheat', () => {
  it('rejects a roll out of turn with ERR_NOT_YOUR_TURN', async () => {
    const rig = await startedQuick2(colyseus);
    rig.c2.room.send('roll', {}); // seat 1 rolls on seat 0's turn
    const err = (await rig.c2.log.next('err')) as ErrMessage;
    expect(err.code).toBe(ERR.NOT_YOUR_TURN);
  });

  it('rejects a second roll in the move sub-phase with ERR_BAD_PHASE', async () => {
    const rig = await startedQuick2(colyseus);
    scriptDice(rig.room, [6]);
    rig.c1.room.send('roll', {});
    await rig.c1.log.next('dice');
    rig.c1.room.send('roll', {});
    const err = (await rig.c1.log.next('err')) as ErrMessage;
    expect(err.code).toBe(ERR.BAD_PHASE);
  });

  it('rejects an illegal move (piece that cannot play) with ERR_ILLEGAL_MOVE', async () => {
    const rig = await startedQuick2(colyseus);
    scriptDice(rig.room, [6]);
    rig.c1.room.send('roll', {});
    await rig.c1.log.next('dice');
    // Malformed pieceId — out of the 0-3 contract.
    rig.c1.room.send('move', { pieceId: 7 });
    const err = (await rig.c1.log.next('err')) as ErrMessage;
    expect(err.code).toBe(ERR.ILLEGAL_MOVE);
  });

  it('rejects a malformed move payload with ERR_ILLEGAL_MOVE', async () => {
    const rig = await startedQuick2(colyseus);
    rig.c1.room.send('move', { pieceId: 'zero' });
    const err = (await rig.c1.log.next('err')) as ErrMessage;
    expect(err.code).toBe(ERR.ILLEGAL_MOVE);
  });

  it('rate limits emotes to one every 4 seconds', async () => {
    const rig = await startedQuick2(colyseus);
    rig.c1.room.send('emote', { emoteId: 0 });
    const shown = (await rig.c2.log.next('emoteShown')) as { seat: number; emoteId: number };
    expect(shown.seat).toBe(0);
    expect(shown.emoteId).toBe(0);

    rig.c1.room.send('emote', { emoteId: 1 });
    const err = (await rig.c1.log.next('err')) as ErrMessage;
    expect(err.code).toBe(ERR.RATE_LIMIT);
  });

  it('rejects the same deviceId joining one room twice (ERR_ALREADY_IN_MATCH)', async () => {
    const room = (await colyseus.createRoom('quick', { size: 3 })) as unknown as LudoRoom;
    await connectClient(colyseus, room, 'dupdupdup');
    await expect(colyseus.connectTo(room, identity('dupdupdup'))).rejects.toThrowError(
      /ALREADY_IN_MATCH/,
    );
  });

  it('kicks a client after 5 rejected actions', async () => {
    const rig = await startedQuick2(colyseus);
    let closed = false;
    rig.c2.room.onLeave(() => {
      closed = true;
    });
    for (let i = 0; i < 5; i++) {
      rig.c2.room.send('roll', {}); // never seat 1's turn
      await rig.c2.log.next('err');
    }
    await until(() => closed);
    expect(closed).toBe(true);
  });

  it('quick matchmaking groups by size (filterBy) and a full room takes no more joins', async () => {
    const rig = await quick2(colyseus);
    await rig.c1.log.next('turn'); // room is full and playing
    await expect(colyseus.connectTo(rig.room, identity('latecomer'))).rejects.toThrow();
  });
});
