/**
 * One pawn on the board: baked pawn sprite + independent soft shadow +
 * selection glow ring. Implements juice effect #2 (hop with squash-stretch,
 * STYLE-GUIDE §5.2), the selectable pulse (§4 states) and its half of the
 * capture combo (knockback flight, §5.3).
 */
import { sfx } from '../../core/audio';
import Phaser from 'phaser';
import type { PlayerColor, Seat } from '@ludo/shared';
import { BASE_STEPS } from '@ludo/shared';
import type { XY } from '../boardMap';
import { DEPTH, GAME_H } from '../layout';
import { LR_BAKE_SCALE, LR_MOTION, LR_PLAYERS, dp } from '../../theme/tokens';
import type { FxLayer } from '../fx/FxLayer';
import { reducedMotion, tweenP } from '../fx/Juice';

// Cell-proportioned pawn (Jose tuning round 2: 0.74 read too small once
// the board grew to CELL 47) - 0.8 of the bake, ~79% of a cell wide.
const PAWN_SCALE = (1 / LR_BAKE_SCALE) * 0.8;
/** Jose: "mucha sombra tiene el peon" - keep it minimal. */
const SHADOW_SCALE = 0.55;
const SHADOW_ALPHA = 0.4;
const HOME_PARK_SCALE = 0.6;

export class PieceView extends Phaser.GameObjects.Container {
  readonly seat: Seat;
  readonly pieceId: number;
  readonly color: PlayerColor;
  /** Mirror of the engine's color-relative position, for stack layout. */
  steps: number = BASE_STEPS;

  private readonly pawn: Phaser.GameObjects.Image;
  private readonly shadowImg: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly hitRect: Phaser.Geom.Rectangle;
  private pulses: Phaser.Tweens.Tween[] = [];
  private anchor: XY;
  private dome?: Phaser.GameObjects.Image;
  private ice?: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    pos: XY,
    seat: Seat,
    pieceId: number,
    color: PlayerColor,
    onTap: (piece: PieceView) => void,
    textureKey?: string,
  ) {
    super(scene, pos.x, pos.y);
    scene.add.existing(this);
    this.seat = seat;
    this.pieceId = pieceId;
    this.color = color;
    this.anchor = pos;

    this.shadowImg = scene.add.image(0, 4, 'piece_shadow').setScale(SHADOW_SCALE).setAlpha(SHADOW_ALPHA);
    this.glow = scene.add
      .image(0, -dp(30), 'fx_ring')
      .setScale(0.55)
      .setAlpha(0)
      .setTint(LR_PLAYERS[color].mid)
      .setBlendMode(Phaser.BlendModes.ADD);
    // Origin near the base so the body rises above the cell (3D read, §4).
    this.pawn = scene.add
      .image(0, 0, textureKey ?? `piece_${color}`)
      .setOrigin(0.5, 0.9)
      .setScale(PAWN_SCALE);
    this.add([this.shadowImg, this.glow, this.pawn]);

    this.hitRect = new Phaser.Geom.Rectangle(-dp(35), -dp(80), dp(70), dp(96));
    this.setInteractive(this.hitRect, Phaser.Geom.Rectangle.Contains);
    this.disableInteractive();
    this.on(Phaser.Input.Events.POINTER_DOWN, () => onTap(this));

    this.syncDepth();
  }

  /** Selectable pulse: bob ±6dp + scale 1.0↔1.06 + color ring glow (§4). */
  setSelectable(on: boolean, strong = false): void {
    this.clearPulses();
    if (!on) {
      this.glow.setAlpha(0);
      this.pawn.setScale(PAWN_SCALE).setY(0);
      this.disableInteractive();
      return;
    }
    // Re-attach with the stored hit area — safe on every Phaser version.
    this.setInteractive(this.hitRect, Phaser.Geom.Rectangle.Contains);
    if (reducedMotion()) {
      this.glow.setAlpha(strong ? 1 : 0.8);
      return;
    }
    const m = LR_MOTION.selectable;
    this.glow.setAlpha(strong ? 1 : 0.7);
    this.pulses.push(
      this.scene.tweens.add({
        targets: this.pawn,
        scaleX: PAWN_SCALE * m.scaleMax,
        scaleY: PAWN_SCALE * m.scaleMax,
        y: -dp(m.bobDp),
        duration: m.pulseMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
      this.scene.tweens.add({
        targets: this.glow,
        alpha: strong ? 0.55 : 0.35,
        duration: m.pulseMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }),
    );
  }

  /** Juice #2: hop cell by cell; full squash only on the final landing. */
  async moveAlong(points: XY[], fx: FxLayer): Promise<void> {
    this.clearPulses();
    this.glow.setAlpha(0);
    const last = points[points.length - 1];

    if (reducedMotion()) {
      if (last) {
        sfx('step');
        await tweenP(this.scene, {
          targets: this,
          x: last.x,
          y: last.y,
          duration: LR_MOTION.hop.reducedSlideMs,
          ease: 'Cubic.easeInOut',
        });
        this.anchor = last;
      }
      this.syncDepth();
      return;
    }

    const m = LR_MOTION.hop;
    const hopH = dp(m.heightDp);
    // Lift: slight grow, shadow shrinks/dims while airborne (§5.2).
    this.pawn.setScale(PAWN_SCALE * m.liftScale);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p) continue;
      // One footstep per cell crossed — the walk is audible, not just visual.
      sfx('step', i);
      const final = i === points.length - 1;
      await Promise.all([
        tweenP(this.scene, {
          targets: this,
          x: p.x,
          y: p.y,
          duration: m.perCellMs,
          ease: 'Linear',
        }),
        (async () => {
          await tweenP(this.scene, {
            targets: this.pawn,
            y: -hopH,
            duration: m.perCellMs / 2,
            ease: 'Sine.easeInOut',
          });
          await tweenP(this.scene, {
            targets: this.pawn,
            y: 0,
            duration: m.perCellMs / 2,
            ease: 'Sine.easeInOut',
          });
        })(),
        tweenP(this.scene, {
          targets: this.shadowImg,
          scaleX: SHADOW_SCALE * 0.7,
          scaleY: SHADOW_SCALE * 0.7,
          alpha: SHADOW_ALPHA * 0.6,
          duration: m.perCellMs / 2,
          yoyo: true,
          ease: 'Sine.easeInOut',
        }),
      ]);
      fx.emitTrail(p.x, p.y + 6, LR_PLAYERS[this.color].mid);
      const squash = final
        ? this.squash(m.finalSquashX, m.finalSquashY, m.landSquashMs)
        : this.squash(m.midSquashX, m.midSquashY, m.landSquashMs);
      if (final) await squash;
    }
    this.shadowImg.setScale(SHADOW_SCALE).setAlpha(SHADOW_ALPHA);
    if (last) this.anchor = last;
    this.syncDepth();
  }

  /** Finished piece parks small inside the medallion (§4 states). */
  async parkHome(pos: XY, fx: FxLayer): Promise<void> {
    fx.emitBurst(this.x, this.y - dp(20), LR_PLAYERS[this.color].mid, 8);
    await tweenP(this.scene, {
      targets: this,
      x: pos.x,
      y: pos.y,
      duration: reducedMotion() ? LR_MOTION.reducedFadeMs : 200,
      ease: 'Cubic.easeOut',
    });
    this.pawn.setScale(PAWN_SCALE * HOME_PARK_SCALE);
    this.shadowImg.setAlpha(SHADOW_ALPHA * 0.7).setScale(SHADOW_SCALE * 0.7);
    this.anchor = pos;
    this.setDepth(DEPTH.pieces + 2);
  }

  /** Victim half of juice #3: pop + spin + arc home + plop (§5.3). */
  async captureFlight(baseX: number, baseY: number): Promise<void> {
    this.clearPulses();
    this.glow.setAlpha(0);
    const m = LR_MOTION.capture;
    this.steps = BASE_STEPS;

    if (reducedMotion()) {
      await tweenP(this.scene, { targets: this, alpha: 0, duration: m.reducedMs / 2 });
      this.setPosition(baseX, baseY);
      this.anchor = { x: baseX, y: baseY };
      await tweenP(this.scene, { targets: this, alpha: 1, duration: m.reducedMs / 2 });
      this.syncDepth();
      return;
    }

    await tweenP(this.scene, {
      targets: this.pawn,
      scaleX: PAWN_SCALE * m.victimPopScale,
      scaleY: PAWN_SCALE * m.victimPopScale,
      duration: m.victimPopMs,
      ease: 'Back.easeOut',
    });
    await Promise.all([
      tweenP(this.scene, {
        targets: this,
        x: baseX,
        y: baseY,
        duration: m.victimFlightMs,
        ease: 'Cubic.easeIn',
      }),
      tweenP(this.scene, {
        targets: this.pawn,
        angle: m.victimSpinDeg,
        scaleX: PAWN_SCALE * m.victimShrink,
        scaleY: PAWN_SCALE * m.victimShrink,
        duration: m.victimFlightMs,
        ease: 'Linear',
      }),
      tweenP(this.scene, {
        targets: this,
        alpha: 0,
        delay: m.victimFlightMs / 2,
        duration: m.victimFlightMs / 2,
        ease: 'Quad.easeIn',
      }),
    ]);
    // Reappear in the yard slot with a plop.
    this.pawn.setAngle(0).setScale(0);
    this.setAlpha(1);
    this.anchor = { x: baseX, y: baseY };
    await tweenP(this.scene, {
      targets: this.pawn,
      scaleX: PAWN_SCALE,
      scaleY: PAWN_SCALE,
      duration: m.plopMs,
      ease: 'Back.easeOut',
    });
    this.syncDepth();
  }

  /** POWER shield: translucent dome over the pawn while immune. */
  setShielded(on: boolean): void {
    if (on === (this.dome !== undefined)) return;
    if (!on) {
      this.dome?.destroy();
      this.dome = undefined;
      return;
    }
    this.dome = this.scene.add.image(0, -dp(26), 'fx_dome').setAlpha(0);
    this.add(this.dome);
    this.scene.tweens.add({
      targets: this.dome,
      alpha: 1,
      scale: { from: 0.4, to: 1 },
      duration: reducedMotion() ? LR_MOTION.reducedFadeMs : 220,
      ease: 'Back.easeOut',
    });
  }

  get isDomeOn(): boolean {
    return this.dome !== undefined;
  }

  /** POWER freeze: translucent ice block while the piece sits out a turn. */
  setFrozen(on: boolean): void {
    if (on === (this.ice !== undefined)) return;
    if (!on) {
      const ice = this.ice;
      this.ice = undefined;
      if (!ice) return;
      this.scene.tweens.add({
        targets: ice,
        alpha: 0,
        scale: 0.6,
        duration: reducedMotion() ? LR_MOTION.reducedFadeMs : 180,
        ease: 'Quad.easeIn',
        onComplete: () => ice.destroy(),
      });
      return;
    }
    this.ice = this.scene.add.image(0, -dp(28), 'fx_ice').setAlpha(0);
    this.add(this.ice);
    this.scene.tweens.add({
      targets: this.ice,
      alpha: 1,
      scale: { from: 1.3, to: 1 },
      duration: reducedMotion() ? LR_MOTION.reducedFadeMs : 240,
      ease: 'Back.easeOut',
    });
  }

  /** Formation offset + shrink when several pieces share a cell. */
  applyStackOffset(off: XY, scaleMul: number): void {
    this.setPosition(this.anchor.x + off.x, this.anchor.y + off.y);
    if (this.steps < 57) {
      this.pawn.setScale(PAWN_SCALE * scaleMul);
      this.shadowImg.setScale(SHADOW_SCALE * scaleMul);
    }
    this.syncDepth();
  }

  /** Instant relocation (forfeit resync) — no animation by design. */
  snapTo(pos: XY, steps: number): void {
    this.steps = steps;
    this.anchor = pos;
    this.setPosition(pos.x, pos.y);
    this.syncDepth();
  }

  get anchorXY(): XY {
    return this.anchor;
  }

  private squash(sx: number, sy: number, ms: number): Promise<void> {
    this.pawn.setScale(PAWN_SCALE * sx, PAWN_SCALE * sy);
    return tweenP(this.scene, {
      targets: this.pawn,
      scaleX: PAWN_SCALE,
      scaleY: PAWN_SCALE,
      duration: ms,
      ease: 'Back.easeOut',
    });
  }

  private clearPulses(): void {
    for (const tw of this.pulses) tw.stop();
    this.pulses = [];
  }

  private syncDepth(): void {
    // Lower pieces render in front for the pseudo-3D read.
    this.setDepth(DEPTH.pieces + this.y / GAME_H);
  }
}
