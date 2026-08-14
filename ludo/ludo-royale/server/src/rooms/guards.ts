/**
 * Untrusted-input guards + per-connection buckets (ARQUITECTURA §6.8).
 * Everything a client sends crosses one of these before touching the engine.
 */

// ---------------------------------------------------------------------------
// Per-client counters (kept on client.userData)
// ---------------------------------------------------------------------------

export interface ClientMeta {
  deviceId: string;
  /** Sliding 1s window for the global 10 msg/s cap (§6.8.4). */
  bucketStart: number;
  bucketCount: number;
  /** Emote rate limit: 1 per 4s (§6.5). */
  lastEmoteAt: number;
  /** Rejected actions this match; ≥5 → kick (§6.8.2). */
  illegal: number;
}

export function newMeta(deviceId: string): ClientMeta {
  return { deviceId, bucketStart: 0, bucketCount: 0, lastEmoteAt: 0, illegal: 0 };
}

export const MSGS_PER_SECOND = 10;
export const EMOTE_INTERVAL_MS = 4000;
export const MAX_ILLEGAL_ACTIONS = 5;

/** Counts one inbound message; false when the client exceeds the cap. */
export function allowMessage(meta: ClientMeta, now: number): boolean {
  if (now - meta.bucketStart >= 1000) {
    meta.bucketStart = now;
    meta.bucketCount = 0;
  }
  meta.bucketCount += 1;
  return meta.bucketCount <= MSGS_PER_SECOND;
}

export function allowEmote(meta: ClientMeta, now: number): boolean {
  if (now - meta.lastEmoteAt < EMOTE_INTERVAL_MS) return false;
  meta.lastEmoteAt = now;
  return true;
}

// ---------------------------------------------------------------------------
// Join options (guest identity, Sprint 2 — JWT replaces this in Sprint 3)
// ---------------------------------------------------------------------------

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Site wallet bind: `tl` + Laravel user id (may be shorter than 8). */
const SITE_DEVICE_ID_RE = /^tl\d{1,18}$/;
const MAX_NAME_LENGTH = 14;
/** ASCII symbols that could leak into markup or logs verbatim. */
const NAME_BANNED_ASCII = '<>&"' + "'" + '`' + String.fromCharCode(92);

export function readDeviceId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (SITE_DEVICE_ID_RE.test(raw)) return raw;
  return DEVICE_ID_RE.test(raw) ? raw : null;
}

/**
 * Display names are echoed to every other client. Allowlist per code point
 * (printable ASCII minus markup symbols, plus non-ASCII letters/emoji) —
 * deliberately written without character-class escapes.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let kept = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    const safe =
      code === 32 ||
      (code > 32 && code < 127 && !NAME_BANNED_ASCII.includes(ch)) ||
      code > 160;
    if (safe) kept += ch;
  }
  return kept.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export function readSize(raw: unknown): 2 | 3 | 4 | null {
  return raw === 2 || raw === 3 || raw === 4 ? raw : null;
}

/** Optional lr_room_tiers.id in the join options (Sprint 3b entry fees). */
export function readTierId(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

// ---------------------------------------------------------------------------
// Message payloads (§6.5 C→S)
// ---------------------------------------------------------------------------

export function readPieceId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const pieceId = (payload as Record<string, unknown>)['pieceId'];
  return typeof pieceId === 'number' && Number.isInteger(pieceId) && pieceId >= 0 && pieceId <= 3
    ? pieceId
    : null;
}

export function readEmoteId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const emoteId = (payload as Record<string, unknown>)['emoteId'];
  if (typeof emoteId !== 'number' || !Number.isInteger(emoteId)) return null;
  // 0-7 emoji wheel · 100-105 quick-chat · 200-215 taunts (200 + t*4 + seat).
  return (emoteId >= 0 && emoteId <= 7) ||
    (emoteId >= 100 && emoteId <= 105) ||
    (emoteId >= 200 && emoteId <= 215)
    ? emoteId
    : null;
}

export function readSeat(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const seat = (payload as Record<string, unknown>)['seat'];
  return typeof seat === 'number' && Number.isInteger(seat) && seat >= 0 && seat <= 3 ? seat : null;
}
