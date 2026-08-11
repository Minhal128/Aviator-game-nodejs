/**
 * Reusable celebration popup (ARTPASS-GAMEFEEL §5) — the 10-piece contract
 * for Results, Daily Bonus, level-ups and reward reveals: scrim, rotating
 * rays, radial glow, cream panel with gold frame + toy bevel, draped
 * red-gold ribbon with the title, a caller-populated content slot and
 * green/amber toy buttons. One modal at a time (callers own that rule).
 */
import Phaser from 'phaser';
import { DEPTH, GAME_H, GAME_W } from '../layout';
import { LR_ART, LR_BAKE_SCALE, LR_COLORS, cssColor, cssRgba, dp } from '../../theme/tokens';
import { makeCanvas, roundedRectPath } from '../textures/canvasKit';
import { reducedMotion } from '../fx/Juice';
import { Button } from './Button';
import type { ButtonStyle } from './Button';
import { gameText } from './text';
import { ensurePennant } from './toyBake';

export interface CelebrationAction {
  label: string;
  style: ButtonStyle;
  onTap: () => void;
}

export interface CelebrationConfig {
  title: string;
  /** Full theatre (rays + glow + pulsing primary) vs calm framed panel. */
  festive: boolean;
  width?: number;
  height?: number;
  /** First action is the "primary" — it gets the §5 attention pulse. */
  actions: readonly CelebrationAction[];
  /** Fills the hero/content slot; coords are panel-local, (0,0) = center. */
  populate?: (content: Phaser.GameObjects.Container, innerW: number, innerH: number) => void;
}

export class CelebrationPanel extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, cfg: CelebrationConfig) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(DEPTH.modal);
    const c = LR_ART.celebration;
    const panelW = cfg.width ?? 540;
    const panelH = cfg.height ?? 640;
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const reduced = reducedMotion();

    // 1. Scrim (blocks input behind the modal).
    const scrim = scene.add
      .rectangle(cx, cy, GAME_W, GAME_H, LR_COLORS.worldVignette, c.scrimAlpha)
      .setInteractive();
    scrim.setAlpha(0);
    this.add(scrim);
    scene.tweens.add({ targets: scrim, alpha: 1, duration: c.scrimMs });

    // 2-3. Rotating rays + breathing glow behind the panel (festive only).
    if (cfg.festive) {
      const rays = scene.add
        .image(cx, cy, 'fx_rays')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(LR_COLORS.gold300)
        .setAlpha(reduced ? c.reducedRaysAlpha : c.raysAlpha)
        .setScale(1.6);
      this.add(rays);
      const glow = scene.add
        .image(cx, cy, 'fx_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(LR_COLORS.gold500)
        .setAlpha(0.5)
        .setScale(3.4);
      this.add(glow);
      if (!reduced) {
        scene.tweens.add({ targets: rays, angle: 360, duration: c.raysMs, repeat: -1, ease: 'Linear' });
        scene.tweens.add({
          targets: glow,
          scale: { from: 3.4 * 0.95, to: 3.4 * 1.08 },
          duration: c.glowPulseMs,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    // 4. Cream body with gold frame, toy bevel and baked e4 shadow.
    const panel = scene.add.container(cx, cy);
    panel.add(
      scene.add
        .image(0, 0, ensureCelebrationBody(scene, panelW, panelH))
        .setScale(1 / LR_BAKE_SCALE),
    );

    // 6. Hero/content slot.
    const content = scene.add.container(0, 0);
    cfg.populate?.(content, panelW - dp(48), panelH - dp(160));
    panel.add(content);

    // 7. Action buttons (first = primary, green pulse guides the eye).
    const btnW = Math.min(420, panelW - dp(56));
    const btnH = 76;
    const gap = 16;
    const total = cfg.actions.length;
    const buttons: Button[] = [];
    cfg.actions.forEach((action, i) => {
      const y = panelH / 2 - dp(36) - (total - 1 - i) * (btnH + gap) - btnH / 2;
      const btn = new Button(scene, 0, y, btnW, btnH, action.label, action.style, action.onTap);
      panel.add(btn);
      buttons.push(btn);
    });
    const primary = buttons[0];
    if (primary && cfg.festive && !reduced) {
      scene.tweens.add({
        targets: primary,
        scale: c.primaryPulseScale,
        duration: c.primaryPulseMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.add(panel);

    // 5. Draped ribbon with the title, above the panel's top edge.
    const ribbon = buildRibbon(scene, cfg.title, panelW);
    ribbon.setPosition(cx, cy - panelH / 2 + dp(6));
    this.add(ribbon);

    // 9. Entrance choreography (§5.9) — reduced motion: quick fades.
    if (reduced) {
      panel.setAlpha(0);
      ribbon.setAlpha(0);
      scene.tweens.add({ targets: [panel, ribbon], alpha: 1, duration: 150 });
      return;
    }
    panel.setScale(0.9).setAlpha(0);
    scene.tweens.add({
      targets: panel,
      scale: 1,
      alpha: 1,
      duration: c.panelMs,
      ease: 'Back.easeOut',
    });
    const ribbonY = ribbon.y;
    ribbon.setY(ribbonY - dp(60)).setAlpha(0);
    scene.tweens.add({
      targets: ribbon,
      y: ribbonY,
      alpha: 1,
      delay: c.ribbonDelayMs,
      duration: c.panelMs,
      ease: 'Back.easeOut',
      onComplete: () => {
        // Micro-sway as it settles on its pin.
        scene.tweens.add({
          targets: ribbon,
          angle: { from: -1.2, to: 1.2 },
          duration: 340,
          yoyo: true,
          repeat: 1,
          ease: 'Sine.easeInOut',
          onComplete: () => ribbon.setAngle(0),
        });
      },
    });
    content.setScale(0);
    scene.tweens.add({
      targets: content,
      scale: { from: 0, to: 1 },
      delay: c.ribbonDelayMs + 80,
      duration: c.heroMs,
      ease: 'Back.easeOut',
    });
    buttons.forEach((btn, i) => {
      const targetY = btn.y;
      btn.setY(targetY + dp(24)).setAlpha(0);
      scene.tweens.add({
        targets: btn,
        y: targetY,
        alpha: 1,
        delay: c.ribbonDelayMs + 160 + i * c.btnStaggerMs,
        duration: 220,
        ease: 'Back.easeOut',
      });
    });
  }
}

/** Cream panel: e4 shadow, cream fill, gold gradient frame, toy bevel. */
function ensureCelebrationBody(scene: Phaser.Scene, w: number, h: number): string {
  const key = `celebration_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const S = LR_BAKE_SCALE;
  const pad = dp(56);
  const { ctx, texture } = makeCanvas(scene, key, (w + pad * 2) * S, (h + pad * 2) * S);
  const r = dp(28);

  // Baked e4 shadow via the offscreen-shape trick (device-pixel space).
  const off = (h + pad * 2) * S * 2;
  ctx.save();
  ctx.shadowColor = cssRgba(LR_COLORS.worldVignette, 0.5);
  ctx.shadowBlur = dp(40) * S;
  ctx.shadowOffsetY = off + dp(18) * S;
  roundedRectPath(ctx, pad * S, pad * S - off, w * S, h * S, r * S);
  ctx.fillStyle = cssColor(LR_COLORS.worldVignette);
  ctx.fill();
  ctx.restore();

  ctx.scale(S, S);
  ctx.translate(pad, pad);

  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.fillStyle = cssColor(LR_COLORS.sceneCream);
  ctx.fill();

  // Toy bevel on cream (light lip up, warm dark lip down).
  ctx.save();
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.clip();
  const lipLight = ctx.createLinearGradient(0, 0, 0, h);
  lipLight.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  lipLight.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = lipLight;
  ctx.lineWidth = dp(2) * 2;
  ctx.stroke();
  const lipDark = ctx.createLinearGradient(0, 0, 0, h);
  lipDark.addColorStop(0.6, cssRgba(LR_COLORS.gold700, 0));
  lipDark.addColorStop(1, cssRgba(LR_COLORS.gold700, 0.25));
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = lipDark;
  ctx.lineWidth = dp(3) * 2;
  ctx.stroke();
  ctx.restore();

  // Gold gradient frame.
  const frame = ctx.createLinearGradient(0, 0, 0, h);
  frame.addColorStop(0, cssColor(LR_COLORS.gold300));
  frame.addColorStop(1, cssColor(LR_COLORS.gold700));
  roundedRectPath(ctx, 1.5, 1.5, w - 3, h - 3, r - 1);
  ctx.strokeStyle = frame;
  ctx.lineWidth = dp(3);
  ctx.stroke();

  texture.refresh();
  return key;
}

/** §5.5 header ribbon: red-gold band with V-tails draped over the panel. */
function buildRibbon(scene: Phaser.Scene, title: string, panelW: number): Phaser.GameObjects.Container {
  const bandW = panelW + dp(16) * 2 + dp(18) * 2;
  const bandH = dp(64);
  const overhang = dp(16) + dp(18);
  const key = ensurePennant(scene, `celebration_ribbon_${bandW}`, {
    w: bandW,
    h: bandH,
    notch: dp(18),
    tails: 'both',
    gradTop: LR_COLORS.sceneRibbonRed,
    gradBottom: LR_COLORS.sceneRibbonRedDk,
    goldPinstripes: true,
    folds: [overhang, bandW - overhang - dp(12)],
  });
  const ribbon = scene.add.container(0, 0);
  ribbon.add(scene.add.image(0, 0, key).setScale(1 / LR_BAKE_SCALE));
  // -4 = the baked fold strip below the band shifts the visual center up.
  const label = gameText(scene, 0, -4, title, 30, {
    strokeColor: LR_COLORS.sceneRibbonInk,
  });
  label.setStroke(cssColor(LR_COLORS.sceneRibbonInk), dp(4));
  ribbon.add(label);
  return ribbon;
}
