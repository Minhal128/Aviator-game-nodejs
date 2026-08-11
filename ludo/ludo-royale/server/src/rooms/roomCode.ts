/**
 * Private-room join codes (ARQUITECTURA §6.1): 6 chars from A-Z2-9 minus the
 * ambiguous 0/O/1/I, generated server-side, unique across live rooms via a
 * presence set (official custom-room-id recipe). The code IS the roomId, so
 * clients join with a plain `joinById(code)` — no extra lookup service.
 */
import { randomInt } from 'node:crypto';
import type { Presence } from 'colyseus';

/** 32 unambiguous symbols → 32^6 ≈ 1.07e9 combinations. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const CODE_CHANNEL = 'lr:private:codes';

export function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET.charAt(randomInt(0, CODE_ALPHABET.length));
  }
  return code;
}

export function isWellFormedCode(raw: string): boolean {
  if (raw.length !== CODE_LENGTH) return false;
  for (const ch of raw) {
    if (!CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Generate + register a unique code. Caller must release it on dispose. */
export async function claimRoomCode(presence: Presence): Promise<string> {
  const taken = await presence.smembers(CODE_CHANNEL);
  let code: string;
  do {
    code = randomCode();
  } while (taken.includes(code));
  await presence.sadd(CODE_CHANNEL, code);
  return code;
}

export async function releaseRoomCode(presence: Presence, code: string): Promise<void> {
  await presence.srem(CODE_CHANNEL, code);
}
