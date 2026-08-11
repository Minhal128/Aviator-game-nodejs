/**
 * PWA install shortcut (Jose: "acceso directo como app, sin navegador").
 * Android/desktop Chromium fire `beforeinstallprompt` — we stash the event
 * and call prompt() when the player taps Install, so the game lands on the
 * home screen and opens FULLSCREEN (manifest display + portrait lock, no
 * browser chrome). iOS Safari has NO programmatic prompt, so the same
 * button opens a 3-step Add-to-Home-Screen guide instead. The button hides
 * once the game already runs standalone (installed).
 */
import { t } from '../i18n';
import { el, openPanel } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Call ASAP at boot — the browser fires the event before the overlay mounts. */
export function initInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Already running as an installed app (standalone/fullscreen display). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports MacIntel + touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Whether the install shortcut should show at all. */
export function installAvailable(): boolean {
  return !isStandalone();
}

/** Re-render hook for buttons (fires on beforeinstallprompt/appinstalled). */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * Install tap: native prompt when the browser offered one, the A2HS guide
 * otherwise (always on iOS). Returns what happened for callers that care.
 */
export async function requestInstall(): Promise<'prompted' | 'guide'> {
  if (deferred) {
    const ev = deferred;
    try {
      await ev.prompt();
    } catch {
      // Chrome rejects prompt() without a fresh user gesture (or when the
      // stashed event was already consumed) — fall back to the guide.
      openInstallGuide();
      return 'guide';
    }
    const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (choice.outcome === 'accepted') deferred = null;
    notify();
    return 'prompted';
  }
  openInstallGuide();
  return 'guide';
}

/** Manual Add-to-Home-Screen guide (iOS Safari / browsers without prompt). */
function openInstallGuide(): void {
  openPanel(t('install.title'), ({ body }) => {
    body.append(el('p', 'lr-invite__body', t('install.intro')));
    const steps = isIos()
      ? [t('install.ios_step1'), t('install.ios_step2'), t('install.ios_step3')]
      : [t('install.generic_step1'), t('install.generic_step2'), t('install.ios_step3')];
    const list = el('div', 'lr-install__steps');
    steps.forEach((text, i) => {
      const row = el('div', 'lr-install__step');
      row.append(el('span', 'lr-install__num', String(i + 1)));
      row.append(el('span', 'lr-install__text', text));
      list.append(row);
    });
    body.append(list);
    body.append(el('p', 'lr-muted lr-center', t('install.note')));
  });
}
