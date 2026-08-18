/**
 * Match-HUD avatar chip (STYLE-GUIDE §3): white disc, INNER identity ring
 * in the player color, initials, name below, OUTER timer ring (urgency
 * scheme, separate so identity and urgency never fight), and the emote
 * bubble anchor. Pulses when the timer drops under 5s.
 */
import Phaser from 'phaser';
import type { PlayerColor } from '@ludo/shared';
import { DEPTH } from '../layout';
import { LR_COLORS, LR_FONTS, LR_MOTION, LR_PLAYERS, cssColor, dp } from '../../theme/tokens';
import { t } from '../../i18n';
import { reducedMotion, tweenP, delayP } from '../fx/Juice';
import { TurnTimerView } from './TurnTimerView';
import { BUBBLE_STYLES } from '../textures/bakeSkins';
import type { BubbleSkinId } from '../textures/bakeSkins';

export class AvatarChip extends Phaser.GameObjects.Container {
  readonly color: PlayerColor;
  private readonly radius: number;
  private readonly timer: TurnTimerView;
  private readonly disc: Phaser.GameObjects.Graphics;
  private pulseTween?: Phaser.Tweens.Tween;
  private bubbleOpen = false;
  /** Equipped bubble_skin cosmetic — palette of this chip's bubbles. */
  private bubbleSkin: BubbleSkinId = 'classic';
  private statusBadge?: Phaser.GameObjects.Container;
  private statusDot?: Phaser.GameObjects.Arc;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    radius: number,
    color: PlayerColor,
    initials: string,
    name: string,
    artKey?: string,
  ) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setDepth(DEPTH.hud);
    this.color = color;
    this.radius = radius;
    const pal = LR_PLAYERS[color];

    this.disc = scene.add.graphics();
    const boxW = radius * 3.4;
    const boxH = radius * 1.45;
    // Horizontal seat box (pin + die slot), not a circular avatar.
    this.disc.fillStyle(LR_COLORS.sceneShadowInk, 0.25);
    this.disc.fillRoundedRect(-boxW / 2 + 2, -boxH / 2 + 3, boxW, boxH, 16);
    this.disc.fillStyle(0xf3e8ee, 1);
    this.disc.fillRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, 16);
    this.disc.lineStyle(3, pal.mid, 1);
    this.disc.strokeRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, 16);
    const slot = 28;
    this.disc.fillStyle(0xffffff, 1);
    this.disc.fillRoundedRect(boxW / 2 - slot - 10, -slot / 2, slot, slot, 6);
    this.disc.lineStyle(2, pal.dark, 0.35);
    this.disc.strokeRoundedRect(boxW / 2 - slot - 10, -slot / 2, slot, slot, 6);
    this.add(this.disc);

    const pin = scene.add.image(-boxW / 2 + 28, 4, `piece_${color}`).setScale(0.42);
    this.add(pin);

    if (artKey !== undefined && scene.textures.exists(artKey)) {
      const art = scene.add.image(-boxW / 2 + 28, -2, artKey);
      art.setDisplaySize(28, 28);
      this.add(art);
    }

    const nameText = scene.add
      .text(0, boxH / 2 + 12, name || initials, {
        fontFamily: LR_FONTS.ui,
        fontSize: '12px',
        fontStyle: '700',
        color: cssColor(LR_COLORS.textOnDark),
      })
      .setOrigin(0.5);
    this.add(nameText);

    this.timer = new TurnTimerView(scene, radius + dp(6));
    this.add(this.timer);

    this.setActive2(false);
  }

  /** `setActive` is taken by GameObject; this drives the turn highlight. */
  setActive2(on: boolean): void {
    this.setAlpha(on ? 1 : 0.7);
    if (!on) {
      this.timer.draw(0);
      this.setUrgent(false);
    }
  }

  updateTimer(fraction: number): void {
    this.timer.draw(fraction);
  }

  setUrgent(on: boolean): void {
    if (on && !this.pulseTween && !reducedMotion()) {
      const m = LR_MOTION.timer;
      this.pulseTween = this.scene.tweens.add({
        targets: this,
        scaleX: m.pulseScale,
        scaleY: m.pulseScale,
        duration: m.pulseMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else if (!on && this.pulseTween) {
      this.pulseTween.stop();
      this.pulseTween = undefined;
      this.setScale(1);
    }
  }

  setDimmed(on: boolean): void {
    this.setAlpha(on ? 0.35 : 1);
  }

  /**
   * Online presence badge (§6.6): red dot while disconnected, amber AUTO
   * pill while the server plays the seat. Lazy — offline modes never pay.
   */
  setStatus(connected: boolean, auto: boolean): void {
    const show = !connected || auto;
    if (!show) {
      this.statusBadge?.setVisible(false);
      return;
    }
    if (!this.statusBadge) {
      const badge = this.scene.add.container(this.radius * 0.75, -this.radius * 0.75);
      const pillW = dp(44);
      const pillH = dp(18);
      const bg = this.scene.add.graphics();
      bg.fillStyle(LR_COLORS.warning, 1);
      bg.fillRoundedRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
      bg.lineStyle(2, LR_COLORS.panelInk, 0.5);
      bg.strokeRoundedRect(-pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
      const label = this.scene.add
        .text(0, 0, t('online.auto_badge'), {
          fontFamily: LR_FONTS.ui,
          fontSize: '11px',
          fontStyle: '800',
          color: cssColor(LR_COLORS.panelInk),
        })
        .setOrigin(0.5);
      const dot = this.scene.add.circle(-pillW / 2, 0, dp(6), LR_COLORS.danger, 1);
      dot.setStrokeStyle(2, LR_COLORS.surface);
      badge.add([bg, label, dot]);
      this.add(badge);
      this.statusBadge = badge;
      this.statusDot = dot;
    }
    this.statusBadge.setVisible(true);
    this.statusDot?.setVisible(!connected);
  }

  /** Juice #5 payoff: emote bubble over the avatar (STYLE-GUIDE §5.5). */
  setBubbleSkin(skin: BubbleSkinId): void {
    this.bubbleSkin = skin;
  }

  /** Quick-chat phrase: LW-style speech bubble in the equipped skin. */
  async showPhrase(text: string): Promise<void> {
    if (this.bubbleOpen) return;
    this.bubbleOpen = true;
    const m = LR_MOTION.emote;
    const style = BUBBLE_STYLES[this.bubbleSkin];
    const bubble = this.scene.add.container(0, -this.radius - 56);
    const label = this.scene.add
      .text(0, -4, text, {
        fontFamily: 'Nunito, system-ui, sans-serif',
        fontSize: '21px',
        fontStyle: '800',
        color: style.text,
      })
      .setOrigin(0.5);
    const bw = Math.max(96, label.width + 40);
    const bh = 52;
    const g = this.scene.add.graphics();
    g.fillStyle(style.fill, 0.97);
    g.fillRoundedRect(-bw / 2, -4 - bh / 2, bw, bh, 18);
    g.fillTriangle(-10, bh / 2 - 7, 10, bh / 2 - 7, 0, bh / 2 + 8);
    g.lineStyle(3, style.stroke, 1);
    g.strokeRoundedRect(-bw / 2, -4 - bh / 2, bw, bh, 18);
    bubble.add([g, label]);
    this.add(bubble);
    if (reducedMotion()) {
      bubble.setAlpha(0);
      await tweenP(this.scene, { targets: bubble, alpha: 1, duration: 100 });
      await delayP(this.scene, m.holdMs);
      await tweenP(this.scene, { targets: bubble, alpha: 0, duration: 100 });
    } else {
      bubble.setScale(0);
      await tweenP(this.scene, {
        targets: bubble,
        scale: 1,
        duration: m.bubbleInMs,
        ease: 'Back.easeOut',
      });
      await delayP(this.scene, m.holdMs + 500);
      await tweenP(this.scene, { targets: bubble, alpha: 0, duration: m.fadeMs });
    }
    bubble.destroy();
    this.bubbleOpen = false;
  }

  async showEmote(emoji: string, artKey?: string): Promise<void> {
    if (this.bubbleOpen) return;
    this.bubbleOpen = true;
    const m = LR_MOTION.emote;
    const bubble = this.scene.add.container(0, -this.radius - 58);
    const bg = this.scene.add.image(0, 0, 'ui_bubble').setScale(0.7);
    if (this.bubbleSkin !== 'classic') bg.setTint(BUBBLE_STYLES[this.bubbleSkin].fill);
    const icon: Phaser.GameObjects.GameObject & { angle?: number } =
      artKey !== undefined && this.scene.textures.exists(artKey)
        ? this.scene.add.image(0, -8, artKey).setDisplaySize(dp(68), dp(68))
        : this.scene.add.text(0, -8, emoji, { fontSize: '40px' }).setOrigin(0.5);
    bubble.add([bg, icon]);
    this.add(bubble);

    if (reducedMotion()) {
      bubble.setAlpha(0);
      await tweenP(this.scene, { targets: bubble, alpha: 1, duration: 100 });
      await delayP(this.scene, m.holdMs);
      await tweenP(this.scene, { targets: bubble, alpha: 0, duration: 100 });
    } else {
      bubble.setScale(0);
      await tweenP(this.scene, {
        targets: bubble,
        scale: 1,
        duration: m.bubbleInMs,
        ease: 'Back.easeOut',
      });
      this.scene.tweens.add({
        targets: icon,
        angle: { from: -m.wiggleDeg, to: m.wiggleDeg },
        duration: 200,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
      });
      await delayP(this.scene, m.holdMs);
      await tweenP(this.scene, { targets: bubble, alpha: 0, duration: m.fadeMs });
    }
    bubble.destroy();
    this.bubbleOpen = false;
  }
}
