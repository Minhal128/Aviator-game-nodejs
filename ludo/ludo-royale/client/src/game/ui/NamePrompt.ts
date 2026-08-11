/**
 * One-time display-name prompt for online play (task: ask once, persist in
 * localStorage). A DOM overlay — §4.6 keeps forms/inputs out of the canvas —
 * with inline styles only, scoped by the .lr- prefix, no external CSS.
 */
import { LR_COLORS, cssColor } from '../../theme/tokens';
import { t } from '../../i18n';
import { getPlayerName, setPlayerName, MAX_NAME_LENGTH } from '../net/identity';

let promptOpen = false;

/** Resolves with the stored name, or asks for it once (never rejects). */
export function ensurePlayerName(): Promise<string> {
  const existing = getPlayerName();
  if (existing) return Promise.resolve(existing);
  if (promptOpen) return Promise.resolve(randomName());
  promptOpen = true;

  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'lr-name-scrim';
    applyStyle(scrim, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(12, 18, 48, 0.72)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '30',
    });

    const card = document.createElement('div');
    applyStyle(card, {
      background: cssColor(LR_COLORS.surface),
      borderRadius: '20px',
      padding: '28px 26px 24px',
      width: 'min(320px, 84vw)',
      boxShadow: '0 18px 50px rgba(12, 18, 48, 0.45)',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
    });

    const title = document.createElement('div');
    title.textContent = t('online.name_title');
    applyStyle(title, {
      color: cssColor(LR_COLORS.text),
      fontSize: '20px',
      fontWeight: '800',
      marginBottom: '6px',
    });

    const hint = document.createElement('div');
    hint.textContent = t('online.name_hint');
    applyStyle(hint, {
      color: cssColor(LR_COLORS.textMuted),
      fontSize: '13px',
      marginBottom: '16px',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = MAX_NAME_LENGTH;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = randomName();
    applyStyle(input, {
      width: '100%',
      boxSizing: 'border-box',
      padding: '12px 14px',
      fontSize: '17px',
      fontWeight: '700',
      color: cssColor(LR_COLORS.text),
      border: `2px solid ${cssColor(LR_COLORS.borderStrong)}`,
      borderRadius: '12px',
      outline: 'none',
      textAlign: 'center',
      marginBottom: '16px',
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('online.play');
    applyStyle(button, {
      width: '100%',
      padding: '13px 0',
      fontSize: '16px',
      fontWeight: '800',
      color: '#ffffff',
      background: cssColor(LR_COLORS.brand2),
      border: 'none',
      borderRadius: '14px',
      cursor: 'pointer',
    });

    const submit = (): void => {
      const clean = input.value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
      const name = clean !== '' ? clean : randomName();
      setPlayerName(name);
      promptOpen = false;
      scrim.remove();
      resolve(name);
    };
    button.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') submit();
    });

    card.append(title, hint, input, button);
    scrim.append(card);
    document.body.append(scrim);
    input.focus();
  });
}

function randomName(): string {
  return `Player${Math.floor(100 + Math.random() * 900)}`;
}

function applyStyle(el: HTMLElement, style: Record<string, string>): void {
  for (const [key, value] of Object.entries(style)) {
    el.style.setProperty(kebab(key), value);
  }
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}
