/**
 * MISSIONS panel (STYLE-GUIDE §6-C) — real daily missions from GET /missions
 * with progress bars (progress/target, fill animates on open), reward chips
 * and a gold CLAIM button on completed-unclaimed rows. Claiming flies the
 * reward to the HUD, counts the wallet up and greys the row. Progress is
 * pushed server-side by match events — this panel only reads and claims.
 */
import { errText, t, tDyn } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { MissionView } from '../api';
import { formatCompact } from '../format';
import { bumpBalance, refreshProfile, setMissionsClaimable } from '../store';
import { button, el, flyReward, openPanel, textureImg, toast } from '../ui';

export function openMissionsPanel(): void {
  openPanel(t('mission.title'), ({ body }) => {
    body.append(el('p', 'lr-muted lr-center', t('common.loading')));
    void api
      .getMissions()
      .then(({ missions }) => {
        body.replaceChildren();
        syncBadge(missions);
        if (missions.length === 0) {
          body.append(el('p', 'lr-muted lr-center', t('mission.empty')));
          return;
        }
        const list = el('div', 'lr-list');
        for (const mission of missions) list.append(buildRow(mission, missions));
        body.append(list);
      })
      .catch((err: unknown) => {
        body.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
      });
  });
}

function buildRow(mission: MissionView, all: MissionView[]): HTMLElement {
  const row = el('div', `lr-mission${mission.claimed ? ' lr-mission--claimed' : ''}`);

  const info = el('div', 'lr-mission__info');
  info.append(el('span', 'lr-mission__name', missionName(mission)));

  const barTrack = el('div', 'lr-bar');
  const fillPct = Math.min(100, (mission.progress / Math.max(1, mission.target)) * 100);
  const barFill = el('span', 'lr-bar__fill');
  barTrack.append(barFill, el('span', 'lr-bar__text', `${mission.progress}/${mission.target}`));
  info.append(barTrack);
  // Fill animates from 0 on the next frame (Cubic-out via CSS transition).
  requestAnimationFrame(() => {
    barFill.style.width = `${fillPct}%`;
  });

  const side = el('div', 'lr-mission__side');
  const rewardChip = el('span', 'lr-mission__reward');
  rewardChip.append(
    textureImg(
      mission.rewardType === 'gems' ? 'gem_violet' : 'coin_gold',
      'lr-chip-art',
      mission.rewardType === 'gems' ? 'lr-gem--css' : 'lr-coin--css',
    ),
    el('span', undefined, `+${formatCompact(mission.rewardAmount)}`),
  );
  side.append(rewardChip);

  if (mission.claimed) {
    side.append(el('span', 'lr-mission__done', t('mission.claimed')));
  } else if (mission.completed) {
    const claim = button('lr-btn lr-btn--claim', t('mission.claim'), () => {
      claim.disabled = true;
      void api
        .claimMission(mission.id)
        .then((result) => {
          flyReward(result.rewardType, row);
          bumpBalance(result.rewardType, result.amount);
          void refreshProfile().catch(() => null);
          mission.claimed = true;
          syncBadge(all);
          claim.remove();
          side.append(el('span', 'lr-mission__done', t('mission.claimed')));
          row.classList.add('lr-mission--claimed');
        })
        .catch((err: unknown) => {
          claim.disabled = false;
          toast(describeError(err));
        });
    });
    side.append(claim);
  }

  row.append(info, side);
  return row;
}

function syncBadge(missions: MissionView[]): void {
  setMissionsClaimable(missions.filter((m) => m.completed && !m.claimed).length);
}

/** Mission code → i18n (`mission.<code>`) with a humanized fallback. */
function missionName(mission: MissionView): string {
  return tDyn(
    `mission.${mission.code}`,
    mission.code.replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
  );
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
