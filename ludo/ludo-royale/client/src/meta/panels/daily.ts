/**
 * DAILY BONUS popup (teardown + STYLE-GUIDE §6-B): 7-day calendar — days 1–6
 * in a 3×2 grid of gold-framed cream tiles, day 7 as the full-width grand
 * prize banner. States: collected (dimmed + check), today (glowing gold
 * frame), locked (dim). Green glossy COLLECT + blue DOUBLE ×2 (v1 video
 * bonus — the claim-double endpoint trusts adCompleted until AdMob SSV §8.4
 * replaces it). Claims fly coins/gems to the HUD and count the wallet up.
 * Auto-opens once per session after the splash when today is unclaimed.
 */
import { errText, t, tDyn } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { DailyBonusDay, DailyBonusState } from '../api';
import { formatCompact } from '../format';
import { bumpBalance, refreshProfile } from '../store';
import { button, confettiBurst, el, flyReward, openPanel, textureImg } from '../ui';

export function openDailyPanel(): void {
  openPanel(t('daily.title'), ({ body }) => {
    body.append(el('p', 'lr-muted lr-center', t('common.loading')));
    void api
      .getDailyBonus()
      .then((state) => {
        body.replaceChildren();
        render(body, state);
      })
      .catch((err: unknown) => {
        body.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
      });
  });
}

function render(body: HTMLElement, state: DailyBonusState): void {
  // Golden bow crowning the panel (LW reference, §8 slot art_daily_bow).
  body.append(textureImg('art_daily_bow', 'lr-daily__bow', 'lr-daily__bow'));
  body.append(el('p', 'lr-daily__subtitle', t('daily.subtitle')));
  if (state.streakCount > 0) {
    body.append(el('p', 'lr-daily__streak', t('daily.streak', { n: state.streakCount })));
  }

  const grid = el('div', 'lr-daily__grid');
  const tiles = new Map<number, HTMLElement>();
  for (const day of state.calendar) {
    const tile = buildTile(day, state);
    tiles.set(day.day, tile);
    grid.append(tile);
  }
  body.append(grid);

  const footer = el('div', 'lr-daily__footer');
  body.append(footer);

  const renderFooter = (fresh: DailyBonusState): void => {
    footer.replaceChildren();
    if (!fresh.claimedToday) {
      const collect = button('lr-btn lr-btn--collect', t('daily.collect'), () => {
        collect.disabled = true;
        void api
          .claimDaily()
          .then((result) => {
            const tile = tiles.get(result.day);
            tile?.classList.remove('lr-daily__tile--today');
            tile?.classList.add('lr-daily__tile--claimed');
            // Mirror buildTile: the in-place claim also earns its corner check.
            if (tile && !tile.querySelector('.lr-daily__check')) {
              const badge = el('span', 'lr-daily__check', '✓');
              badge.title = t('daily.collected');
              tile.append(badge);
            }
            if (result.rewardType !== 'item') {
              if (tile) flyReward(result.rewardType, tile);
              bumpBalance(result.rewardType, result.amount);
            }
            confettiBurst(body);
            void refreshProfile().catch(() => null);
            const after: DailyBonusState = {
              ...fresh,
              currentDay: result.day,
              streakCount: result.streakCount,
              claimedToday: true,
              canDouble: canDoubleAfter(fresh, result.day),
            };
            renderFooter(after);
          })
          .catch((err: unknown) => {
            collect.disabled = false;
            footer.append(el('p', 'lr-muted lr-center', describeError(err)));
          });
      });
      footer.append(collect);
      return;
    }

    footer.append(el('p', 'lr-muted lr-center', t('daily.come_back')));
    // Sin integracion de anuncios recompensados todavia: el "mira un video
    // para duplicar" NO se ofrece hasta que existan ads reales.
  };
  renderFooter(state);
}

function buildTile(day: DailyBonusDay, state: DailyBonusState): HTMLElement {
  const isGrand = day.day === 7;
  const tile = el('div', `lr-daily__tile${isGrand ? ' lr-daily__tile--grand' : ''}`);

  const collected = state.claimedToday ? day.day <= state.currentDay : day.day < state.currentDay;
  const isToday = !state.claimedToday && day.day === state.currentDay;
  if (collected) tile.classList.add('lr-daily__tile--claimed');
  else if (isToday) tile.classList.add('lr-daily__tile--today');
  else tile.classList.add('lr-daily__tile--locked');

  tile.append(el('span', 'lr-daily__day', t('daily.day', { n: day.day })));

  if (day.rewardType === 'coins') {
    // Richer days show richer art: sack from 1,000, chest on the grand day.
    const slot = isGrand ? 'art_reward_chest' : day.amount >= 1000 ? 'art_reward_sack' : 'coin_gold';
    tile.append(textureImg(slot, 'lr-daily__reward-art', 'lr-coin--css'));
    tile.append(el('span', 'lr-daily__amount', `×${formatCompact(day.amount)}`));
  } else if (day.rewardType === 'gems') {
    tile.append(textureImg('gem_violet', 'lr-daily__reward-art', 'lr-gem--css'));
    tile.append(el('span', 'lr-daily__amount', `×${formatCompact(day.amount)}`));
  } else {
    // Item day ("Cat (1d)" style) — chest art slot (§8 art_chest).
    tile.append(textureImg('art_chest', 'lr-daily__reward-art', 'lr-chest--css'));
    tile.append(el('span', 'lr-daily__amount', tDyn('daily.item', '1×')));
  }

  // Corner check badge — the old bottom stamp overlapped the amount label.
  if (collected) {
    const badge = el('span', 'lr-daily__check', '\u2713');
    badge.title = t('daily.collected');
    tile.append(badge);
  }
  return tile;
}

/** Post-claim double availability mirrors DailyBonusService.getState logic. */
function canDoubleAfter(state: DailyBonusState, claimedDay: number): boolean {
  const config = state.calendar.find((c) => c.day === claimedDay);
  return config !== undefined && config.doubleWithAd && config.rewardType !== 'item';
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
