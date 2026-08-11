import { en } from './en';
import { es } from './es';
import type { UiStrings } from './en';

export type I18nKey = keyof UiStrings;
export type Locale = 'en' | 'es';

const LOCALE_KEY = 'lr_locale';

let strings: UiStrings = en;
let locale: Locale = 'en';

/**
 * Boot: an explicit choice from Settings (localStorage) wins; everyone else
 * starts in English — the product default. To auto-detect the browser
 * language instead, seed from navigator.language here.
 */
export function initI18n(): void {
  const saved = (localStorage.getItem(LOCALE_KEY) ?? 'en').toLowerCase();
  applyLocale(saved.startsWith('es') ? 'es' : 'en');
}

export function currentLocale(): Locale {
  return locale;
}

/**
 * Manual switch from the overlay Settings panel. Persists the choice; the
 * DOM chrome re-renders immediately (store 'locale' event) and the overlay
 * restarts the Home scene so its canvas labels repaint too.
 */
export function setLocale(next: Locale): void {
  localStorage.setItem(LOCALE_KEY, next);
  applyLocale(next);
}

function applyLocale(next: Locale): void {
  locale = next;
  strings = next === 'es' ? es : en;
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let out: string = strings[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.replace(`{${name}}`, String(value));
    }
  }
  return out;
}

/**
 * Dynamic lookup for server-driven keys (mission codes, shop name_keys,
 * API error codes): returns the localized string when the key exists in the
 * bundle, the given fallback otherwise.
 */
export function tDyn(key: string, fallback: string): string {
  if (key in strings) return strings[key as I18nKey];
  return fallback;
}

/** Protocol error code (§6.5) → localized message; unknown codes fall back. */
export function errText(code: string, fallback?: string): string {
  const key = `err.${code}`;
  if (key in strings) return strings[key as I18nKey];
  return fallback ?? code;
}
