/**
 * Juice effect #1 — physical dice tumble (STYLE-GUIDE §5.1, numbers from
 * LR_MOTION.dice): wind-up, procedural tumble spritesheet over a small arc,
 * 3-step squash on landing with a dust puff, face reveal pulse + additive
 * flash. Pulses with a brand ring when it is the local player's turn.
 */
import Phaser from 'phaser';
import { DEPTH } from '../layout';
import { LR_BAKE_SCALE, LR_COLORS, LR_MOTION, dp } from '../../theme/tokens';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import type { FxLayer } from '../fx/FxLayer';
import { delayP, reducedMotion, tweenP } from '../fx/Juice';
import { diceFaceKey, diceTumbleAnim } from '../textures/bakeDice';
import type { DiceSkinId } from '../textures/bakeDice';

const DIE_SCALE = 1 / LR_BAKE_SCALE;

export class DiceView extends Phaser.GameObjects.Container {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly ring: Phaser.GameObjects.Image;
  private readonly flashDisc: Phaser.GameObjects.Image;
  private readonly skin: DiceSkinId;
  private pulses: Phaser.Tweens.Tween[] = [];
  private rollable = false;
  private rolling = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onTap: () => void,
    skin: DiceSkinId = 'classic',
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setDepth(DEPTH.dice);
    this.skin = skin;

    // Tight slot glow (NOT a levitation halo) + contact shadow so the die
    // reads as resting in its tray.
    this.ring = scene.add
      .image(0, 0, 'fx_ring')
      .setScale(0.92)
      .setAlpha(0)
      .setTint(LR_COLORS.brand300)
      .setBlendMode(Phaser.BlendModes.ADD);
    const contact = scene.add.image(0, dp(34), 'piece_shadow').setScale(1.25, 0.9).setAlpha(0.5);
    this.add(contact);
    this.sprite = scene.add.sprite(0, 0, diceFaceKey(skin, 1)).setScale(DIE_SCALE);
    this.flashDisc = scene.add
      .image(0, 0, 'fx_glow')
      .setScale(1.4)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.add([this.ring, this.sprite, this.flashDisc]);

    // ≥160dp hit area regardless of the visual size (STYLE-GUIDE §7).
    const hit = dp(160);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-hit / 2, -hit / 2, hit, hit),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.rollable && !this.rolling) onTap();
    });
  }

  setRollable(on: boolean): void {
    this.rollable = on;
    this.clearPulses();
    if (!on) {
      this.ring.setAlpha(0);
      this.sprite.setScale(DIE_SCALE);
      return;
    }
    if (reducedMotion()) {
      this.ring.setAlpha(0.6);
      return;
    }
    this.ring.setAlpha(0.32);
    this.pulses.push(
      this.scene.tweens.add({
        targets: this.sprite,
        scaleX: DIE_SCALE * 1.06,
        scaleY: DIE_SCALE * 1.06,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
      this.scene.tweens.add({
        targets: this.ring,
        alpha: 0.14,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
  }

  async roll(value: number, fx: FxLayer): Promise<void> {
    this.rolling = true;
    this.clearPulses();
    this.ring.setAlpha(0);
    sfx('roll'); // §4 stub — silent until the audio asset pass lands
    const m = LR_MOTION.dice;

    if (reducedMotion()) {
      // Cross-fade straight to the face + minimal pop (§5.1 reduced).
      this.sprite.setTexture(diceFaceKey(this.skin, value)).setAlpha(0.2).setScale(DIE_SCALE);
      await tweenP(this.scene, {
        targets: this.sprite,
        alpha: 1,
        scaleX: DIE_SCALE * 1.04,
        scaleY: DIE_SCALE * 1.04,
        duration: m.flashMs,
        yoyo: true,
      });
      this.sprite.setScale(DIE_SCALE).setAlpha(1);
      this.rolling = false;
      return;
    }

    // Wind-up.
    await tweenP(this.scene, {
      targets: this.sprite,
      scaleX: DIE_SCALE * m.windupScale,
      scaleY: DIE_SCALE * m.windupScale,
      duration: m.windupMs,
      ease: 'Quad.easeIn',
    });

    // Tumble frames + faked-physics arc with positional jitter.
    this.sprite.play(diceTumbleAnim(this.skin));
    this.sprite.setScale(DIE_SCALE);
    const jitter = this.scene.tweens.add({
      targets: this.sprite,
      x: { from: -5, to: 5 },
      duration: 85,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    await tweenP(this.scene, {
      targets: this.sprite,
      y: -dp(m.arcHeightDp),
      duration: m.arcUpMs,
      ease: 'Quad.easeOut',
    });
    await tweenP(this.scene, {
      targets: this.sprite,
      y: 0,
      duration: m.arcDownMs,
      ease: 'Quad.easeIn',
    });
    jitter.stop();
    this.sprite.setX(0);

    // Landing: final face + 3-step squash + dust (§5.1) + a 15ms haptic hit.
    this.sprite.stop();
    this.sprite.setTexture(diceFaceKey(this.skin, value));
    fx.emitDust(this.x, this.y + dp(60));
    haptic('dice');
    this.sprite.setScale(DIE_SCALE * 1.18, DIE_SCALE * 0.82);
    await tweenP(this.scene, {
      targets: this.sprite,
      scaleX: DIE_SCALE * 0.92,
      scaleY: DIE_SCALE * 1.08,
      duration: m.squashStepMs,
      ease: 'Quad.easeOut',
    });
    await tweenP(this.scene, {
      targets: this.sprite,
      scaleX: DIE_SCALE,
      scaleY: DIE_SCALE,
      duration: m.squashStepMs,
      ease: 'Back.easeOut',
    });

    // Reveal pulse + additive flash.
    this.flashDisc.setAlpha(m.flashAlpha);
    this.scene.tweens.add({
      targets: this.flashDisc,
      alpha: 0,
      duration: m.flashMs,
      ease: 'Quad.easeOut',
    });
    await tweenP(this.scene, {
      targets: this.sprite,
      scaleX: DIE_SCALE * m.revealScale,
      scaleY: DIE_SCALE * m.revealScale,
      duration: m.revealMs / 2,
      yoyo: true,
      ease: 'Back.easeOut',
    });
    await delayP(this.scene, 30);
    this.rolling = false;
  }

  private clearPulses(): void {
    for (const tw of this.pulses) tw.stop();
    this.pulses = [];
    this.sprite.setScale(DIE_SCALE);
  }
}
