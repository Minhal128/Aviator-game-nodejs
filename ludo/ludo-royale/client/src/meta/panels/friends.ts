/**
 * FRIENDS panel (§7.7, LW "Friends" parity v1) — your referral code (share
 * + copy), add-by-code, incoming requests (accept/decline) and the friends
 * list with the daily coin gift: one 🎁 per friend per UTC day plus a
 * "Gift all" shortcut. Gifts land in the receiver's MAIL as a coins
 * attachment (badge + claim already wired), so there is no new claim flow.
 */
import { errText, t } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { FriendEntry, FriendRequestEntry, FriendsOverview } from '../api';
import { metaState } from '../store';
import { button, el, openPanel, pulse, toast } from '../ui';

export function openFriendsPanel(): void {
  openPanel(
    t('friends.title'),
    ({ body }) => {
      body.append(el('p', 'lr-muted lr-center', t('common.loading')));
      const load = (): void => {
        void api
          .getFriends()
          .then((data) => {
            body.replaceChildren();
            render(body, data, load);
          })
          .catch((err: unknown) => {
            body.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
          });
      };
      load();
    },
    { wide: true },
  );
}

function render(body: HTMLElement, data: FriendsOverview, reload: () => void): void {
  // Your code + copy (same code the Invite panel shares).
  const myCode = metaState.profile?.user.referralCode ?? '—';
  body.append(el('p', 'lr-muted lr-center', t('friends.your_code')));
  const codeBox = el('div', 'lr-invite__code', myCode);
  body.append(codeBox);
  codeBox.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(myCode)
      .then(() => {
        pulse(codeBox);
        toast(t('online.copied'));
      })
      .catch(() => undefined);
  });

  // Add by code.
  const addRow = el('div', 'lr-friends__addrow');
  const input = document.createElement('input');
  input.className = 'lr-friends__input';
  input.placeholder = t('friends.add_ph');
  input.maxLength = 16;
  input.autocomplete = 'off';
  const addBtn = button('lr-btn lr-btn--equip', t('friends.add'), () => {
    const code = input.value.trim();
    if (code.length < 4) return;
    addBtn.disabled = true;
    void api
      .friendRequest(code)
      .then((r) => {
        toast(
          r.autoAccepted
            ? t('friends.now_friends', { name: r.name })
            : t('friends.request_sent', { name: r.name }),
        );
        reload();
      })
      .catch((err: unknown) => {
        toast(describeError(err));
        addBtn.disabled = false;
      });
  });
  addRow.append(input, addBtn);
  body.append(addRow);

  // Incoming requests.
  if (data.incoming.length > 0) {
    body.append(el('h3', 'lr-section-title', t('friends.requests')));
    for (const req of data.incoming) body.append(buildRequestRow(req, reload));
  }

  // Friends list.
  body.append(el('h3', 'lr-section-title', t('friends.list', { n: data.friends.length })));
  if (data.friends.length === 0) {
    body.append(el('p', 'lr-muted lr-center', t('friends.empty')));
    return;
  }
  const giftable = data.friends.filter((f) => f.canGift).length;
  if (giftable >= 2) {
    const all = button('lr-btn lr-btn--collect lr-friends__giftall', t('friends.gift_all'), () => {
      all.disabled = true;
      void api
        .friendGift()
        .then((r) => {
          toast(t('friends.gifts_sent', { n: r.sent }));
          reload();
        })
        .catch((err: unknown) => {
          toast(describeError(err));
          all.disabled = false;
        });
    });
    body.append(all);
  }
  for (const friend of data.friends) body.append(buildFriendRow(friend, reload));
}

function buildRequestRow(req: FriendRequestEntry, reload: () => void): HTMLElement {
  const row = el('div', 'lr-friends__row');
  row.append(el('span', 'lr-friends__avatar', req.name.charAt(0).toUpperCase()));
  const name = el('span', 'lr-friends__name', req.name);
  name.append(el('span', 'lr-friends__lv', t('hud.level', { n: req.level })));
  row.append(name);
  const respond = (accept: boolean, btn: HTMLButtonElement): void => {
    btn.disabled = true;
    void api
      .friendRespond(req.id, accept)
      .then(() => reload())
      .catch((err: unknown) => {
        toast(describeError(err));
        btn.disabled = false;
      });
  };
  const yes = button('lr-btn lr-btn--equip', '✓', () => respond(true, yes));
  const no = button('lr-btn lr-btn--muted', '✗', () => respond(false, no));
  row.append(yes, no);
  return row;
}

function buildFriendRow(friend: FriendEntry, reload: () => void): HTMLElement {
  const row = el('div', 'lr-friends__row');
  row.append(el('span', 'lr-friends__avatar', friend.name.charAt(0).toUpperCase()));
  const name = el('span', 'lr-friends__name', friend.name);
  name.append(el('span', 'lr-friends__lv', t('hud.level', { n: friend.level })));
  row.append(name);

  if (friend.canGift) {
    const gift = button('lr-btn lr-btn--equip', `🎁 ${t('friends.gift')}`, () => {
      gift.disabled = true;
      void api
        .friendGift(friend.userId)
        .then(() => {
          toast(t('friends.gift_sent'));
          reload();
        })
        .catch((err: unknown) => {
          toast(describeError(err));
          gift.disabled = false;
        });
    });
    row.append(gift);
  } else {
    row.append(el('span', 'lr-friends__done', t('friends.gifted')));
  }

  // Two-tap unfriend (same arm pattern as the shop's confirm).
  let armed = false;
  let timer = 0;
  const rm = button('lr-btn lr-btn--muted lr-friends__remove', '✕', () => {
    if (!armed) {
      armed = true;
      rm.textContent = t('friends.remove_confirm');
      timer = window.setTimeout(() => {
        armed = false;
        rm.textContent = '✕';
      }, 2500);
      return;
    }
    window.clearTimeout(timer);
    rm.disabled = true;
    void api
      .friendRemove(friend.userId)
      .then(() => reload())
      .catch((err: unknown) => {
        toast(describeError(err));
        rm.disabled = false;
      });
  });
  row.append(rm);
  return row;
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
