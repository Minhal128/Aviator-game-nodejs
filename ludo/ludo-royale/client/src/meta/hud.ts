/**
 * TOP HUD (LUDOWORLD-PARITY §3 / STYLE-GUIDE §6 chrome) — DOM overlay strip
 * shown on the Home shell: avatar chip with gold ring + red level pill,
 * candy-violet coin/gem pills (procedural coin_gold / gem_violet art pulled
 * straight from the Phaser bakes), the mail button with its unread badge and
 * the settings gear. Counts render from the store snapshot and count-up on
 * every balance change; the coin/gem chips register as reward-flight targets.
 */
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from '../core/fullscreen';
import { t } from '../i18n';
import { formatCompact } from './format';
import { svgIcon } from './icons';
import { metaState, on } from './store';
import { button, countUp, el, registerFlyTarget, textureImg } from './ui';

export interface HudHandlers {
  openShop: (tab: 'coins' | 'gems') => void;
  openMail: () => void;
  openSettings: () => void;
}

export interface HudHandle {
  root: HTMLElement;
  dispose: () => void;
}

/** Deterministic default avatar: one of the faced pawns, keyed by user id. */
const AVATAR_PIECES = ['piece_red_face', 'piece_blue_face', 'piece_yellow_face', 'piece_green_face'];

export function buildHud(handlers: HudHandlers): HudHandle {
  const root = el('div', 'lr-hud');

  // -- avatar chip ----------------------------------------------------------
  const avatar = button('lr-hud__avatar', '', handlers.openSettings);
  avatar.setAttribute('aria-label', t('hud.settings'));
  const avatarArt = el('span', 'lr-hud__avatar-art');
  const levelPill = el('span', 'lr-hud__level');
  avatar.append(avatarArt, levelPill);

  // -- coins pill -----------------------------------------------------------
  const coinsPill = button('lr-hud__pill lr-hud__pill--coins', '', () => handlers.openShop('coins'));
  coinsPill.setAttribute('aria-label', t('hud.coins'));
  const coinIcon = textureImg('coin_gold', 'lr-hud__currency', 'lr-coin--css');
  const coinsCount = el('span', 'lr-hud__count', '0');
  const plusBadge = el('span', 'lr-hud__plus', '+');
  coinsPill.append(coinIcon, coinsCount, plusBadge);
  registerFlyTarget('coins', coinsPill);

  // -- gems pill ------------------------------------------------------------
  const gemsPill = button('lr-hud__pill lr-hud__pill--gems', '', () => handlers.openShop('gems'));
  gemsPill.setAttribute('aria-label', t('hud.gems'));
  const gemIcon = textureImg('gem_violet', 'lr-hud__currency', 'lr-gem--css');
  const gemsCount = el('span', 'lr-hud__count', '0');
  gemsPill.append(gemIcon, gemsCount);
  registerFlyTarget('gems', gemsPill);

  // -- mail + fullscreen + settings ------------------------------------------
  // UX sprint §1: discreet ⛶ toggle next to the gear. Hidden when the
  // Fullscreen API is absent (iPhone Safari) or the app runs standalone.
  let fsCleanup: (() => void) | null = null;
  let fsBtn: HTMLButtonElement | null = null;
  if (fullscreenAvailable()) {
    fsBtn = button('lr-hud__icon-btn', '', () => void toggleFullscreen());
    fsBtn.setAttribute('aria-label', t('hud.fullscreen'));
    const paintFs = (): void => {
      fsBtn?.replaceChildren(svgIcon(isFullscreen() ? 'compress' : 'expand'));
    };
    paintFs();
    document.addEventListener('fullscreenchange', paintFs);
    fsCleanup = () => document.removeEventListener('fullscreenchange', paintFs);
  }

  // Mail + install moved into the Settings panel (Jose: header too busy);
  // the unread-mail badge rides the gear so the signal survives the move.
  const gearBtn = button('lr-hud__icon-btn', '', handlers.openSettings);
  gearBtn.setAttribute('aria-label', t('hud.settings'));
  const mailBadge = el('span', 'lr-badge lr-badge--hidden');
  gearBtn.append(svgIcon('gear'), mailBadge);

  root.append(avatar, coinsPill, gemsPill);
  if (fsBtn) root.append(fsBtn);
  root.append(gearBtn);

  // -- live state -----------------------------------------------------------
  let shownCoins = 0;
  let shownGems = 0;

  const renderProfile = (): void => {
    const p = metaState.profile;
    if (!p) return;
    levelPill.textContent = t('hud.level', { n: p.xp.level });
    countUp(coinsCount, shownCoins, p.wallet.coins);
    countUp(gemsCount, shownGems, p.wallet.gems);
    shownCoins = p.wallet.coins;
    shownGems = p.wallet.gems;
    if (avatarArt.childElementCount === 0) {
      const pieceKey = AVATAR_PIECES[p.user.id % AVATAR_PIECES.length] ?? 'piece_red_face';
      const art = textureImg(pieceKey, 'lr-hud__avatar-img', 'lr-hud__avatar-fallback');
      if (art.classList.contains('lr-hud__avatar-fallback')) {
        art.textContent = p.user.username.slice(0, 1).toUpperCase();
      }
      avatarArt.append(art);
    }
  };

  const renderUnread = (): void => {
    const n = metaState.unreadMail;
    mailBadge.classList.toggle('lr-badge--hidden', n === 0);
    mailBadge.textContent = n > 9 ? '9+' : String(n);
  };

  // Seed the initial paint without animating from zero twice.
  const p = metaState.profile;
  if (p) {
    shownCoins = p.wallet.coins;
    shownGems = p.wallet.gems;
    coinsCount.textContent = formatCompact(shownCoins);
    gemsCount.textContent = formatCompact(shownGems);
    levelPill.textContent = t('hud.level', { n: p.xp.level });
  }
  renderProfile();
  renderUnread();

  const offProfile = on('profile', renderProfile);
  const offUnread = on('unread', renderUnread);

  return {
    root,
    dispose: () => {
      offProfile();
      offUnread();
      fsCleanup?.();
      root.remove();
    },
  };
}
