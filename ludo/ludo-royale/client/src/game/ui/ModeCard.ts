/**
 * Home mode card (ARTPASS-GAMEFEEL §2/§3, re-skinned by LUDOWORLD-PARITY §2):
 * a FAT toy diorama, not a button — baked toy body with a thick 3D base
 * slab in the mode's own saturated color (online orange / cpu coral / local
 * blue-violet), an icon cluster built from the faced pawn textures that
 * overflows the card edge, a big white chunky title with warm outline, an
 * optional swaying pennant badge, the press-sink interaction and staggered
 * "breathing" ambient loops. If a rich illustration PNG was shipped for the
 * mode (§8 slot `art_card_<kind>`), it drop-in replaces the cluster.
 */
import Phaser from 'phaser';
import { LR_ART, LR_BAKE_SCALE, LR_COLORS, cssColor, dp } from '../../theme/tokens';
import { reducedMotion } from '../fx/Juice';
import { gameText, uiText } from './text';
import {
  attachToyPress,
  ensurePennant,
  ensureToyBody,
  ensureToyShadow,
} from './toyBake';
import type { ToyStyle } from './toyBake';

export type ModeCardKind = 'online' | 'cpu' | 'local' | 'private';

/** LW parity: four EQUAL fat tiles in a 2x2 grid (Jose reference). */
export const MODE_CARD_GRID_W = 336;
export const MODE_CARD_GRID_H = 250;

export class ModeCard extends Phaser.GameObjects.Container {
  private readonly bodyBox: Phaser.GameObjects.Container;
  private readonly cluster: Phaser.GameObjects.Container;
  private readonly cardW: number;
  private readonly cardH: number;
  private dieImg?: Phaser.GameObjects.Image;
  private ribbon?: Phaser.GameObjects.Container;
  private shimmerBar?: Phaser.GameObjects.Image;
  private readonly ambientTweens: Phaser.Tweens.Tween[] = [];

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    kind: ModeCardKind,
    title: string,
    subtitle: string,
    badge: string | undefined,
    onTap: () => void,
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    const w = MODE_CARD_GRID_W;
    const h = MODE_CARD_GRID_H;
    this.cardW = w;
    this.cardH = h;
    const r = dp(30);
    // §2.3: every tile is a saturated candy body of its own mode color;
    // the private-room tile takes the fresh green of the success family.
    const style: ToyStyle = kind === 'private' ? 'success' : kind;

    const shadow = scene.add
      .image(0, dp(LR_ART.sink.shadowRestDp), ensureToyShadow(scene, w, h, r))
      .setScale(1 / LR_BAKE_SCALE)
      .setAlpha(LR_ART.sink.shadowRestAlpha);
    this.add(shadow);

    this.bodyBox = scene.add.container(0, 0);
    this.bodyBox.add(scene.add.image(0, 0, ensureToyBody(scene, style, w, h, r)).setScale(1 / LR_BAKE_SCALE));

    // Icon diorama — §2.5: +25% scale, faced pawns, mode-colored glow, and
    // it overflows the card edge (the Ludo-World "art leaves the box" read).
    this.cluster = scene.add.container(0, -34);
    const accent =
      kind === 'online'
        ? LR_COLORS.cardOnlineA
        : kind === 'cpu'
          ? LR_COLORS.cardCpuA
          : kind === 'private'
            ? LR_COLORS.gold500
            : LR_COLORS.cardLocalA;
    this.cluster.add(
      scene.add.image(0, -4, 'fx_glow').setTint(accent).setAlpha(0.3).setScale(1.4),
    );
    let die: Phaser.GameObjects.Image;
    if (kind === 'online') {
      // Four rivals around the die — the full-table promise of real online.
      this.cluster.add(scene.add.image(-32, 32, 'piece_shadow').setScale(1).setAlpha(0.8));
      this.cluster.add(scene.add.image(32, 32, 'piece_shadow').setScale(1).setAlpha(0.8));
      this.cluster.add(scene.add.image(-10, 40, 'piece_shadow').setScale(0.88).setAlpha(0.7));
      this.cluster.add(scene.add.image(12, 42, 'piece_shadow').setScale(0.88).setAlpha(0.7));
      this.cluster.add(
        scene.add.image(-32, 0, 'piece_red_face').setOrigin(0.5, 0.62).setScale(0.48).setAngle(-10),
      );
      this.cluster.add(
        scene.add.image(-10, 10, 'piece_blue_face').setOrigin(0.5, 0.62).setScale(0.4).setAngle(-4),
      );
      this.cluster.add(
        scene.add.image(12, 12, 'piece_green_face').setOrigin(0.5, 0.62).setScale(0.4).setAngle(4),
      );
      this.cluster.add(
        scene.add.image(32, 2, 'piece_yellow_face').setOrigin(0.5, 0.62).setScale(0.48).setAngle(10),
      );
      die = scene.add
        .image(0, 45, 'dice_face_6')
        .setScale(0.3)
        .setAngle(-8)
        .setTint(LR_COLORS.gold300);
    } else if (kind === 'cpu') {
      // Player pawn (with a face) staring down the dark "CPU pawn".
      this.cluster.add(scene.add.image(-22, 32, 'piece_shadow').setScale(1.1).setAlpha(0.8));
      this.cluster.add(scene.add.image(25, 37, 'piece_shadow').setScale(1).setAlpha(0.8));
      this.cluster.add(
        scene.add.image(-22, 0, 'piece_red_face').setOrigin(0.5, 0.62).setScale(0.53).setAngle(-8),
      );
      this.cluster.add(
        scene.add
          .image(25, 5, 'piece_blue')
          .setOrigin(0.5, 0.62)
          .setScale(0.45)
          .setAngle(8)
          .setTint(LR_COLORS.panelInk),
      );
      die = scene.add.image(7, 42, 'dice_face_6').setScale(0.3).setAngle(12);
    } else if (kind === 'private') {
      // Two friends leaning in over a golden invite die (room code vibes).
      this.cluster.add(scene.add.image(-22, 32, 'piece_shadow').setScale(1.1).setAlpha(0.8));
      this.cluster.add(scene.add.image(22, 32, 'piece_shadow').setScale(1.1).setAlpha(0.8));
      this.cluster.add(
        scene.add.image(-22, 0, 'piece_green_face').setOrigin(0.5, 0.62).setScale(0.5).setAngle(-8),
      );
      this.cluster.add(
        scene.add.image(22, 2, 'piece_red_face').setOrigin(0.5, 0.62).setScale(0.5).setAngle(8),
      );
      die = scene.add
        .image(2, 45, 'dice_face_5')
        .setScale(0.3)
        .setAngle(10)
        .setTint(LR_COLORS.gold300);
    } else {
      // Two buddies side by side.
      this.cluster.add(scene.add.image(-22, 32, 'piece_shadow').setScale(1.1).setAlpha(0.8));
      this.cluster.add(scene.add.image(22, 32, 'piece_shadow').setScale(1.1).setAlpha(0.8));
      this.cluster.add(
        scene.add.image(-22, 0, 'piece_blue_face').setOrigin(0.5, 0.62).setScale(0.5).setAngle(-6),
      );
      this.cluster.add(
        scene.add.image(22, 2, 'piece_yellow_face').setOrigin(0.5, 0.62).setScale(0.5).setAngle(6),
      );
      die = scene.add.image(2, 45, 'dice_face_2').setScale(0.28).setAngle(-10);
    }
    this.dieImg = die;
    this.cluster.add(die);
    this.cluster.add(scene.add.image(-52, -38, 'fx_spark').setTint(LR_COLORS.gold500).setAlpha(0.5).setScale(0.6));
    this.cluster.add(scene.add.image(42, -45, 'fx_spark').setTint(LR_COLORS.gold300).setAlpha(0.45).setScale(0.42));
    // §8 slot: a shipped rich illustration replaces the interim cluster.
    const artKey = `art_card_${kind}`;
    if (scene.textures.exists(artKey)) {
      this.cluster.removeAll(true);
      this.dieImg = undefined;
      const art = scene.add.image(0, 0, artKey);
      const fit = 190 / Math.max(art.width, art.height);
      art.setScale(fit);
      this.cluster.add(art);
    }
    this.bodyBox.add(this.cluster);

    // §2.4 title: white chunky Baloo with the warm/cool outline + hard
    // shadow — the outline is what keeps it legible on the saturated body.
    const strokeCol = kind === 'local' ? LR_COLORS.titleStrokeCool : LR_COLORS.titleStrokeBrown;
    this.bodyBox.add(gameText(scene, 0, 64, title, 28, { strokeColor: strokeCol }));
    this.bodyBox.add(
      uiText(scene, 0, 96, subtitle, 13, LR_COLORS.textOnDark, '600').setAlpha(0.85),
    );

    this.add(this.bodyBox);

    if (badge) this.buildBadge(scene, badge, w, h);

    // INVARIANT — container position == visual center. Every child is laid
    // out around (0, 0), so this container's (x, y) IS the visual center of
    // the card. Any entrance/ambient tween must animate THIS container (or a
    // parent), never bodyBox, or the hit area detaches from the visual.
    //
    // Hit-area coordinate space: Phaser adds displayOrigin (w/2, h/2) to the
    // container-centered local point before testing the hitArea of a SIZED
    // container (InputManager.pointWithinHitArea), so the rect must be
    // top-left based (0, 0, w, h). A centered rect (-w/2, -h/2, w, h) here
    // shifts the real tap zone half a card UP and LEFT of the visual — the
    // "dead lower half" bug on mobile.
    this.setSize(w, h);
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, w, h),
      Phaser.Geom.Rectangle.Contains,
    );
    attachToyPress(scene, this, { body: this.bodyBox, shadow }, onTap);

    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const tw of this.ambientTweens) tw.destroy();
      const owned: Phaser.GameObjects.GameObject[] = [this.bodyBox, shadow, this.cluster];
      if (this.dieImg) owned.push(this.dieImg);
      scene.tweens.killTweensOf(owned);
      if (this.ribbon) scene.tweens.killTweensOf(this.ribbon);
      if (this.shimmerBar) scene.tweens.killTweensOf(this.shimmerBar);
    });
  }

  /** "HOT!" pennant with a V-tail, pinned so it can sway from its pin (§2). */
  private buildBadge(scene: Phaser.Scene, badge: string, w: number, h: number): void {
    const bandW = 112;
    const bandH = dp(30);
    const key = ensurePennant(scene, `pennant_hot_${bandW}x${bandH}`, {
      w: bandW,
      h: bandH,
      notch: dp(14),
      tails: 'right',
      gradTop: LR_COLORS.sceneRibbonRed,
      gradBottom: LR_COLORS.sceneRibbonRedDk,
      goldPinstripes: false,
      folds: [0],
    });
    // Pin (container origin) sits on the card; the tail overhangs dp(8).
    const ribbon = scene.add.container(w / 2 - bandW + dp(8), -h / 2 + dp(10));
    ribbon.add(scene.add.image(0, 0, key).setOrigin(0, 0.42).setScale(1 / LR_BAKE_SCALE));
    // +4 = baked left padding of the pennant canvas; centers on the solid band.
    const label = gameText(scene, (bandW - dp(14)) / 2 + 4, 0, badge, 12, {
      strokeColor: LR_COLORS.sceneRibbonInk,
      hardShadow: false,
    });
    label.setStroke(cssColor(LR_COLORS.sceneRibbonInk), 2).setLetterSpacing(1);
    ribbon.add(label);
    this.ribbon = ribbon;
    this.add(ribbon);
  }

  /** §3 ambient loops — staggered so the cards breathe out of phase. */
  startAmbient(index: number): void {
    if (reducedMotion()) return;
    const a = LR_ART.ambient;
    const scene = this.scene;
    this.ambientTweens.push(
      scene.tweens.add({
        targets: this,
        scaleX: a.breathScale,
        scaleY: a.breathScale,
        duration: a.breathMs,
        delay: index * a.breathStaggerMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
      scene.tweens.add({
        targets: this.cluster,
        y: this.cluster.y - dp(a.clusterBobDp),
        duration: a.clusterBobMs,
        delay: index * a.breathStaggerMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
    if (this.dieImg) {
      this.ambientTweens.push(
        scene.tweens.add({
          targets: this.dieImg,
          angle: this.dieImg.angle + a.dieTiltDeg * 2 * (this.dieImg.angle < 0 ? 1 : -1),
          duration: a.dieTiltMs,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }),
      );
    }
    if (this.ribbon) {
      this.ambientTweens.push(
        scene.tweens.add({
          targets: this.ribbon,
          angle: { from: -a.ribbonSwayDeg, to: a.ribbonSwayDeg },
          duration: a.ribbonSwayMs,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }),
      );
    }
  }

  /** §3 shimmer sweep across the card face. */
  playShimmer(): void {
    // Home's shimmer timer can fire on the exact frame a scene switch
    // destroys this card — this.scene is undefined then; bail out.
    if (!this.scene) return;
    if (reducedMotion()) return;
    const a = LR_ART.ambient;
    if (!this.shimmerBar) {
      this.shimmerBar = this.scene.add
        .image(0, 0, 'fx_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAngle(-18)
        .setVisible(false);
      this.shimmerBar.setDisplaySize(this.cardW * 0.22, this.cardH * 1.3);
      this.bodyBox.add(this.shimmerBar);
    }
    const bar = this.shimmerBar;
    if (bar.visible) return;
    const reach = this.cardW / 2 - dp(28);
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
