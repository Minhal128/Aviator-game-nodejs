/**
 * MAIL panel (STYLE-GUIDE §6-G) — real inbox from GET /mail with cursor
 * pagination. Tapping a row expands the body and marks it read (unread dot
 * fades, HUD badge recounts); rows with attachments show a Claim chip →
 * POST /mail/:id/claim flies the reward to the HUD. Broadcast mails are
 * materialized lazily server-side on every inbox open.
 */
import { errText, t } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { MailEntry } from '../api';
import { formatCompact } from '../format';
import { bumpBalance, metaState, refreshProfile, setUnreadMail } from '../store';
import { button, el, flyReward, openPanel, textureImg, toast } from '../ui';

export function openMailPanel(): void {
  openPanel(t('mail.title'), ({ body }) => {
    body.append(el('p', 'lr-muted lr-center', t('common.loading')));
    void api
      .getMail()
      .then((page) => {
        body.replaceChildren();
        const list = el('div', 'lr-list');
        body.append(list);
        renderPage(list, body, page.entries, page.nextCursor);
        recountUnread(page.entries);
      })
      .catch((err: unknown) => {
        body.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
      });
  });
}

function renderPage(
  list: HTMLElement,
  body: HTMLElement,
  entries: MailEntry[],
  nextCursor: number | null,
): void {
  if (entries.length === 0 && list.childElementCount === 0) {
    list.append(el('p', 'lr-muted lr-center', t('mail.empty')));
    return;
  }
  for (const entry of entries) list.append(buildRow(entry));

  if (nextCursor !== null) {
    const more = button('lr-btn lr-btn--ghost', t('mail.load_more'), () => {
      more.disabled = true;
      void api
        .getMail(nextCursor)
        .then((page) => {
          more.remove();
          renderPage(list, body, page.entries, page.nextCursor);
        })
        .catch(() => {
          more.disabled = false;
        });
    });
    body.append(more);
  }
}

function buildRow(entry: MailEntry): HTMLElement {
  const row = el('div', `lr-mail__row${entry.read ? '' : ' lr-mail__row--unread'}`);

  const head = el('div', 'lr-mail__head');
  const dot = el('span', 'lr-dot lr-mail__dot');
  if (entry.read) dot.classList.add('lr-dot--hidden');
  head.append(dot, el('span', 'lr-mail__title', entry.title));
  const bodyText = el('p', 'lr-mail__body lr-mail__body--collapsed', entry.body);
  row.append(head, bodyText);

  head.addEventListener('click', () => {
    bodyText.classList.toggle('lr-mail__body--collapsed');
    if (!entry.read) {
      entry.read = true;
      dot.classList.add('lr-dot--hidden');
      row.classList.remove('lr-mail__row--unread');
      setUnreadMail(Math.max(0, metaState.unreadMail - 1));
      void api.markMailRead(entry.id).catch(() => undefined);
    }
  });

  if (entry.attachmentType !== 'none') {
    const foot = el('div', 'lr-mail__foot');
    const isCurrency = entry.attachmentType === 'coins' || entry.attachmentType === 'gems';
    if (isCurrency && entry.attachmentAmount !== null) {
      const chip = el('span', 'lr-mail__attachment');
      chip.append(
        textureImg(
          entry.attachmentType === 'gems' ? 'gem_violet' : 'coin_gold',
          'lr-chip-art',
          entry.attachmentType === 'gems' ? 'lr-gem--css' : 'lr-coin--css',
        ),
        el('span', undefined, `+${formatCompact(entry.attachmentAmount)}`),
      );
      foot.append(chip);
    }
    if (entry.claimed) {
      foot.append(el('span', 'lr-mail__claimed', t('mail.claimed')));
    } else {
      const claim = button('lr-btn lr-btn--claim', t('mail.claim'), () => {
        claim.disabled = true;
        void api
          .claimMail(entry.id)
          .then((result) => {
            if (result.attachmentType === 'coins' || result.attachmentType === 'gems') {
              flyReward(result.attachmentType, row);
              bumpBalance(result.attachmentType, result.amount);
            }
            void refreshProfile().catch(() => null);
            claim.remove();
            foot.append(el('span', 'lr-mail__claimed', t('mail.claimed')));
            if (!entry.read) {
              entry.read = true;
              dot.classList.add('lr-dot--hidden');
              row.classList.remove('lr-mail__row--unread');
              setUnreadMail(Math.max(0, metaState.unreadMail - 1));
            }
          })
          .catch((err: unknown) => {
            claim.disabled = false;
            toast(describeError(err));
          });
      });
      foot.append(claim);
    }
    row.append(foot);
  }
  return row;
}

/** First page is enough for the badge (50 newest — badge caps at 9+). */
function recountUnread(entries: MailEntry[]): void {
  setUnreadMail(entries.filter((e) => !e.read).length);
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
