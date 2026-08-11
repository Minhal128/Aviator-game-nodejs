/**
 * Juice effect #4 — victory beat (STYLE-GUIDE §5.4): camera zoom, confetti
 * pop + rain, gold "VICTORY!" banner with rotating rays. Skippable by tap
 * and hero beat capped so results become reachable fast. 2nd-4th place get
 * the soft "GOOD GAME" treatment — never punishment visuals.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_W } from '../layout';
import { LR_COLORS, LR_EASE, LR_FONTS, LR_MOTION, cssColor } from '../../theme/tokens';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import { t } from '../../i18n';
import type { FxLayer } from './FxLayer';
import { gameText } from '../ui/text';
import { delayP, reducedMotion, tweenP } from './Juice';

export interface VictoryOptions {
  focusX: number;
  focusY: number;
  winnerName: string;
  /** Full celebration (a local human won) vs soft "good game". */
  big: boolean;
  fx: FxLayer;
}

export async function playVictoryFx(scene: Phaser.Scene, opts: VictoryOptions): Promise<void> {
  const m = LR_MOTION.victory;
  const bannerY = opts.focusY;
  if (opts.big) {
    sfx('win'); // §4 stub — the full celebration only (never on "good game")
    haptic('win');
  }
  const skip = waitForTapOr(scene, opts.big ? 2300 : 1400);

  // Level-A hero type (LUDOWORLD-PARITY §7): gold tint takes the warm brown
  // outline — the deeper stroke on the biggest banner — + hard purple shadow.
  const banner = gameText(scene, GAME_W / 2, bannerY, opts.big ? t('game.victory') : t('game.good_game'), opts.big ? 60 : 44, {
    tint: [LR_COLORS.gold300, LR_COLORS.gold300, LR_COLORS.gold500, LR_COLORS.gold700],
    strokeColor: opts.big ? LR_COLORS.titleStrokeDark : LR_COLORS.titleStrokeBrown,
  }).setDepth(DEPTH.banner);

  const name = scene.add
    .text(GAME_W / 2, bannerY + (opts.big ? 52 : 42), opts.winnerName, {
      fontFamily: LR_FONTS.ui,
      fontSize: '20px',
      fontStyle: '800',
      color: cssColor(LR_COLORS.textOnDark),
    })
    .setOrigin(0.5)
    .setAlpha(0)
    .setDepth(DEPTH.banner);

  let rays: Phaser.GameObjects.Image | undefined;

  if (reducedMotion()) {
    banner.setAlpha(0);
    scene.tweens.add({ targets: [banner, name], alpha: 1, duration: 200 });
  } else if (opts.big) {
    scene.cameras.main.zoomTo(m.zoomTo, m.zoomMs, LR_EASE.cubicOut);
    opts.fx.confetti(opts.focusX, opts.focusY);

    rays = scene.add
      .image(GAME_W / 2, bannerY, 'fx_rays')
      .setDepth(DEPTH.banner - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.4)
      .setScale(1.4);
    scene.tweens.add({ targets: rays, angle: 360, duration: 9000, repeat: -1, ease: 'Linear' });

    banner.setScale(0);
    void tweenP(scene, {
      targets: banner,
      scale: { from: 0, to: 1 },
      duration: m.bannerMs,
      ease: LR_EASE.backOut,
      // Back.easeOut supplies the 1.15 overshoot from the spec.
    });
    scene.tweens.add({ targets: name, alpha: 1, delay: 250, duration: 200 });
  } else {
    banner.setScale(0);
    scene.tweens.add({ targets: banner, scale: 1, duration: 300, ease: LR_EASE.backOut });
    scene.tweens.add({ targets: name, alpha: 1, delay: 180, duration: 200 });
  }

  await skip;

  banner.destroy();
  name.destroy();
  rays?.destroy();
  if (!reducedMotion() && opts.big) {
    scene.cameras.main.zoomTo(1, 180, LR_EASE.quadOut);
    await delayP(scene, 180);
  }
}

/** Celebration must stay skippable (STYLE-GUIDE §11 DO#1 / DON'T#6). */
function waitForTapOr(scene: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = scene.time.delayedCall(ms, () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onTap);
      resolve();
    });
    const onTap = (): void => {
      timer.remove();
      resolve();
    };
    scene.input.once(Phaser.Input.Events.POINTER_DOWN, onTap);
  });
}
