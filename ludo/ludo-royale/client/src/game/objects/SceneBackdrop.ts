/**
 * Layered candy-violet stage behind every scene (ARTPASS-GAMEFEEL §1,
 * re-painted by LUDOWORLD-PARITY §1):
 *  - baked `world_sky` (gradient, glow, dim stars, far skyline, floor) — or
 *    the §8 `art_home_bg` full-bleed PNG when it shipped (Home only)
 *  - live twinkle stars — driven from ONE update hook, zero tweens, so the
 *    §3 tween budget stays for the foreground
 *  - near skyline sprite with the pulsing beacon (+ parallax, Home only)
 *  - slow-falling ambient confetti (LUDOWORLD-PARITY §1.4, Home only, also
 *    update-driven so it costs zero tweens)
 *  - floating decorative pawns/dice (Home only, behind everything readable)
 *  - occasional shooting star (Home only)
 * Reduced motion: the baked scene stays (it is ambience, not motion) but
 * every loop freezes to a static pose and the confetti hides.
 * Perf lite (UX sprint §2, core/perf.ts): low-end devices trim the ambient
 * inventory — fewer twinkles, no confetti, fewer floating pieces, no
 * parallax — while the baked backdrop itself stays (it costs one draw).
 */
import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../layout';
import { LR_ART, LR_COLORS, dp } from '../../theme/tokens';
import { perfTweaks } from '../../core/perf';
import { mulberry32 } from '../textures/canvasKit';
import {
  CITY_BEACON_X,
  CITY_BEACON_Y,
  CITY_NEAR_H,
  CITY_NEAR_W,
} from '../textures/bakeScene';
import { reducedMotion } from '../fx/Juice';

export type BackdropMode = 'home' | 'game';

interface TwinkleStar {
  img: Phaser.GameObjects.Image;
  phase: number;
  /** rad/ms — derived from the §1 random 1800–3200ms period. */
  speed: number;
  baseScale: number;
}

/** LUDOWORLD-PARITY §1.4 confetti bit — moved from the one update hook. */
interface ConfettiBit {
  img: Phaser.GameObjects.Image;
  /** Drift center; the live x oscillates around it. */
  x0: number;
  /** px/ms fall speed (random 9000–14000ms per screen). */
  fall: number;
  driftAmp: number;
  /** rad/ms of the sine drift. */
  driftFreq: number;
  /** deg/ms spin (±180° over one fall). */
  spin: number;
  phase: number;
}

const GROUND_Y = 0.62 * GAME_H;

export class SceneBackdrop {
  private readonly scene: Phaser.Scene;
  private readonly stars: TwinkleStar[] = [];
  private readonly confetti: ConfettiBit[] = [];
  private readonly beacon: Phaser.GameObjects.Image;
  private shootingStar?: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, mode: BackdropMode) {
    this.scene = scene;
    const s = LR_ART.scene;

    // §8 slot: a shipped full-bleed home background replaces the baked sky.
    const artBg = mode === 'home' && scene.textures.exists('art_home_bg');
    scene.add
      .image(GAME_W / 2, GAME_H / 2, artBg ? 'art_home_bg' : 'world_sky')
      .setDisplaySize(GAME_W, GAME_H)
      .setDepth(-10);

    // Near skyline + beacon in one container so parallax moves both.
    // The shipped art bg paints its own skyline — stacking the procedural
    // one on top reads as a double city, so it stays hidden there.
    const city = scene.add.container(GAME_W / 2, GROUND_Y + 2).setDepth(-9.2);
    city.add(scene.add.image(0, 0, 'world_city_near').setOrigin(0.5, 1));
    this.beacon = scene.add
      .image(CITY_BEACON_X - CITY_NEAR_W / 2, CITY_BEACON_Y - CITY_NEAR_H, 'fx_dot')
      .setTint(LR_COLORS.sceneBeacon)
      .setScale(0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    city.add(this.beacon);
    if (artBg) city.setVisible(false);
    const tweaks = perfTweaks(); // §2 lite preset on low-end devices
    if (mode === 'home' && !reducedMotion() && tweaks.parallax && !artBg) {
      scene.tweens.add({
        targets: city,
        x: { from: GAME_W / 2 - s.parallaxPx, to: GAME_W / 2 + s.parallaxPx },
        duration: s.parallaxMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.buildTwinkles(mode === 'home' ? tweaks.twinkleHome : s.twinkleGame);

    if (mode === 'home' && !reducedMotion()) {
      if (tweaks.confetti) this.buildConfetti();
      this.buildFloatingDecor(tweaks.floatingDecor);
      this.scheduleShootingStar();
    }

    // One cheap update hook drives twinkle + beacon (never per-star tweens).
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    });
  }

  private buildTwinkles(count: number): void {
    const s = LR_ART.scene;
    const rand = mulberry32(0xa11ce);
    for (let i = 0; i < count; i++) {
      const x = 30 + rand() * (GAME_W - 60);
      const y = (0.05 + rand() * 0.46) * GAME_H;
      const gold = rand() < 0.25;
      const baseScale = 0.55 + rand() * 0.65;
      const periodMs = s.twinkleMinMs + rand() * (s.twinkleMaxMs - s.twinkleMinMs);
      const img = this.scene.add
        .image(x, y, 'fx_star4')
        .setDepth(-9.5)
        .setTint(gold ? LR_COLORS.sceneStarGold : LR_COLORS.sceneStar)
        .setScale(baseScale * 0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.stars.push({
        img,
        phase: rand() * Math.PI * 2,
        speed: (Math.PI * 2) / periodMs,
        baseScale: baseScale * 0.5,
      });
    }
  }

  /**
   * LUDOWORLD-PARITY §1.4 — home-only confetti drifting down the sky, layer
   * 0.85 (between the near skyline and the floating pieces). Update-driven
   * like the twinkles: zero tweens, and it hides under reduced motion.
   */
  private buildConfetti(): void {
    const c = LR_ART.confetti;
    const tints: readonly number[] = [
      LR_COLORS.confettiPink,
      LR_COLORS.confettiGold,
      LR_COLORS.confettiCyan,
      LR_COLORS.confettiViolet,
    ];
    for (let i = 0; i < c.count; i++) {
      const fallMs = c.fallMinMs + Math.random() * (c.fallMaxMs - c.fallMinMs);
      const x0 = 20 + Math.random() * (GAME_W - 40);
      const img = this.scene.add
        .image(x0, -20 - Math.random() * GAME_H, 'fx_confetti')
        .setDepth(-9.15)
        .setTint(tints[i % tints.length] ?? LR_COLORS.confettiPink)
        .setAlpha(c.alphaMin + Math.random() * (c.alphaMax - c.alphaMin))
        .setAngle(Math.random() * 360);
      img.setDisplaySize(c.wPx, c.hPx);
      this.confetti.push({
        img,
        x0,
        fall: (GAME_H + 60) / fallMs,
        driftAmp: c.driftPx * (0.5 + Math.random() * 0.5),
        driftFreq: (Math.PI * 2) / (fallMs / 2),
        spin: (c.spinDeg / fallMs) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /**
   * §1 layer 0.9: pawns + a die adrift in the sky, far behind the CTAs.
   * `count` comes from the perf preset (full 5 → lite 2).
   */
  private buildFloatingDecor(count: number): void {
    const s = LR_ART.scene;
    const rand = mulberry32(0xf10a7);
    const decor: { key: string; x: number; y: number; scale: number }[] = [
      { key: 'piece_red', x: 92, y: 236, scale: 0.34 },
      { key: 'piece_blue', x: 636, y: 188, scale: 0.3 },
      { key: 'piece_green', x: 604, y: 452, scale: 0.36 },
      { key: 'piece_yellow', x: 104, y: 508, scale: 0.28 },
      { key: 'dice_face_5', x: 356, y: 132, scale: 0.22 },
    ];
    for (const d of decor.slice(0, count)) {
      const img = this.scene.add
        .image(d.x, d.y, d.key)
        .setDepth(-9.1)
        .setScale(d.scale)
        .setAlpha(0.1 + rand() * 0.06)
        .setTint(LR_COLORS.textFaint); // atmospheric push-back, existing token
      this.scene.tweens.add({
        targets: img,
        y: d.y - s.floatDriftPx,
        x: d.x + (rand() < 0.5 ? -6 : 6),
        duration: s.floatMinMs + rand() * (s.floatMaxMs - s.floatMinMs),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.scene.tweens.add({
        targets: img,
        angle: { from: -s.floatTiltDeg, to: s.floatTiltDeg },
        duration: s.floatTiltMs,
        delay: rand() * 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** §1 layer 0.5 extra: a lone dot streaks the upper third every 12–20s. */
  private scheduleShootingStar(): void {
    const s = LR_ART.scene;
    const delay = s.shootMinDelayMs + Math.random() * (s.shootMaxDelayMs - s.shootMinDelayMs);
    this.scene.time.delayedCall(delay, () => {
      if (!reducedMotion()) this.fireShootingStar();
      this.scheduleShootingStar();
    });
  }

  private fireShootingStar(): void {
    const s = LR_ART.scene;
    if (!this.shootingStar) {
      this.shootingStar = this.scene.add
        .image(0, 0, 'fx_dot')
        .setDepth(-9.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(3, 0.5)
        .setAngle(24)
        .setAlpha(0)
        .setVisible(false);
    }
    const star = this.shootingStar;
    const sx = 80 + Math.random() * (GAME_W - 300);
    const sy = 60 + Math.random() * (GAME_H * 0.22);
    star.setPosition(sx, sy).setVisible(true);
    this.scene.tweens.add({
      targets: star,
      x: sx + dp(260),
      y: sy + dp(120),
      duration: s.shootMs,
      ease: 'Quad.easeOut',
      onComplete: () => star.setVisible(false),
    });
    this.scene.tweens.add({
      targets: star,
      alpha: { from: 0, to: 0.8 },
      duration: s.shootMs / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });
  }

  private onUpdate(_time: number, delta: number): void {
    const now = this.scene.time.now;
    if (reducedMotion()) {
      for (const st of this.stars) {
        st.img.setAlpha(0.5).setScale(st.baseScale);
      }
      for (const bit of this.confetti) bit.img.setVisible(false);
      this.beacon.setAlpha(0.8);
      return;
    }
    for (const st of this.stars) {
      const wave = (Math.sin(now * st.speed + st.phase) + 1) / 2;
      st.img.setAlpha(0.35 + wave * 0.65);
      st.img.setScale(st.baseScale * (0.9 + wave * 0.2));
    }
    // §1.4 confetti: fall + sine drift + slow spin, respawn at the top.
    for (const bit of this.confetti) {
      bit.img.setVisible(true);
      bit.img.y += bit.fall * delta;
      bit.img.x = bit.x0 + Math.sin(now * bit.driftFreq + bit.phase) * bit.driftAmp;
      bit.img.angle += bit.spin * delta;
      if (bit.img.y > GAME_H + 20) {
        bit.img.y = -20 - Math.random() * 60;
        bit.x0 = 20 + Math.random() * (GAME_W - 40);
      }
    }
    const beaconWave = (Math.sin((now * Math.PI * 2) / LR_ART.scene.beaconMs) + 1) / 2;
    this.beacon.setAlpha(0.3 + beaconWave * 0.7);
  }
}
