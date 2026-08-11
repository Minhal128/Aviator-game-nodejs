/**
 * Meta store — the §4.6 pub/sub bridge between the API layer, the DOM
 * overlay chrome and (read-only) the Phaser scenes. Deliberately tiny:
 * a typed event emitter plus the shared snapshot the HUD renders from.
 */
import { api } from './api';
import type { ProfileResponse } from './api';

export type MetaEvent =
  | 'profile' // profile/balances snapshot changed
  | 'unread' // unread-mail badge count changed
  | 'wheel' // wheel spins-left badge changed
  | 'missions' // claimable-missions badge changed
  | 'equipment' // equipped skins changed (backpack equip/unequip)
  | 'locale'; // language switched — chrome re-renders

type Listener = () => void;

export interface MetaState {
  profile: ProfileResponse | null;
  unreadMail: number;
  /** null = wheel endpoint unavailable (feature flag off / not deployed). */
  wheelSpins: number | null;
  missionsClaimable: number;
  /** asset_key of the equipped dice_skin ('classic' = none equipped). */
  diceSkin: string;
  /** asset_key of the equipped token_skin (pawn cosmetic). */
  tokenSkin: string;
  /** asset_key of the equipped board_theme. */
  boardTheme: string;
  /** asset_key of the equipped bubble_skin (chat bubble palette). */
  bubbleSkin: string;
}

const listeners = new Map<MetaEvent, Set<Listener>>();

export const metaState: MetaState = {
  profile: null,
  unreadMail: 0,
  wheelSpins: null,
  missionsClaimable: 0,
  diceSkin: 'classic',
  tokenSkin: 'classic',
  boardTheme: 'classic',
  bubbleSkin: 'classic',
};

export function on(event: MetaEvent, fn: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

export function emit(event: MetaEvent): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) fn();
}

/** Pull a fresh profile snapshot; resolves with the previous one (for diffs). */
export async function refreshProfile(): Promise<ProfileResponse | null> {
  const previous = metaState.profile;
  metaState.profile = await api.getProfile();
  emit('profile');
  return previous;
}

/**
 * Sync the equipped-skins snapshot from the inventory (boot + after every
 * equip/unequip/purchase). Network failures keep the previous value — a
 * stale skin beats flashing back to classic mid-session.
 */
export async function refreshEquipment(): Promise<void> {
  try {
    const { items } = await api.getInventory();
    const equippedOf = (cat: string): string =>
      items.find((i) => i.category === cat && i.isEquipped)?.assetKey ?? 'classic';
    metaState.diceSkin = equippedOf('dice_skin');
    metaState.tokenSkin = equippedOf('token_skin');
    metaState.boardTheme = equippedOf('board_theme');
    metaState.bubbleSkin = equippedOf('bubble_skin');
    emit('equipment');
  } catch {
    // keep last known equipment
  }
}

/** Direct balance write for endpoints that return balances (wheel spin). */
export function setBalances(coins: number, gems: number): void {
  const p = metaState.profile;
  if (!p) return;
  p.wallet.coins = coins;
  p.wallet.gems = gems;
  p.user.coins = coins;
  p.user.gems = gems;
  emit('profile');
}

/** Apply a single-currency delta locally (claim results carry only deltas). */
export function bumpBalance(currency: 'coins' | 'gems', delta: number): void {
  const p = metaState.profile;
  if (!p) return;
  p.wallet[currency] += delta;
  p.user[currency] += delta;
  emit('profile');
}

export function setUnreadMail(n: number): void {
  if (metaState.unreadMail === n) return;
  metaState.unreadMail = n;
  emit('unread');
}

export function setWheelSpins(n: number | null): void {
  if (metaState.wheelSpins === n) return;
  metaState.wheelSpins = n;
  emit('wheel');
}

export function setMissionsClaimable(n: number): void {
  if (metaState.missionsClaimable === n) return;
  metaState.missionsClaimable = n;
  emit('missions');
}
