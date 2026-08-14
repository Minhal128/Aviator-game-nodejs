/**
 * Guest identity (Sprint 2, ARQUITECTURA §6.2 note): a stable per-device id
 * plus a display name chosen once — both in localStorage. Sprint 3 upgrades
 * this to real accounts (guest-first + JWT) without breaking either key.
 *
 * On Turbo Legends, TL_WALLET.userId forces deviceId `tl{id}` so the Ludo
 * account is the same as the site wallet user (1 coin = ₹1).
 */

const DEVICE_KEY = 'lr_device_id';
const NAME_KEY = 'lr_player_name';
export const MAX_NAME_LENGTH = 14;

function fallbackId(): string {
  // crypto.randomUUID needs a secure context; WebViews occasionally lack it.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += (b % 36).toString(36);
  return `lr-${id}`;
}

function siteDeviceId(): string | null {
  const w = (window as unknown as { TL_WALLET?: { userId?: number } }).TL_WALLET;
  const uid = w && typeof w.userId === 'number' ? w.userId : 0;
  return uid > 0 ? `tl${uid}` : null;
}

export function deviceId(): string {
  const site = siteDeviceId();
  if (site) {
    localStorage.setItem(DEVICE_KEY, site);
    return site;
  }
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : fallbackId();
  localStorage.setItem(DEVICE_KEY, fresh);
  return fresh;
}

export function getPlayerName(): string | null {
  const stored = localStorage.getItem(NAME_KEY);
  return stored && stored.trim() !== '' ? stored : null;
}

export function setPlayerName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, MAX_NAME_LENGTH));
}
