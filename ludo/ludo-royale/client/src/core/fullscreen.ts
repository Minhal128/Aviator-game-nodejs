/**
 * Fullscreen orchestration (UX sprint §1 — "es un videojuego, debe verse a
 * pantalla completa"):
 *  - `armAutoFullscreen()` — one-shot: on the FIRST user gesture after Home
 *    shows (a tap on any mode card counts), touch devices running in a
 *    browser tab get a requestFullscreen() attempt. Standalone/PWA installs
 *    are already fullscreen (manifest display) and are skipped.
 *  - `toggleFullscreen()` — the discreet ⛶ HUD button. The user's manual
 *    choice persists (localStorage `lr_fs_pref`): an explicit OFF disables
 *    future auto attempts.
 * iPhone Safari has no Fullscreen API — everything here feature-detects and
 * quietly no-ops there (the PWA install path covers that platform).
 */

const PREF_KEY = 'lr_fs_pref'; // 'on' | 'off' | unset (auto default)

let armed = false;

/** Installed PWA / fullscreen display-mode — no Fullscreen API needed. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** True when the toggle makes sense: API present and not already standalone. */
export function fullscreenAvailable(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function' && !isStandalone();
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

export async function enterFullscreen(): Promise<void> {
  if (!fullscreenAvailable() || isFullscreen()) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // Denied / no transient activation — the ⛶ button remains as the way in.
  }
}

/** HUD ⛶ toggle. Manual choices persist and steer the auto behavior. */
export async function toggleFullscreen(): Promise<void> {
  if (isFullscreen()) {
    writePref('off');
    try {
      await document.exitFullscreen();
    } catch {
      // Already out — nothing to do.
    }
    return;
  }
  writePref('on');
  await enterFullscreen();
}

/**
 * One-shot auto fullscreen on the first gesture (mobile browser tabs only).
 * Listens on window with capture so taps on the Phaser canvas AND the DOM
 * overlay both qualify; `once` guarantees a single attempt per page load.
 */
export function armAutoFullscreen(): void {
  if (armed) return;
  armed = true;
  if (!fullscreenAvailable()) return;
  const touch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!touch) return; // desktop: never hijack the window — the ⛶ button exists
  if (readPref() === 'off') return; // the user opted out before — respect it
  window.addEventListener(
    'pointerup',
    () => {
      void enterFullscreen();
    },
    { once: true, capture: true },
  );
}

function readPref(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

function writePref(value: 'on' | 'off'): void {
  try {
    localStorage.setItem(PREF_KEY, value);
  } catch {
    // Persistence is best-effort.
  }
}
