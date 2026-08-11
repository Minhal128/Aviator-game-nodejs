/**
 * Juice effect #3 — capture combo (STYLE-GUIDE §5.3, exact numbers from
 * LR_MOTION.capture): hit-stop → screen shake + impact burst + full-screen
 * flash + "OUT!" seal, while the victim pops, spins and arcs back to base
 * and the attacker does a triumphant bob.
 */
import type Phaser from 'phaser';
import { DEPTH } from '../layout';
import { LR_COLORS, LR_FONTS, LR_MOTION, LR_PLAYERS, cssColor, cssRgba, dp } from '../../theme/tokens';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import { t } from '../../i18n';
import type { PieceView } from '../objects/PieceView';
import type { FxLayer } from './FxLayer';
import { delayP, hitStop, punchScale, reducedMotion, shake, tweenP } from './Juice';

export interface CaptureComboOptions {
  attacker: PieceView;
  victim: PieceView;
  cellX: number;
  cellY: number;
  baseX: number;
  baseY: number;
  fx: FxLayer;
}

export async function playCaptureCombo(
  scene: Phaser.Scene,
  opts: CaptureComboOptions,
): Promise<void> {
  const m = LR_MOTION.capture;
  const victimPal = LR_PLAYERS[opts.victim.color];
  sfx('capture'); // §4 stub
  haptic('capture'); // 20ms hit — self-guarded (reduced motion / support)

  if (reducedMotion()) {
    // No shake/flash; quick fade + relocation, static seal (§5.3 reduced).
    showSeal(scene, opts.cellX, opts.cellY, victimPal.mid, true);
    await opts.victim.captureFlight(opts.baseX, opts.baseY);
    return;
  }

  await hitStop(scene, m.hitStopMs);

  shake(scene, m.shakeMs, m.shakeIntensity);
  opts.fx.flash(m.flashAlpha, m.flashMs);
  opts.fx.emitBurst(opts.cellX, opts.cellY, victimPal.mid);
  showSeal(scene, opts.cellX, opts.cellY, victimPal.mid, false);
  void punchScale(scene, opts.attacker, m.attackerBobScale, m.attackerBobMs);

  await opts.victim.captureFlight(opts.baseX, opts.baseY);
}

function showSeal(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  instant: boolean,
): void {
  // Level-A stamp (LUDOWORLD-PARITY §7): cool-violet outline + hard purple
  // shadow, victim-color fill.
  const seal = scene.add
    .text(x, y - 20, t('game.out'), {
      fontFamily: LR_FONTS.display,
      fontSize: '42px',
      fontStyle: '800',
      color: cssColor(color),
      stroke: cssColor(LR_COLORS.titleStrokeCool),
      strokeThickness: 5,
    })
    .setOrigin(0.5)
    .setDepth(DEPTH.banner);
  seal.setShadow(0, dp(4), cssRgba(LR_COLORS.sceneShadowInk, 0.55), 0, false, true);

  if (instant) {
    scene.tweens.add({
      targets: seal,
      alpha: 0,
      delay: LR_MOTION.capture.sealMs,
      duration: 120,
      onComplete: () => seal.destroy(),
    });
    return;
  }

  seal.setScale(0);
  void (async () => {
    await tweenP(scene, {
      targets: seal,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });
    await Promise.all([
      tweenP(scene, {
        targets: seal,
        y: y - 20 - dp(LR_MOTION.capture.sealRiseDp),
        alpha: 0,
        duration: LR_MOTION.capture.sealMs,
        ease: 'Quad.easeOut',
      }),
      delayP(scene, LR_MOTION.capture.sealMs),
    ]);
    seal.destroy();
  })();
}
