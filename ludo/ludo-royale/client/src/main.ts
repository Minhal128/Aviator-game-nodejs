/**
 * Bootstrap: runtime flags first (locale, reduced motion, perf profile),
 * then the Phaser game at the 720×1280 logical resolution with Scale.FIT
 * (ARQUITECTURA §4.1), then the DOM meta-game overlay (§4.6) that rides on
 * top of the canvas. PROD builds also register the PWA service worker.
 */
import Phaser from 'phaser';
import { initI18n } from './i18n';
import { LR_COLORS, cssColor, initReducedMotion } from './theme/tokens';
import { initPerf } from './core/perf';
import { GAME_H, GAME_W } from './game/layout';
import { BootScene } from './game/scenes/BootScene';
import { SplashScene } from './game/scenes/SplashScene';
import { HomeScene } from './game/scenes/HomeScene';
import { WaitingScene } from './game/scenes/WaitingScene';
import { GameBoardScene } from './game/scenes/GameBoardScene';
import { ResultsScene } from './game/scenes/ResultsScene';
import { initMetaOverlay } from './meta/overlay';
import { initInstall } from './meta/install';
import { unlockAudio } from './core/audio';

initI18n();
initInstall(); // PWA: captura beforeinstallprompt ANTES de montar el chrome
// Autoplay policy: el audio (musica + sfx) despierta con el primer gesto.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true });
initReducedMotion();
initPerf(); // low-end detection → lite ambient preset + window.__LR_PERF (§2)

// DPR note (UX sprint §2): Phaser 4.2 exposes NO `resolution` game-config
// knob (dropped in 3.16, never returned — verified against phaser types and
// the ScaleManager source: FIT mode always sets canvas.width/height to the
// logical game size and only scales the CSS size). The backing store is
// therefore a fixed 720×1280 on every screen — already below the
// min(devicePixelRatio, 2) budget by design. `autoRound` is the knob 4.2
// DOES offer: integer canvas CSS sizes avoid subpixel sampling on weak GPUs.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: cssColor(LR_COLORS.worldBottom),
  render: {
    antialias: true,
    roundPixels: true,
    powerPreference: 'high-performance',
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    autoRound: true,
  },
  scene: [BootScene, SplashScene, HomeScene, WaitingScene, GameBoardScene, ResultsScene],
});

// DOM overlay chrome (HUD / events / nav / panels) over the canvas (§4.6).
initMetaOverlay(game);

// FIT re-letterboxes on viewport changes (rotation, mobile URL-bar collapse).
window.addEventListener('resize', () => game.scale.refresh());

// PWA (UX sprint §1): cache-first shell so installed/standalone launches are
// instant and offline-tolerant. PROD only — a SW in dev would cache Vite's
// transformed modules and poison HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => undefined);
  });
}
