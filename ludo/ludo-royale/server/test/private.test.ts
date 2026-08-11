/**
 * Private rooms (§6.1): 6-char A-Z2-9 code (= roomId), joinById, host-only
 * early start with 2+, host-only kicks, unknown code rejection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '@colyseus/testing';
import type { ColyseusTestServer } from '@colyseus/testing';
import { ERR } from '@ludo/shared';
import type { ErrMessage, TurnMessage } from '@ludo/shared';
import appConfig from '../src/app.config.js';
import { isWellFormedCode } from '../src/rooms/roomCode.js';
import { connectClient, identity, MessageLog, tuneFast, until } from './helpers.js';
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

async function createPrivate(size: 2 | 3 | 4 = 4): Promise<LudoRoom> {
  const room = (await colyseus.createRoom('private', { size })) as unknown as LudoRoom;
  tuneFast(room);
  return room;
}

describe('LudoRoom private rooms', () => {
  it('creates a room whose id is a 6-char unambiguous code', async () => {
    const room = await createPrivate();
    expect(room.roomId).toHaveLength(6);
    expect(isWellFormedCode(room.roomId)).toBe(true);
    expect(room.state.privateCode).toBe(room.roomId);
    expect(room.state.mode).toBe('private');
  });

  it('lets friends join by code (joinById) and rejects an unknown code', async () => {
    const room = await createPrivate();
    const host = await colyseus.sdk.joinById(room.roomId, identity('host0001'));
    expect(host.sessionId).toBeTruthy();
    await until(() => room.state.players.size === 1);

    await expect(colyseus.sdk.joinById('ZZZZ99', identity('lost0001'))).rejects.toThrow();
  });

  it('host starts with 2+ players; the match begins with numPlayers 2', async () => {
    const room = await createPrivate(4);
    const host = await connectClient(colyseus, room, 'host0002');
    const guest = await connectClient(colyseus, room, 'guest002');
    await until(() => room.state.players.size === 2);

    host.room.send('startMatch', {});
    const turn = (await guest.log.next('turn')) as TurnMessage;
    expect(turn.seat).toBe(0);
    expect(room.state.phase).toBe('playing');
    expect(room.state.numPlayers).toBe(2);
    expect(room.state.pieces.length).toBe(8);
  });

  it('rejects startMatch from a non-host and from a host alone', async () => {
    const room = await createPrivate(4);
    const host = await connectClient(colyseus, room, 'host0003');

    host.room.send('startMatch', {}); // alone — needs 2+
    const alone = (await host.log.next('err')) as ErrMessage;
    expect(alone.code).toBe(ERR.BAD_PHASE);

    const guest = await connectClient(colyseus, room, 'guest003');
    guest.room.send('startMatch', {}); // not the host
    const notHost = (await guest.log.next('err')) as ErrMessage;
    expect(notHost.code).toBe(ERR.BAD_PHASE);
    expect(room.state.phase).toBe('lobby');
  });

  it('host kicks a seat in LOBBY; the kicked client leaves and seats compact', async () => {
    const room = await createPrivate(4);
    const host = await connectClient(colyseus, room, 'host0004');
    const guest = await connectClient(colyseus, room, 'guest004');
    await until(() => room.state.players.size === 2);

    let kicked = false;
    guest.room.onLeave(() => {
      kicked = true;
    });
    host.room.send('kickPlayer', { seat: 1 });
    await until(() => kicked);
    await until(() => room.state.players.size === 1);
    expect(room.state.hostSessionId).toBe(host.room.sessionId);
  });

  it('a full private room auto-starts like a quick room', async () => {
    const room = await createPrivate(2);
    const host = await connectClient(colyseus, room, 'host0005');
    const guestRoom = await colyseus.sdk.joinById(room.roomId, identity('guest005'));
    const guestLog = new MessageLog(guestRoom);

    const turn = (await guestLog.next('turn')) as TurnMessage;
    expect(turn.phase).toBe('roll');
    expect(room.state.phase).toBe('playing');
    await host.log.next('turn'); // the host received the kickoff too
  });
});
