/** One reusable toast pill (turn skips, pass-device hints, errors). */
import Phaser from 'phaser';
import { DEPTH } from '../layout';
import { LR_COLORS, LR_FONTS, LR_MOTION, cssColor } from '../../theme/tokens';
import { reducedMotion, tweenP, delayP } from '../fx/Juice';

export class Toast extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly baseY: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
    this.baseY = y;
    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: LR_FONTS.ui,
        fontSize: '16px',
        fontStyle: '800',
        color: cssColor(LR_COLORS.textOnDark),
      })
      .setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setDepth(DEPTH.toast);
    this.setAlpha(0);
  }

  /** Candy pill: ink body + top gloss + gold hairline + soft drop shadow. */
  private redraw(w: number): void {
    const h = 48;
    const r = h / 2;
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.22);
    this.bg.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, r);
    this.bg.fillStyle(LR_COLORS.panelInk, 0.96);
    this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    this.bg.fillStyle(0xffffff, 0.09);
    this.bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h / 2 - 4, r - 5);
    this.bg.lineStyle(2, LR_COLORS.gold500, 0.85);
    this.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  }

  async show(msg: string, holdMs: number): Promise<void> {
    // Phones need a beat longer to read — never blink away under 1.4s.
    holdMs = Math.max(holdMs, 1400);
    this.label.setText(msg);
    this.redraw(this.label.width + 56);
    const fade = reducedMotion() ? LR_MOTION.reducedFadeMs : 160;
    if (reducedMotion()) {
      await tweenP(this.scene, { targets: this, alpha: 1, duration: fade });
    } else {
      // Pop-in: rise + settle (the flat fade read as a dead gray box).
      this.setScale(0.9);
      this.y = this.baseY + 14;
      await tweenP(this.scene, {
        targets: this,
        alpha: 1,
        scale: 1,
        y: this.baseY,
        duration: fade,
        ease: 'Back.easeOut',
      });
    }
    await delayP(this.scene, holdMs);
    await tweenP(this.scene, { targets: this, alpha: 0, duration: fade });
  }
}
