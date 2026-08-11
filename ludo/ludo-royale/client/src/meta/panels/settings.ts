/**
 * SETTINGS panel — professional rows (Jose pass 2): Account (register /
 * login so the pet, level and wallet survive the device), Mail shortcut,
 * a real language <select>, iOS-style toggle SWITCHES for music & sound
 * effects (core/audio synthesizes both), the PWA install row and the
 * display name. Each row is label-left / control-right.
 */
import { isMuted, isMusicOn, setMuted, setMusicOn, sfx } from '../../core/audio';
import { currentLocale, setLocale, t } from '../../i18n';
import type { Locale } from '../../i18n';
import { MAX_NAME_LENGTH, getPlayerName, setPlayerName } from '../../game/net/identity';
import { emit, metaState } from '../store';
import { button, el, openPanel, toast } from '../ui';
import { openMailPanel } from './mail';
import { openAccountPanel } from './account';
import { installAvailable, requestInstall } from '../install';

/** label-left / control-right row. */
function row(label: string, control: HTMLElement): HTMLElement {
  const r = el('div', 'lr-setting-row');
  r.append(el('span', 'lr-setting-row__label', label), control);
  return r;
}

/** iOS-style toggle switch. */
function switchEl(checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const label = el('label', 'lr-switch');
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  const slider = el('span', 'lr-switch__slider');
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, slider);
  return label;
}

export function openSettingsPanel(): void {
  openPanel(t('settings.title'), ({ body, close }) => {
    // -- cuenta (progreso permanente) -----------------------------------------
    const isGuest = metaState.profile?.user.isGuest ?? true;
    const accountBtn = button(
      'lr-btn lr-btn--collect lr-install__cta',
      isGuest ? `\u{1F464} ${t('account.create_cta')}` : `\u{1F464} ${t('account.my_account')}`,
      () => {
        close();
        openAccountPanel();
      },
    );
    body.append(accountBtn);
    if (isGuest) {
      body.append(el('p', 'lr-muted lr-center lr-setting-note', t('account.guest_warn')));
    }

    // -- correo -----------------------------------------------------------------
    const unread = metaState.unreadMail;
    const mailBtn = button(
      'lr-btn lr-btn--price lr-install__cta',
      `\u{1F4EC} ${t('settings.open_mail')}${unread > 0 ? ` (${unread})` : ''}`,
      () => {
        close();
        openMailPanel();
      },
    );
    body.append(mailBtn);

    // -- preferencias -------------------------------------------------------------
    body.append(el('h3', 'lr-section-title', t('settings.preferences')));

    const select = el('select', 'lr-select') as HTMLSelectElement;
    const langs: ReadonlyArray<{ id: Locale; label: string }> = [
      { id: 'en', label: 'English' },
      { id: 'es', label: 'Español' },
    ];
    for (const lang of langs) {
      const opt = el('option') as HTMLOptionElement;
      opt.value = lang.id;
      opt.textContent = lang.label;
      if (currentLocale() === lang.id) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      setLocale(select.value as Locale);
      emit('locale');
      close();
      openSettingsPanel();
    });
    body.append(row(t('settings.language'), select));

    body.append(row(t('settings.music'), switchEl(isMusicOn(), (on) => setMusicOn(on))));
    body.append(
      row(
        t('settings.sfx'),
        switchEl(!isMuted(), (on) => {
          setMuted(!on);
          if (on) sfx('hop'); // instant feedback
        }),
      ),
    );

    // -- instalar como app (PWA) ---------------------------------------------
    if (installAvailable()) {
      body.append(el('h3', 'lr-section-title', t('install.title')));
      body.append(
        button('lr-btn lr-btn--collect lr-install__cta', `\u{1F4F2} ${t('settings.install')}`, () => {
          close();
          void requestInstall();
        }),
      );
      body.append(el('p', 'lr-muted lr-center', t('install.intro')));
    }

    // -- display name ----------------------------------------------------------
    body.append(el('h3', 'lr-section-title', t('settings.name')));
    const nameInput = el('input', 'lr-input') as HTMLInputElement;
    nameInput.type = 'text';
    nameInput.maxLength = MAX_NAME_LENGTH;
    nameInput.value = getPlayerName() ?? '';
    nameInput.autocomplete = 'off';
    body.append(nameInput);
    body.append(el('p', 'lr-muted lr-center', t('settings.name_note')));

    const save = button('lr-btn lr-btn--collect', t('settings.save'), () => {
      const value = nameInput.value.trim();
      if (value === '') return;
      setPlayerName(value);
      toast(t('settings.saved'));
    });
    body.append(save);
  });
}
