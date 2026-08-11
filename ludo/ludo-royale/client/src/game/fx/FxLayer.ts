/**
 * One set of reusable particle emitters + the full-screen flash for the
 * whole match scene. Emitters are created once and re-triggered (60fps
 * budget: never construct Graphics/emitters per frame or per event).
 */
import Phaser from 'phaser';
import { DEPTH, GAME_H, GAME_W } from '../layout';
import { LR_COLORS, LR_MOTION, LR_PLAYERS } from '../../theme/tokens';
import { reducedMotion } from './Juice';

export class FxLayer {
  private readonly scene: Phaser.Scene;
  private readonly trail: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dustEm: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly burstEm: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly confettiEm: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rainEm: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashRect: Phaser.GameObjects.Rectangle;
  private trailTint = 0xffffff;
  private burstTint = 0xffffff;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.trail = scene.add.particles(0, 0, 'fx_dot', {
      speed: { min: 30, max: 70 },
      lifespan: 200,
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      gravityY: 60,
      emitting: false,
      tint: { onEmit: () => this.trailTint },
    });
    this.trail.setDepth(DEPTH.fx);

    this.dustEm = scene.add.particles(0, 0, 'fx_dot', {
      speed: { min: 40, max: 90 },
      angle: { min: 200, max: 340 },
      lifespan: 250,
      scale: { start: 0.8, end: 0.1 },
      alpha: { start: 0.8, end: 0 },
      emitting: false,
      tint: LR_PLAYERS.yellow.tint,
    });
    this.dustEm.setDepth(DEPTH.fx);

    this.burstEm = scene.add.particles(0, 0, 'fx_spark', {
      speed: { min: 220, max: 360 },
      lifespan: 400,
      scale: { start: 0.9, end: 0.2 },
      gravityY: 500,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
      tint: { onEmit: () => (Math.random() < 0.4 ? 0xffffff : this.burstTint) },
    });
    this.burstEm.setDepth(DEPTH.fx);

    const confettiTints = [
      LR_PLAYERS.red.mid,
      LR_PLAYERS.green.mid,
      LR_PLAYERS.yellow.mid,
      LR_PLAYERS.blue.mid,
      LR_COLORS.gold500,
    ];
    this.confettiEm = scene.add.particles(0, 0, 'fx_confetti', {
      speed: { min: 260, max: 520 },
      angle: { min: 240, max: 300 },
      gravityY: LR_MOTION.victory.gravityY,
      lifespan: { min: LR_MOTION.victory.lifeMinMs, max: LR_MOTION.victory.lifeMaxMs },
      rotate: { min: 0, max: 360 },
      scale: { min: 0.7, max: 1.2 },
      alpha: { start: 1, end: 0, ease: 'Expo.easeIn' },
      emitting: false,
      tint: confettiTints,
    });
    this.confettiEm.setDepth(DEPTH.fx);

    this.rainEm = scene.add.particles(0, 0, 'fx_confetti', {
      x: { min: 30, max: GAME_W - 30 },
      y: -20,
      speedY: { min: 120, max: 260 },
      speedX: { min: -40, max: 40 },
      gravityY: LR_MOTION.victory.gravityY,
      lifespan: { min: LR_MOTION.victory.lifeMinMs, max: LR_MOTION.victory.lifeMaxMs },
      rotate: { min: 0, max: 360 },
      scale: { min: 0.7, max: 1.2 },
      quantity: 2,
      frequency: 40,
      emitting: false,
      tint: confettiTints,
    });
    this.rainEm.setDepth(DEPTH.fx);

    this.flashRect = scene.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xffffff, 1)
      .setAlpha(0)
      .setDepth(DEPTH.banner)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  /** 3-4 color dust motes per hop landing (§5.2). */
  emitTrail(x: number, y: number, tint: number): void {
    if (reducedMotion()) return;
    this.trailTint = tint;
    this.trail.explode(LR_MOTION.hop.trailCount, x, y);
  }

  /** Cream landing puff for the die (§5.1). */
  emitDust(x: number, y: number): void {
    if (reducedMotion()) return;
    this.dustEm.explode(LR_MOTION.dice.dustCount, x, y);
  }

  /** Radial impact burst in the captured token's color (§5.3). */
  emitBurst(x: number, y: number, tint: number, count: number = LR_MOTION.capture.burstCount): void {
    if (reducedMotion()) return;
    this.burstTint = tint;
    this.burstEm.explode(count, x, y);
  }

  /** Victory confetti: initial pop + short rain from the top edge (§5.4). */
  confetti(x: number, y: number): void {
    if (reducedMotion()) return;
    this.confettiEm.explode(LR_MOTION.victory.confettiBurst, x, y);
    this.rainEm.start();
    this.scene.time.delayedCall(LR_MOTION.victory.confettiRainMs, () => this.rainEm.stop());
  }

  /** Full-screen additive flash (dice reveal uses a local one; this is §5.3). */
  flash(alpha: number, ms: number): void {
    if (reducedMotion()) return;
    this.flashRect.setAlpha(alpha);
    this.scene.tweens.add({
      targets: this.flashRect,
      alpha: 0,
      duration: ms,
      ease: 'Quad.easeOut',
    });
  }
}
