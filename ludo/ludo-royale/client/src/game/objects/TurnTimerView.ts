/**
 * Juice effect #6 — turn timer ring (STYLE-GUIDE §5.6). One Graphics object
 * redrawn per update (the sanctioned per-frame redraw), depleting clockwise.
 * Urgency colors are universal (green→amber→red) and override the player
 * color: the identity ring is the separate inner ring on the AvatarChip.
 */
import Phaser from 'phaser';
import { LR_COLORS, LR_MOTION, dp } from '../../theme/tokens';

export class TurnTimerView extends Phaser.GameObjects.Graphics {
  private readonly radius: number;

  constructor(scene: Phaser.Scene, radius: number) {
    super(scene);
    this.radius = radius;
  }

  /** fraction: remaining/total in [0,1]. Draws nothing when inactive. */
  draw(fraction: number): void {
    this.clear();
    if (fraction <= 0) return;
    const m = LR_MOTION.timer;
    const color =
      fraction > m.warnFrac
        ? LR_COLORS.success
        : fraction > m.dangerFrac
          ? LR_COLORS.warning
          : LR_COLORS.danger;
    const w = dp(m.strokeDp);
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * fraction; // depletes clockwise from 12
    // Faint full-circle track so the depleting arc reads as a real progress
    // ring around the avatar (a polished preloader, not a lone arc).
    this.lineStyle(w, LR_COLORS.hudInk, 0.22);
    this.beginPath();
    this.arc(0, 0, this.radius, 0, Math.PI * 2, false);
    this.strokePath();
    // Soft under-glow in the progress color for a candy feel.
    this.lineStyle(w + dp(4), color, 0.2);
    this.beginPath();
    this.arc(0, 0, this.radius, start, end, false);
    this.strokePath();
    // Crisp progress arc.
    this.lineStyle(w, color, 1);
    this.beginPath();
    this.arc(0, 0, this.radius, start, end, false);
    this.strokePath();
    // Leading bead at the arc tip — the modern spinner/preloader touch.
    const tx = Math.cos(end) * this.radius;
    const ty = Math.sin(end) * this.radius;
    this.fillStyle(0xffffff, 1);
    this.fillCircle(tx, ty, w * 0.72);
    this.fillStyle(color, 1);
    this.fillCircle(tx, ty, w * 0.46);
  }
}
