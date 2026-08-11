/**
 * Test rig for LudoRoom: boots the REAL app.config through @colyseus/testing,
 * shrinks every timer via the instance-level `tuning` (no env backdoors a
 * real client could reach), and scripts dice through the injected `rollDie`.
 */
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import { PROTOCOL_VERSION } from '@ludo/shared';
import type { DiceMessage, MatchEndMessage, TurnMessage } from '@ludo/shared';
import type { LudoRoom, RoomTuning } from '../src/rooms/LudoRoom.js';

// ---------------------------------------------------------------------------
// Message recorder (client side)
// ---------------------------------------------------------------------------

export interface Recorded {
  type: string;
  payload: unknown;
}

/**
 * Records every server message of a client room. `next*` reads are
 * destructive FIFO (tests assert sequences); `history` keeps everything for
 * "never received X" style assertions.
 */
export class MessageLog {
  readonly history: Recorded[] = [];
  private readonly queue: Recorded[] = [];
  private waiter: ((r: Recorded) => void) | null = null;

  constructor(room: ClientRoom) {
    room.onMessage('*', (type, payload) => {
      const entry: Recorded = { type: String(type), payload };
      this.history.push(entry);
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(entry);
      } else {
        this.queue.push(entry);
      }
    });
  }

  async nextAny(timeoutMs = 4000): Promise<Recorded> {
    const queued = this.queue.shift();
    if (queued) return queued;
    return new Promise<Recorded>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`timed out after ${timeoutMs}ms waiting for a message`));
      }, timeoutMs);
      this.waiter = (entry) => {
        clearTimeout(timer);
        resolve(entry);
      };
    });
  }

  /** Pops messages until `type` shows up (earlier ones are discarded). */
  async next(type: string, timeoutMs = 4000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for "${type}"`);
      const entry = await this.nextAny(remaining);
      if (entry.type === type) return entry.payload;
    }
  }

  received(type: string): boolean {
    return this.history.some((entry) => entry.type === type);
  }
}

// ---------------------------------------------------------------------------
// Room + client setup
// ---------------------------------------------------------------------------

export interface TestClient {
  room: ClientRoom;
  log: MessageLog;
}

export function identity(tag: string): { protocolVersion: number; deviceId: string; name: string } {
  return { protocolVersion: PROTOCOL_VERSION, deviceId: `test-device-${tag}`, name: `P_${tag}` };
}

/** Millisecond-scale timers so the suite runs in seconds, not minutes. */
export function tuneFast(room: LudoRoom, overrides: Partial<RoomTuning> = {}): void {
  Object.assign(room.tuning, {
    turnTimerS: 2,
    countdownS: 0.05,
    graceS: 1,
    autoRollDelayMs: 20,
    autoMoveDelayMs: 20,
    disposeAfterEndMs: 5000,
    maxStrikes: 2,
  } satisfies RoomTuning, overrides);
}

/** FIFO dice script; `fallback` feeds rolls beyond the script. */
export function scriptDice(room: LudoRoom, values: number[], fallback = 2): void {
  const queue = [...values];
  room.rollDie = () => queue.shift() ?? fallback;
}

export async function connectClient(
  colyseus: ColyseusTestServer,
  room: LudoRoom,
  tag: string,
): Promise<TestClient> {
  const clientRoom = await colyseus.connectTo(room, identity(tag));
  return { room: clientRoom, log: new MessageLog(clientRoom) };
}

export interface Quick2 {
  room: LudoRoom;
  c1: TestClient;
  c2: TestClient;
}

/** Creates a tuned 2P quick room and connects both clients (still in lobby-countdown). */
export async function quick2(
  colyseus: ColyseusTestServer,
  overrides: Partial<RoomTuning> = {},
): Promise<Quick2> {
  const room = (await colyseus.createRoom('quick', { size: 2 })) as unknown as LudoRoom;
  tuneFast(room, overrides);
  const c1 = await connectClient(colyseus, room, 'aaa1');
  const c2 = await connectClient(colyseus, room, 'bbb2');
  return { room, c1, c2 };
}

/** quick2 + waits until the match is PLAYING (first `turn` seen by both). */
export async function startedQuick2(
  colyseus: ColyseusTestServer,
  overrides: Partial<RoomTuning> = {},
): Promise<Quick2> {
  const rig = await quick2(colyseus, overrides);
  await rig.c1.log.next('turn');
  await rig.c2.log.next('turn');
  return rig;
}

export async function until(
  check: () => boolean,
  timeoutMs = 4000,
  stepMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('until(): condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

// ---------------------------------------------------------------------------
// Full-match driver
// ---------------------------------------------------------------------------

/**
 * Plays a live 2P match to completion by reacting to broadcasts: on `turn`
 * (roll phase) the seat's client rolls; on `dice` with legal moves it plays
 * the first legal piece. The room's `rollDie` decides how long it takes.
 */
export async function playUntilEnd(rig: Quick2, maxMessages = 6000): Promise<MatchEndMessage> {
  const roomOfSeat: Record<number, ClientRoom> = { 0: rig.c1.room, 1: rig.c2.room };
  for (let i = 0; i < maxMessages; i++) {
    const entry = await rig.c1.log.nextAny(6000);
    if (entry.type === 'matchEnd') return entry.payload as MatchEndMessage;
    if (entry.type === 'turn') {
      const turn = entry.payload as TurnMessage;
      if (turn.phase === 'roll') roomOfSeat[turn.seat]?.send('roll', {});
    } else if (entry.type === 'dice') {
      const dice = entry.payload as DiceMessage;
      const pieceId = dice.legalPieceIds[0];
      if (pieceId !== undefined) roomOfSeat[dice.seat]?.send('move', { pieceId });
    }
  }
  throw new Error('match did not finish within the message budget');
}
