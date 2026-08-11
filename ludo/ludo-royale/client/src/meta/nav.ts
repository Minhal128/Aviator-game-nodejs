/**
 * Bottom nav (LUDOWORLD-PARITY §4): deep-violet band with 6 slots —
 * Friends · Ranking · Invite · Mission · Backpack · Shop — white filled
 * icons + small labels, red-dot badge on Mission when something is
 * claimable. Above it, the TICKER: a slow marquee rotating localized game
 * tips (the world-chat strip placeholder — live chat is v2).
 */
import { t } from '../i18n';
import type { I18nKey } from '../i18n';
import { svgIcon } from './icons';
import type { IconName } from './icons';
import { metaState, on } from './store';
import { button, el, reducedMotion, textureUrl } from './ui';

export interface NavHandlers {
  openFriends: () => void;
  openRanking: () => void;
  openInvite: () => void;
  openMissions: () => void;
  openBackpack: () => void;
  openShop: () => void;
}

export interface NavHandle {
  root: HTMLElement;
  ticker: HTMLElement;
  dispose: () => void;
}

const TIPS: readonly I18nKey[] = [
  'ticker.tip1',
  'ticker.tip2',
  'ticker.tip3',
  'ticker.tip4',
  'ticker.tip5',
];

export function buildNav(handlers: NavHandlers): NavHandle {
  const root = el('div', 'lr-nav');

  const slots: ReadonlyArray<{
    icon: IconName;
    art: string;
    label: I18nKey;
    onTap: () => void;
    badged?: boolean;
  }> = [
    { icon: 'friends', art: 'nav_friends', label: 'nav.friends', onTap: handlers.openFriends },
    { icon: 'trophy', art: 'nav_ranking', label: 'nav.ranking', onTap: handlers.openRanking },
    { icon: 'gift', art: 'nav_invite', label: 'nav.invite', onTap: handlers.openInvite },
    { icon: 'mission', art: 'nav_mission', label: 'nav.mission', onTap: handlers.openMissions, badged: true },
    { icon: 'backpack', art: 'nav_backpack', label: 'nav.backpack', onTap: handlers.openBackpack },
    { icon: 'shop', art: 'nav_shop', label: 'nav.shop', onTap: handlers.openShop },
  ];

  let missionDot: HTMLElement | null = null;
  for (const slot of slots) {
    const btn = button('lr-nav__slot', '', slot.onTap);
    // Shipped art PNG (assets/art manifest slot) wins over the built-in SVG
    // glyph — same override rule as the canvas bakers (§ART-SLOTS).
    const artSrc = textureUrl(slot.art);
    if (artSrc !== null) {
      const img = el('img', 'lr-icon lr-nav__icon lr-nav__icon--art');
      img.src = artSrc;
      img.alt = '';
      img.draggable = false;
      btn.append(img);
    } else {
      btn.append(svgIcon(slot.icon, 'lr-icon lr-nav__icon'));
    }
    btn.append(el('span', 'lr-nav__label', t(slot.label)));
    if (slot.badged === true) {
      missionDot = el('span', 'lr-dot lr-dot--hidden');
      btn.append(missionDot);
    }
    root.append(btn);
  }

  const renderMissions = (): void => {
    missionDot?.classList.toggle('lr-dot--hidden', metaState.missionsClaimable === 0);
  };
  renderMissions();
  const offMissions = on('missions', renderMissions);

  // -- ticker ----------------------------------------------------------------
  const ticker = el('div', 'lr-ticker');
  const line = el('span', 'lr-ticker__line');
  ticker.append(line);
  let tipIndex = 0;
  let tickerTimer = 0;

  const showTip = (): void => {
    // Hidden tab: skip the swap + marquee restart entirely (§2 hygiene —
    // no DOM/animation churn in the background; resumes on the next tick).
    if (document.hidden) return;
    const key = TIPS[tipIndex % TIPS.length] ?? 'ticker.tip1';
    tipIndex++;
    line.textContent = t(key);
    if (reducedMotion()) {
      // Static swap, no motion — still informative.
      return;
    }
    line.classList.remove('lr-ticker__line--run');
    // Restart the CSS marquee animation from the right edge.
    void line.offsetWidth;
    line.classList.add('lr-ticker__line--run');
  };
  showTip();
  tickerTimer = window.setInterval(showTip, 9000);

  return {
    root,
    ticker,
    dispose: () => {
      offMissions();
      window.clearInterval(tickerTimer);
      root.remove();
      ticker.remove();
    },
  };
}
