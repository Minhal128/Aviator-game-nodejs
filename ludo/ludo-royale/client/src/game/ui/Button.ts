/**
 * Toy-style button (ARTPASS-GAMEFEEL §2): baked 6-layer body (two-part
 * shadow as a SEPARATE sprite, gradient body, dark/light bevel lips, gloss,
 * exterior outline) + the press that sinks the body dp(5) into its own
 * shrinking shadow. Textures cached per style+size; every existing caller
 * inherits the upgrade.
 */
import Phaser from 'phaser';
import { LR_ART, LR_BAKE_SCALE, LR_COLORS, LR_FONTS, cssColor, dp } from '../../theme/tokens';
import { reducedMotion } from '../fx/Juice';
import { attachToyPress, ensureToyBody, ensureToyShadow } from './toyBake';
import type { ToyStyle } from './toyBake';

export type ButtonStyle = ToyStyle;

export class Button extends Phaser.GameObjects.Container {
  private readonly label: Phaser.GameObjects.Text;
  private readonly bodyBox: Phaser.GameObjects.Container;
  private readonly btnW: number;
  private readonly btnH: number;
  private shimmerBar?: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    style: ButtonStyle,
    onTap: () => void,
    labelSize = 17,
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    this.btnW = w;
    this.btnH = h;

    // Fatter corners than the old web-rect (§2.2).
    const r = Math.min(dp(24), h / 2);
    const shadow = scene.add
      .image(0, dp(LR_ART.sink.shadowRestDp), ensureToyShadow(scene, w, h, r))
      .setScale(1 / LR_BAKE_SCALE)
      .setAlpha(LR_ART.sink.shadowRestAlpha);
    this.add(shadow);

    this.bodyBox = scene.add.container(0, 0);
    this.bodyBox.add(scene.add.image(0, 0, ensureToyBody(scene, style, w, h, r)).setScale(1 / LR_BAKE_SCALE));
    this.label = scene.add
      .text(0, 0, text, {
        fontFamily: LR_FONTS.ui,
        fontSize: `${labelSize}px`,
        fontStyle: '800',
        color: style === 'surface' ? cssColor(LR_COLORS.text) : '#ffffff',
      })
      .setOrigin(0.5);
    this.bodyBox.add(this.label);
    this.add(this.bodyBox);

    // Sized containers get displayOrigin (w/2, h/2) added to the local point
    // before the hitArea test, so the rect is top-left based (0, 0, w, h) —
    // a centered rect would shift the tap zone half a button up/left
    // (see the invariant note in ModeCard).
    this.setSize(Math.max(w, dp(44)), Math.max(h, dp(44)));
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.width, this.height),
      Phaser.Geom.Rectangle.Contains,
    );
    attachToyPress(scene, this, { body: this.bodyBox, shadow }, onTap);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.tweens.killTweensOf([this.bodyBox, shadow]);
      if (this.shimmerBar) scene.tweens.killTweensOf(this.shimmerBar);
    });
  }

  setLabel(text: string): void {
    this.label.setText(text);
  }

  /** §3 shimmer: one additive gloss bar sweeps the face left→right. */
  playShimmer(): void {
    // Same destroyed-object guard as ModeCard.playShimmer (scene-switch race).
    if (!this.scene) return;
    if (reducedMotion()) return;
    const a = LR_ART.ambient;
    if (!this.shimmerBar) {
      this.shimmerBar = this.scene.add
        .image(0, 0, 'fx_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAngle(-18)
        .setVisible(false);
      this.shimmerBar.setDisplaySize(this.btnW * 0.28, this.btnH * 1.35);
      this.bodyBox.add(this.shimmerBar);
    }
    const bar = this.shimmerBar;
    if (bar.visible) return; // one sweep at a time
    // Travel clamped inside the rounded ends so the bar never leaks edges.
    const reach = this.btnW / 2 - dp(24);
    bar.setPosition(-reach, 0).setAlpha(a.shimmerAlpha).setVisible(true);
    this.scene.tweens.add({
      targets: bar,
      x: reach,
      duration: a.shimmerMs,
      ease: 'Quad.easeOut',
      onComplete: () => bar.setVisible(false),
    });
  }
}
