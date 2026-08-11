/**
 * Haptic micro-feedback (UX sprint §4) — short 10–20ms buzzes on the game's
 * physical beats: button taps, the dice landing, captures and victory.
 * Guards: the global reduced-motion preference (vestibular pref covers
 * haptics too), API support (iOS Safari has no navigator.vibrate) and a
 * try/catch because some engines throw outside a user gesture. Always safe
 * to call — it degrades to a no-op.
 */
import { LR_RUNTIME } from '../theme/tokens';

export type HapticKind = 'tap' | 'dice' | 'capture' | 'win';

const PATTERN: Readonly<Record<HapticKind, number | readonly number[]>> = {
  tap: 10,
  dice: 15,
  capture: 20,
  win: [20, 40, 20],
};

export function haptic(kind: HapticKind): void {
  if (LR_RUNTIME.reducedMotion) return;
  if (typeof navigator.vibrate !== 'function') return;
  const pattern = PATTERN[kind];
  try {
    navigator.vibrate(Array.isArray(pattern) ? [...pattern] : (pattern as number));
  } catch {
    // Vibration is best-effort decoration — never let it break input flow.
  }
}
