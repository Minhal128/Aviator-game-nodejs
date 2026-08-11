/**
 * Overlay root (ARQUITECTURA §4.6) — the DOM meta-game layer over the Phaser
 * canvas. One absolutely-positioned 720×1280 logical surface that tracks the
 * canvas rect (Scale.FIT letterboxing included) via transform-scale, so every
 * child lays out in the same logical pixels as the game. Assembles the Home
 * chrome (TOP HUD, events row, bottom nav, ticker), routes panel opens, and
 * drives the session flows: guest auth warm-up at boot, profile/badge
 * refresh + the auto Daily Bonus popup when Home shows, full hide during
 * matches, and the "+X coins" toast when a match's server-side rewards land.
 */
import Phaser from 'phaser';
import { armAutoFullscreen } from '../core/fullscreen';
import { t } from '../i18n';
import { applyCssTokens } from '../theme/tokens';
import { api } from './api';
import { buildEventsRow } from './events';
import type { EventsHandle } from './events';
import { buildHud } from './hud';
import type { HudHandle } from './hud';
import { buildNav } from './nav';
import type { NavHandle } from './nav';
import { openBackpackPanel } from './panels/backpack';
import { openDailyPanel } from './panels/daily';
import { openFriendsPanel } from './panels/friends';
import { openInvitePanel } from './panels/invite';
import { openMailPanel } from './panels/mail';
import { openMissionsPanel } from './panels/missions';
import { openRankingPanel } from './panels/ranking';
import { openSettingsPanel } from './panels/settings';
import { openShopPanel } from './panels/shop';
import { openWheelPanel } from './panels/wheel';
import {
  metaState,
  on,
  refreshEquipment,
  refreshProfile,
  setMissionsClaimable,
  setUnreadMail,
  setWheelSpins,
} from './store';
import { bindOverlayRoot, bindTextureSource, closeAllPanels, el, toast } from './ui';
import './overlay.css';

/** Logical overlay width; height (1280) lives in .lr-root's CSS. */
const LOGICAL_W = 720;

/** Scenes where the chrome is visible. Everywhere else: canvas only. */
const CHROME_SCENES: ReadonlySet<string> = new Set(['Home']);
const WATCHED_SCENES: readonly string[] = ['Splash', 'Home', 'Waiting', 'Game', 'Results'];

export function initMetaOverlay(game: Phaser.Game): void {
  applyCssTokens();
  api.warmUp(); // guest auth starts in parallel with the splash bakes

  const root = el('div', 'lr-root lr-root--hidden');
  root.id = 'lr-root';
  document.body.append(root);
  bindOverlayRoot(root);
  bindTextureSource(game);

  // INPUT FIREWALL (Jose: "los taps en las ventanas ejecutan los vinculos
  // del fondo"): Phaser's InputManager also listens on window, so pointer/
  // mouse/touch events born in the DOM chrome bubble up and hit-test the
  // game objects BEHIND the panel (reproduced: a shop Buy tap opened the
  // vs-CPU setup underneath). Stop them at the overlay root — every inner
  // handler (buttons, scrim-close, inputs) runs earlier in the bubble path,
  // and events born on the canvas never pass through here.
  const INPUT_EVENTS = [
    'pointerdown',
    'pointerup',
    'pointermove',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
    'touchmove',
    'click',
  ] as const;
  for (const type of INPUT_EVENTS) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  const chromeLayer = el('div', 'lr-chrome');
  root.append(chromeLayer);

  // ------------------------------------------------------------- rect sync
  const sync = (): void => {
    const rect = game.canvas.getBoundingClientRect();
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.transform = `scale(${rect.width / LOGICAL_W})`;
  };

  // -------------------------------------------------------------- chrome
  let hud: HudHandle | null = null;
  let events: EventsHandle | null = null;
  let nav: NavHandle | null = null;

  // Bottom-nav Store opens on cosmetics (Dice) so it never looks empty; the
  // HUD coin "+" is the one that jumps straight to the coin packs.
  const openStore = (): void => openShopPanel('dice');

  const buildChrome = (): void => {
    hud?.dispose();
    events?.dispose();
    nav?.dispose();
    hud = buildHud({
      openShop: (tab) => openShopPanel(tab),
      openMail: openMailPanel,
      openSettings: openSettingsPanel,
    });
    events = buildEventsRow({
      openWheel: openWheelPanel,
      openDaily: openDailyPanel,
      openInvite: openInvitePanel,
    });
    nav = buildNav({
      openFriends: openFriendsPanel,
      openRanking: openRankingPanel,
      openInvite: openInvitePanel,
      openMissions: openMissionsPanel,
      openBackpack: openBackpackPanel,
      openShop: openStore,
    });
    chromeLayer.replaceChildren(hud.root, events.root, nav.ticker, nav.root);
  };

  // Language switch: re-render every DOM label, and restart the Home scene
  // so its canvas-baked labels (mode cards, level pill) repaint too.
  on('locale', () => {
    buildChrome();
    if (game.scene.isActive('Home')) game.scene.getScene('Home')?.scene.restart();
  });

  // ------------------------------------------------------ session flows
  let dailyAutoShown = false;
  let cameFromMatch = false;
  let coinsBeforeMatch: number | null = null;
  let playedThisSession = false;
  let guestNudged = false;

  // Guest retention (Jose): warn before the tab closes if a guest has real
  // progress (played a match this session) that lives only on this device
  // until they attach an email account.
  window.addEventListener('beforeunload', (e) => {
    const isGuest = metaState.profile?.user.isGuest ?? true;
    if (isGuest && playedThisSession) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const onHomeShown = (): void => {
    void refreshProfile()
      .then(() => {
        if (cameFromMatch && coinsBeforeMatch !== null) {
          const now = metaState.profile?.wallet.coins ?? coinsBeforeMatch;
          const delta = now - coinsBeforeMatch;
          // Prizes/XP were credited by the server during the match (§6.2) —
          // here we only SURFACE them.
          if (delta > 0) toast(t('toast.match_rewards', { n: delta }));
          // Guest retention: once per session, nudge the guest to save their
          // progress under an email account so their level survives a close.
          if ((metaState.profile?.user.isGuest ?? true) && !guestNudged) {
            guestNudged = true;
            window.setTimeout(() => toast(t('account.save_nudge')), 2600);
          }
        }
        cameFromMatch = false;
        coinsBeforeMatch = null;
        if (!dailyAutoShown) {
          dailyAutoShown = true;
          void api
            .getDailyBonus()
            .then((state) => {
              if (!state.claimedToday) openDailyPanel();
            })
            .catch(() => undefined);
        }
      })
      .catch(() => toast(t('err.ERR_NETWORK')));

    // Badge refreshers — independent, tolerant to failure/absence.
    void api
      .getMail()
      .then((page) => setUnreadMail(page.entries.filter((e) => !e.read).length))
      .catch(() => undefined);
    void api
      .getWheel()
      .then((state) => setWheelSpins(state.spinsLeft))
      .catch(() => setWheelSpins(null));
    void api
      .getMissions()
      .then(({ missions }) =>
        setMissionsClaimable(missions.filter((m) => m.completed && !m.claimed).length),
      )
      .catch(() => undefined);
    // Equipped dice skin — GameBoardScene reads it at match start.
    void refreshEquipment();
  };

  // ------------------------------------------------------- scene watcher
  const onSceneStart = (key: string): void => {
    const showChrome = CHROME_SCENES.has(key);
    root.classList.toggle('lr-root--hidden', !showChrome);
    if (!showChrome) closeAllPanels();
    if (key === 'Game') {
      cameFromMatch = true;
      playedThisSession = true;
      coinsBeforeMatch = metaState.profile?.wallet.coins ?? null;
    }
    if (showChrome) {
      if (!hud) buildChrome();
      sync();
      onHomeShown();
      // UX sprint §1: the FIRST gesture after Home shows (a mode-card tap
      // qualifies) tries fullscreen on mobile browser tabs. One-shot,
      // self-guarded (touch + !standalone + no stored opt-out).
      armAutoFullscreen();
    }
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    sync();
    game.scale.on(Phaser.Scale.Events.RESIZE, sync);
    window.addEventListener('resize', sync);
    for (const key of WATCHED_SCENES) {
      const scene = game.scene.getScene(key);
      scene?.events.on(Phaser.Scenes.Events.START, () => onSceneStart(key));
    }
  });
}
