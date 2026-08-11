/**
 * Juice effect #5 — radial wheel of 6 lighthearted emotes (STYLE-GUIDE
 * §5.5: Unicode placeholders until the commissioned art pass; all friendly,
 * zero toxicity by design). Fans out in a semicircle with 30ms stagger; a
 * 0.2-alpha scrim closes it on outside tap.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_H, GAME_W } from '../layout';
import { LR_COLORS, LR_MOTION, dp } from '../../theme/tokens';
import { pressFeedback, reducedMotion } from '../fx/Juice';

// Unicode fallbacks; the shipped art (art_emoji_01..08) wins when present.
export const EMOTES: readonly string[] = ['😄', '😂', '😡', '😉', '😮', '😴', '🤔', '🥳'];

/** §8 slot key for an emote id (art pack tanda 2). */
export function emoteArtKey(id: number): string {
  return `art_emoji_${String(id + 1).padStart(2, '0')}`;
}

/** Throwable taunts (LW parity: lanzale cositas al rival). */
export const TAUNTS: readonly string[] = ['🍅', '🥚', '💦', '❄️'];

export class EmoteWheelView extends Phaser.GameObjects.Container {
  private readonly scrim: Phaser.GameObjects.Rectangle;
  private readonly items: Phaser.GameObjects.Container[] = [];
  private open = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onPick: (emoteId: number) => void,
    onTaunt?: (tauntId: number) => void,
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setDepth(DEPTH.emoteWheel);

    this.scrim = scene.add
      .rectangle(GAME_W / 2 - x, GAME_H / 2 - y, GAME_W, GAME_H, LR_COLORS.worldVignette, LR_MOTION.emote.scrimAlpha)
      .setVisible(false);
    this.scrim.setInteractive();
    this.scrim.on(Phaser.Input.Events.POINTER_DOWN, () => this.close());
    this.add(this.scrim);

    // LW-style emoji PANEL: 4x2 emote grid + a taunt row you THROW at the
    // rival (tomato / egg / splash / snowball), floating up-left of the
    // button (the old radial fan crowded once the art pack grew to 8).
    const px0 = -dp(188);
    const py0 = -dp(226);
    const panel = scene.add.container(px0, py0).setVisible(false);
    const pbg = scene.add.graphics();
    pbg.fillStyle(LR_COLORS.hudInk, 0.96);
    pbg.fillRoundedRect(-dp(188), -dp(146), dp(376), dp(292), dp(20));
    pbg.lineStyle(2, LR_COLORS.brand300, 0.5);
    pbg.strokeRoundedRect(-dp(188), -dp(146), dp(376), dp(292), dp(20));
    // Divider over the taunt row.
    pbg.lineStyle(2, LR_COLORS.brand300, 0.25);
    pbg.lineBetween(-dp(164), dp(48), dp(164), dp(48));
    panel.add(pbg);
    this.add(panel);
    this.panel = panel;

    if (onTaunt) {
      TAUNTS.forEach((glyph, tId) => {
        const item = scene.add.container(px0 + (-dp(135) + tId * dp(90)), py0 + dp(96));
        const bg = scene.add
          .circle(0, 0, dp(33), LR_COLORS.worldVignette, 1)
          .setStrokeStyle(2, LR_COLORS.brand300, 0.7);
        const icon = scene.add.text(0, 0, glyph, { fontSize: '32px' }).setOrigin(0.5);
        item.add([bg, icon]);
        item.setSize(dp(76), dp(70));
        item.setInteractive(
          new Phaser.Geom.Rectangle(0, 0, dp(76), dp(70)),
          Phaser.Geom.Rectangle.Contains,
        );
        item.on(Phaser.Input.Events.POINTER_DOWN, () => pressFeedback(scene, item));
        item.on(Phaser.Input.Events.POINTER_UP, () => {
          this.close();
          onTaunt(tId);
        });
        item.setVisible(false).setScale(0);
        this.items.push(item);
        this.add(item);
      });
    }

    EMOTES.forEach((emoji, i) => {
      const item = scene.add.container(
        px0 + (-dp(135) + (i % 4) * dp(90)),
        py0 + (-dp(92) + Math.floor(i / 4) * dp(90)),
      );
      const bg = scene.add.circle(0, 0, dp(38), LR_COLORS.surface).setStrokeStyle(2, LR_COLORS.borderStrong);
      const artKey = emoteArtKey(i);
      const icon: Phaser.GameObjects.GameObject = scene.textures.exists(artKey)
        ? scene.add.image(0, 0, artKey).setDisplaySize(dp(64), dp(64))
        : scene.add.text(0, 0, emoji, { fontSize: '38px' }).setOrigin(0.5);
      item.add([bg, icon]);
      // Top-left based rect: sized containers get displayOrigin added to the
      // local point before the hitArea test (see invariant note in ModeCard).
      item.setSize(dp(84), dp(84));
      item.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, dp(84), dp(84)),
        Phaser.Geom.Rectangle.Contains,
      );
      item.on(Phaser.Input.Events.POINTER_DOWN, () => pressFeedback(scene, item));
      item.on(Phaser.Input.Events.POINTER_UP, () => {
        this.close();
        onPick(i);
      });
      item.setVisible(false).setScale(0);
      this.items.push(item);
      this.add(item);
    });
  }

  private panel!: Phaser.GameObjects.Container;

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private show(): void {
    this.open = true;
    this.scrim.setVisible(true);
    this.panel.setVisible(true);
    this.items.forEach((item, i) => {
      item.setVisible(true);
      if (reducedMotion()) {
        item.setScale(1).setAlpha(0);
        this.scene.tweens.add({ targets: item, alpha: 1, duration: 100 });
        return;
      }
      this.scene.tweens.add({
        targets: item,
        scale: 1,
        duration: LR_MOTION.emote.itemInMs,
        delay: i * LR_MOTION.emote.staggerMs,
        ease: 'Back.easeOut',
      });
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.scrim.setVisible(false);
    this.panel.setVisible(false);
    for (const item of this.items) {
      item.setVisible(false).setScale(0).setAlpha(1);
    }
  }
}
