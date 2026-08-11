/**
 * ACCOUNT panel — email registration & login (Jose: "los usuarios deben
 * crear su cuenta para seguir leveando su mascota").
 *
 * Guest-first flow: everyone starts as a device guest; "Create account"
 * UPGRADES the current guest in place (same lr_users row → level, pet,
 * coins, inventory all survive). "Log in" swaps this device onto an
 * existing account (the server issues a fresh token pair; the page reloads
 * so every panel re-reads the new profile). Social sign-in (Google) is the
 * v1.1 slot — email ships first, like most big games do at minimum.
 */
import { errText, t } from '../../i18n';
import { api, MetaApiError } from '../api';
import { metaState, refreshProfile } from '../store';
import { button, el, openPanel, toast } from '../ui';

export function openAccountPanel(): void {
  openPanel(t('account.title'), ({ body }) => {
    const isGuest = metaState.profile?.user.isGuest ?? true;
    if (!isGuest) {
      renderLoggedIn(body);
    } else {
      renderRegister(body);
    }
  });
}

function input(placeholder: string, type: 'email' | 'password' = 'email'): HTMLInputElement {
  const i = el('input', 'lr-input') as HTMLInputElement;
  i.type = type;
  i.placeholder = placeholder;
  i.autocomplete = type === 'email' ? 'email' : 'new-password';
  i.maxLength = 190;
  return i;
}

// ---------------------------------------------------------------------------

function renderRegister(body: HTMLElement): void {
  body.replaceChildren();
  body.append(el('p', 'lr-invite__body', t('account.intro')));

  const email = input(t('account.email'));
  const pass = input(t('account.password'), 'password');
  const pass2 = input(t('account.password2'), 'password');
  body.append(email, pass, pass2);

  const submit = button('lr-btn lr-btn--collect lr-install__cta', t('account.create'), () => {
    const e = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      toast(t('account.bad_email'));
      return;
    }
    if (pass.value.length < 8) {
      toast(t('account.short_password'));
      return;
    }
    if (pass.value !== pass2.value) {
      toast(t('account.mismatch'));
      return;
    }
    submit.disabled = true;
    void api
      .register(e, pass.value)
      .then(async () => {
        await refreshProfile().catch(() => null);
        toast(t('account.created'));
        renderLoggedIn(body);
      })
      .catch((err: unknown) => {
        toast(describeError(err));
        submit.disabled = false;
      });
  });
  body.append(submit);

  const toLogin = button('lr-btn lr-btn--price lr-install__cta', t('account.have_account'), () =>
    renderLogin(body),
  );
  body.append(toLogin);
  body.append(el('p', 'lr-muted lr-center lr-setting-note', t('account.social_soon')));
}

function renderLogin(body: HTMLElement): void {
  body.replaceChildren();
  body.append(el('p', 'lr-invite__body', t('account.login_intro')));

  const email = input(t('account.email'));
  const pass = input(t('account.password'), 'password');
  pass.autocomplete = 'current-password';
  body.append(email, pass);

  const submit = button('lr-btn lr-btn--collect lr-install__cta', t('account.login'), () => {
    submit.disabled = true;
    void api
      .login(email.value.trim(), pass.value)
      .then(() => {
        toast(t('account.logged_in'));
        // Full reload: every panel/HUD re-reads the account's profile.
        window.setTimeout(() => window.location.reload(), 700);
      })
      .catch((err: unknown) => {
        toast(describeError(err));
        submit.disabled = false;
      });
  });
  body.append(submit);

  const back = button('lr-btn lr-btn--price lr-install__cta', t('account.back_register'), () =>
    renderRegister(body),
  );
  body.append(back);
}

function renderLoggedIn(body: HTMLElement): void {
  body.replaceChildren();
  const email = metaState.profile?.user.email ?? '';
  body.append(el('p', 'lr-invite__body', `✅ ${t('account.logged_as')}`));
  body.append(el('div', 'lr-invite__code', email || t('account.title')));
  body.append(el('p', 'lr-muted lr-center', t('account.synced_note')));

  // Two-tap logout (arm + confirm, like the shop's buy button).
  let armed = false;
  let timer = 0;
  const logout = button('lr-btn lr-btn--price lr-install__cta', t('account.logout'), () => {
    if (!armed) {
      armed = true;
      logout.textContent = t('account.logout_confirm');
      timer = window.setTimeout(() => {
        armed = false;
        logout.textContent = t('account.logout');
      }, 2600);
      return;
    }
    window.clearTimeout(timer);
    logout.disabled = true;
    void api.logoutAccount().finally(() => window.location.reload());
  });
  body.append(logout);
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
