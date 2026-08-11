/**
 * RANKING panel (STYLE-GUIDE §6-F) — real GET /leaderboard with Weekly /
 * All-time tabs. Top 3 render as a podium (gold center-first, silver left,
 * bronze right) with medal rings; the rest as scroll rows. The caller's own
 * position pins to the panel foot (from `me`), highlighted, whether or not
 * they made the top-100.
 */
import { errText, t } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { LeaderboardEntry, LeaderboardView } from '../api';
import { formatCompact } from '../format';
import { metaState } from '../store';
import { button, el, openPanel } from '../ui';

type Period = 'weekly' | 'alltime';

export function openRankingPanel(): void {
  openPanel(
    t('rank.title'),
    ({ body }) => {
      const tabs = el('div', 'lr-tabs');
      const rail = el('div', 'lr-tabs__rail');
      tabs.append(rail);
      const content = el('div', 'lr-rank__content');
      body.append(tabs, content);

      const tabButtons = new Map<Period, HTMLButtonElement>();
      const show = (period: Period): void => {
        for (const [id, btn] of tabButtons) btn.classList.toggle('lr-tab--active', id === period);
        content.replaceChildren(el('p', 'lr-muted lr-center', t('common.loading')));
        void api
          .getLeaderboard(period)
          .then((view) => {
            content.replaceChildren();
            render(content, view);
          })
          .catch((err: unknown) => {
            content.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
          });
      };

      const defs: ReadonlyArray<{ id: Period; label: string }> = [
        { id: 'weekly', label: t('rank.tab_weekly') },
        { id: 'alltime', label: t('rank.tab_alltime') },
      ];
      for (const def of defs) {
        const btn = button('lr-tab', def.label, () => show(def.id));
        tabButtons.set(def.id, btn);
        rail.append(btn);
      }
      show('weekly');
    },
    { wide: true },
  );
}

function render(content: HTMLElement, view: LeaderboardView): void {
  if (view.entries.length === 0) {
    content.append(el('p', 'lr-muted lr-center', t('rank.empty')));
  } else {
    const podiumEntries = view.entries.slice(0, 3);
    if (podiumEntries.length > 0) content.append(buildPodium(podiumEntries));
    const rest = view.entries.slice(3);
    if (rest.length > 0) {
      const list = el('div', 'lr-list lr-rank__list');
      const myId = metaState.profile?.user.id;
      for (const entry of rest) list.append(buildRow(entry, entry.userId === myId));
      content.append(list);
    }
  }

  // My position: the purple pill ONLY when I actually hold a rank. Showing it
  // with just a hint read like a dead button (Jose "ese boton violeta no me
  // gusta"); the not-ranked case is a plain, subtle hint instead.
  if (view.me !== null) {
    const mine = el('div', 'lr-rank__me');
    mine.append(
      el('span', 'lr-rank__pos', t('rank.rank_n', { n: view.me.rank })),
      el('span', 'lr-rank__name', t('rank.you')),
      el('span', 'lr-rank__score', formatCompact(view.me.score)),
    );
    content.append(mine);
  } else {
    content.append(el('p', 'lr-muted lr-center lr-rank__hint', t('rank.not_ranked')));
  }
}

function buildPodium(top: LeaderboardEntry[]): HTMLElement {
  const podium = el('div', 'lr-rank__podium');
  // Visual order: 2nd — 1st — 3rd (center-first like Ludo World).
  const order = [top[1], top[0], top[2]];
  const medals = ['silver', 'gold', 'bronze'];
  order.forEach((entry, i) => {
    if (!entry) return;
    const spot = el('div', `lr-rank__spot lr-rank__spot--${medals[i] ?? 'gold'}`);
    const medal = el('span', 'lr-rank__medal', String(entry.rank));
    spot.append(
      medal,
      el('span', 'lr-rank__name', entry.username),
      el('span', 'lr-rank__lv', t('hud.level', { n: entry.level })),
      el('span', 'lr-rank__score', formatCompact(entry.score)),
    );
    podium.append(spot);
  });
  return podium;
}

function buildRow(entry: LeaderboardEntry, isMe: boolean): HTMLElement {
  const row = el('div', `lr-rank__row${isMe ? ' lr-rank__row--me' : ''}`);
  row.append(
    el('span', 'lr-rank__pos', t('rank.rank_n', { n: entry.rank })),
    el('span', 'lr-rank__name', entry.username),
    el('span', 'lr-rank__lv', t('hud.level', { n: entry.level })),
    el('span', 'lr-rank__score', formatCompact(entry.score)),
  );
  return row;
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
