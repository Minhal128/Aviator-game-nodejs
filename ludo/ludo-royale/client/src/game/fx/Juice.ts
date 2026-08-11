/**
 * Tween helpers shared by every effect. All of them honor the global
 * reduced-motion flag (STYLE-GUIDE §5): callers branch on `reducedMotion()`
 * for structural changes, and these helpers keep the mechanics DRY.
 */
import type Phaser from 'phaser';
import { LR_MOTION, LR_RUNTIME } from '../../theme/tokens';
import { sfx } from '../../core/audio';

export function reducedMotion(): boolean {
  return LR_RUNTIME.reducedMotion;
}

/** Promise wrapper over tweens so effects can be sequenced with async/await. */
export function tweenP(
  scene: Phaser.Scene,
  config: Phaser.Types.Tweens.TweenBuilderConfig,
): Promise<void> {
  return new Promise((resolve) => {
    scene.tweens.add({
      ...config,
      onComplete: () => resolve(),
    });
  });
}

export function delayP(scene: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((resolve) => {
    scene.time.delayedCall(ms, () => resolve());
  });
}

/**
 * Hit-stop (§5.3): freezes every tween for a couple of frames. Uses the
 * clock (not tweens) for the resume so it cannot deadlock itself.
 */
export async function hitStop(scene: Phaser.Scene, ms: number): Promise<void> {
  if (reducedMotion()) return;
  scene.tweens.timeScale = 0;
  await delayP(scene, ms);
  scene.tweens.timeScale = 1;
}

export function shake(scene: Phaser.Scene, ms: number, intensity: number): void {
  if (reducedMotion()) return;
  scene.cameras.main.shake(ms, intensity);
}

/** Press feedback for every interactive element (STYLE-GUIDE §11 DO#4). */
export function pressFeedback(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform): void {
  sfx('tap');
  if (reducedMotion()) return;
  const sx = target.scaleX;
  const sy = target.scaleY;
  scene.tweens.add({
    targets: target,
    scaleX: sx * LR_MOTION.press.scale,
    scaleY: sy * LR_MOTION.press.scale,
    duration: LR_MOTION.press.ms,
    yoyo: true,
    ease: 'Back.easeOut',
  });
}

/** Scale punch: 1 → peak → 1 (dice reveal, attacker bob, emote pop). */
export function punchScale(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  peak: number,
  ms: number,
): Promise<void> {
  const sx = target.scaleX;
  const sy = target.scaleY;
  return tweenP(scene, {
    targets: target,
    scaleX: sx * peak,
    scaleY: sy * peak,
    duration: ms / 2,
    yoyo: true,
    ease: 'Back.easeOut',
  });
}
