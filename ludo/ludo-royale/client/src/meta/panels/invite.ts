/**
 * INVITE / FRIENDS panel — the referral code from the profile (server
 * generates one per user) with copy-to-clipboard, the Ludo-World "5,000
 * coins" incentive copy (cosmetic in v1 — the real referral grant flows
 * through the v1.1 `referrals` feature flag + /referral endpoints), and the
 * friends-arrive-in-v1.1 note. Serves BOTH the nav Friends and Invite slots.
 */
import { t } from '../../i18n';
import { metaState } from '../store';
import { button, el, openPanel, pulse } from '../ui';

export function openInvitePanel(): void {
  openPanel(t('invite.title'), ({ body }) => {
    body.append(el('p', 'lr-invite__body', t('invite.body')));

    const code = metaState.profile?.user.referralCode ?? '—';
    body.append(el('p', 'lr-muted lr-center', t('invite.your_code')));
    const codeBox = el('div', 'lr-invite__code', code);
    body.append(codeBox);

    const copy = button('lr-btn lr-btn--collect', t('invite.copy'), () => {
      void copyText(code).then((ok) => {
        if (ok) {
          copy.textContent = t('invite.copied');
          pulse(codeBox);
          window.setTimeout(() => {
            copy.textContent = t('invite.copy');
          }, 1800);
        }
      });
    });
    body.append(copy);

    body.append(el('p', 'lr-muted lr-center lr-invite__note', t('invite.friends_note')));
  });
}

/** navigator.clipboard first; hidden-textarea execCommand as WebView fallback. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
