/**
 * SplashScene — the Ludo-World-style loading screen (SPLASH pass), and the
 * home of the whole boot pipeline (it replaces PreloadScene):
 *
 *  - deep violet-navy gradient bg (darker than Home) + vignette + faint stars
 *  - top: the LUDO/ROYALE lockup (procedural gameText, or the §8 `art_logo`
 *    PNG when the manifest ships one) bouncing in with a shine sweep
 *  - center: circular badge (gold rim, mini 4-quadrant board) wrapped by a
 *    REAL progress ring + "{pct}% loaded" label
 *  - bottom: a diorama (tilted toy board, 4 face pawns, 2 dice) with slow
 *    gold rays fanning out behind it, plus sparse ambient confetti
 *
 * The % is honest: it advances per weighted boot task — art manifest slots
 * (15%), the five procedural bakes (16% each = 80%), then fonts (5%) — while
 * a 1.2s minimum keeps the splash appreciable on instant loads (the shown
 * value is min(realProgress, elapsed/minMs), so slow networks still gate it).
 * The bakes run inside the splash exactly as before, one per frame, so the
 * ring stays responsive. At 100%: badge pop, 300ms fade, Home.
 *
 * Reduced motion: no rays/confetti/bounce/shine/pop — static composition,
 * a live ring (it is information, not decoration) and a short simple fade.
 *
 * LUDOWORLD-PARITY §8 still applies: the light manifest at
 * `assets/art/manifest.json` maps slot texture keys to PNG files; every
 * listed file loads under its slot key BEFORE the bakes run, and since each
 * baker starts with `textures.exists(key)` the shipped PNG wins while a
 * missing/failed file silently falls back to the procedural texture.
 */
import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../layout';
import {
  LR_ART,
  LR_BAKE_SCALE,
  LR_COLORS,
  LR_EASE,
  LR_MOTION,
  LR_PLAYERS,
  cssColor,
  cssRgba,
  dp,
} from '../../theme/tokens';
import { t } from '../../i18n';
import { bakeBoard, bakeBoardCrown, bakeDice, bakeFx, bakePieces, bakePowers, bakeScene, bakeShopPreviews } from '../textures';
import { PAWN_H, PAWN_W } from '../textures/bakePieces';
import { makeCanvas, mulberry32, roundedRectPath, starPath } from '../textures/canvasKit';
import { reducedMotion } from '../fx/Juice';
import { gameText, uiText } from '../ui/text';

/**
 * §8 slot whitelist — the only keys the manifest may claim, so stray
 * manifest entries can never clobber core baked textures (board, sky, fx).
 */
const ART_SLOTS: readonly string[] = [
  'art_card_online',
  'art_card_cpu',
  'art_card_local',
  'piece_red',
  'piece_green',
  'piece_yellow',
  'piece_blue',
  'dice_rich_a',
  'dice_rich_b',
  'coin_gold',
  'gem_violet',
  'art_coin_stack',
  'art_chest',
  'art_mascot',
  'nav_friends',
  'nav_ranking',
  'nav_invite',
  'nav_mission',
  'nav_backpack',
  'nav_shop',
  'art_home_bg',
  'art_logo',
  'art_daily_bow',
  'art_avatar_robot',
  'art_reward_chest',
  'art_reward_sack',
  'art_emoji_01',
  'art_emoji_02',
  'art_emoji_03',
  'art_emoji_04',
  'art_emoji_05',
  'art_emoji_06',
  'art_emoji_07',
  'art_emoji_08',
];

/** Vertical anchors of the three splash bands (720×1280 logical). */
const LOGO_Y = 268;
const BADGE_Y = 624;
const DIORAMA_Y = 1010;

/** One weighted boot step; `after` reveals art that exists once it is done. */
interface SplashTask {
  weight: number;
  run: (done: () => void) => void;
  after?: () => void;
}

/** Ambient confetti bit (same update-driven mechanics as SceneBackdrop). */
interface ConfettiBit {
  img: Phaser.GameObjects.Image;
  x0: number;
  fall: number;
  driftAmp: number;
  driftFreq: number;
  spin: number;
  phase: number;
}

export class SplashScene extends Phaser.Scene {
  private doneUnits = 0;
  private totalUnits = 1;
  private startedAt = 0;
  private shownPct = -1;
  private finished = false;
  private showpiecesBuilt = false;
  private logoRoot?: Phaser.GameObjects.Container;
  private logoShine?: Phaser.GameObjects.Image;
  private logoReach = 170;
  private badge?: Phaser.GameObjects.Container;
  private ringG?: Phaser.GameObjects.Graphics;
  private pctText?: Phaser.GameObjects.Text;
  private confetti: ConfettiBit[] = [];

  constructor() {
    super('Splash');
  }

  preload(): void {
    // One request total when no art shipped: a missing manifest just fails
    // this single json load and every slot keeps its procedural fallback.
    this.load.json('art_manifest', 'assets/art/manifest.json');
  }

  create(): void {
    // Phaser reuses scene instances: reset last visit's state.
    this.doneUnits = 0;
    this.shownPct = -1;
    this.finished = false;
    this.showpiecesBuilt = false;
    this.logoRoot = undefined;
    this.logoShine = undefined;
    this.badge = undefined;
    this.confetti = [];
    this.startedAt = this.time.now;

    this.cameras.main.setBackgroundColor(cssColor(LR_COLORS.splashBottom));
    this.add.image(GAME_W / 2, GAME_H / 2, ensureSplashSky(this)).setDepth(-10);
    this.buildBadge();
    this.startTasks();
  }

  override update(_time: number, delta: number): void {
    this.driveConfetti(delta); // keeps drifting through the pop + fade
    if (this.finished) return;
    const sp = LR_ART.splash;
    const real = this.doneUnits / this.totalUnits;
    const timed = Math.min(1, (this.time.now - this.startedAt) / sp.minMs);
    // Both gates must open: real work done AND the minimum splash time.
    const shown = Math.min(real, timed);
    const pct = Math.round(shown * 100);
    if (pct !== this.shownPct) {
      this.shownPct = pct;
      this.drawRing(shown);
      this.pctText?.setText(t('loading.pct', { pct }));
    }
    if (shown >= 1) this.finish();
  }

  // ------------------------------------------------------------------ tasks

  /**
   * Weighted boot pipeline. Order matters twice: manifest slots must land
   * BEFORE the bakes (§8 — shipped PNGs win because bakers early-out on
   * existing keys), and the bakes must all land before the diorama builds
   * (it is made of baked textures). One task per frame keeps the ring live.
   */
  private startTasks(): void {
    const bakeStep =
      (bake: (scene: Phaser.Scene) => void): SplashTask['run'] =>
      (done) => {
        bake(this);
        done();
      };
    const tasks: readonly SplashTask[] = [
      {
        weight: 15,
        run: (done) => this.loadArtSlots(done),
        after: () => {
          normalizePieceArt(this);
          this.buildLogo();
        },
      },
      { weight: 16, run: bakeStep(bakeScene) },
      {
        weight: 16,
        run: (done) => {
          bakeFx(this);
          bakePowers(this); // POWER tokens + shield dome ride the fx step
          done();
        },
      },
      { weight: 16, run: bakeStep(bakePieces) },
      { weight: 16, run: bakeStep(bakeDice) },
      { weight: 16, run: bakeStep(bakeBoard), after: () => this.buildShowpieces() },
      // Shop/backpack preview tiles — AFTER pieces exist (they composite them).
      { weight: 4, run: bakeStep(bakeShopPreviews) },
      { weight: 5, run: (done) => void document.fonts.ready.then(() => done()) },
    ];
    this.totalUnits = tasks.reduce((sum, task) => sum + task.weight, 0);
    const runFrom = (i: number): void => {
      const task = tasks[i];
      if (!task) return; // real progress is 1 — update() drives the finish
      // Yield a frame between steps so the ring/label actually repaint.
      this.time.delayedCall(10, () => {
        task.run(() => {
          this.doneUnits += task.weight;
          task.after?.();
          runFrom(i + 1);
        });
      });
    };
    runFrom(0);
  }

  /**
   * §8: queue every manifest-listed PNG under its slot key, then continue
   * into the bakes. A listed-but-missing file only logs a loader warning and
   * never lands as a texture, so the procedural fallback still applies.
   */
  private loadArtSlots(done: () => void): void {
    const raw: unknown = this.cache.json.exists('art_manifest')
      ? this.cache.json.get('art_manifest')
      : undefined;
    if (typeof raw !== 'object' || raw === null) {
      done();
      return;
    }
    const manifest = raw as Record<string, unknown>;
    let queued = 0;
    for (const key of ART_SLOTS) {
      const file = manifest[key];
      if (typeof file === 'string' && file !== '' && !this.textures.exists(key)) {
        this.load.image(key, `assets/art/${file}`);
        queued++;
      }
    }
    if (queued === 0) {
      done();
      return;
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, done);
    this.load.start();
  }

  // ------------------------------------------------------------------- logo

  /**
   * Top lockup — built right after the manifest task so the §8 `art_logo`
   * PNG wins when it shipped; otherwise a procedural two-line gameText
   * lockup: "LUDO" huge with a gold→red gradient fill and brown outline,
   * "ROYALE" gold underneath (words derive from app.title — no hardcopy).
   */
  private buildLogo(): void {
    const sp = LR_ART.splash;
    const root = this.add.container(GAME_W / 2, LOGO_Y);
    this.logoRoot = root;
    if (this.textures.exists('art_logo')) {
      const img = this.add.image(0, 0, 'art_logo');
      const fit = Math.min(540 / img.width, 300 / img.height);
      if (fit < 1) img.setScale(fit);
      root.add(img);
      this.logoReach = img.displayWidth / 2;
    } else {
      const words = t('app.title').toUpperCase().split(' ');
      const top = words[0] ?? '';
      const rest = words.slice(1).join(' ');
      const hero = gameText(this, 0, -36, top, 118, {
        tint: [
          LR_COLORS.gold300,
          LR_COLORS.gold300,
          LR_COLORS.sceneRibbonRed,
          LR_COLORS.sceneRibbonRed,
        ],
        strokeColor: LR_COLORS.titleStrokeBrown,
      });
      root.add(hero);
      this.logoReach = hero.width / 2;
      if (rest !== '') {
        root.add(
          gameText(this, 0, 58, rest, 52, {
            tint: [LR_COLORS.gold300, LR_COLORS.gold300, LR_COLORS.gold500, LR_COLORS.gold500],
            strokeColor: LR_COLORS.titleStrokeBrown,
          }),
        );
      }
    }
    if (reducedMotion()) {
      root.setAlpha(0);
      this.tweens.add({ targets: root, alpha: 1, duration: LR_MOTION.reducedFadeMs });
      return;
    }
    root.setScale(0);
    this.tweens.add({ targets: root, scale: 1, duration: sp.logoInMs, ease: LR_EASE.backOut });
  }

  /** Gloss bar crossing the lockup (needs fx_glow, so it waits for bakes). */
  private sweepLogo(): void {
    if (reducedMotion() || !this.logoRoot || !this.textures.exists('fx_glow')) return;
    const sp = LR_ART.splash;
    if (!this.logoShine) {
      this.logoShine = this.add
        .image(0, 0, 'fx_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAngle(-18)
        .setVisible(false);
      this.logoShine.setDisplaySize(70, 160);
    }
    const bar = this.logoShine;
    if (bar.visible) return;
    bar.setPosition(GAME_W / 2 - this.logoReach, LOGO_Y).setAlpha(0.35).setVisible(true);
    this.tweens.add({
      targets: bar,
      x: GAME_W / 2 + this.logoReach,
      duration: sp.shineMs,
      ease: LR_EASE.quadOut,
      onComplete: () => bar.setVisible(false),
    });
  }

  // ------------------------------------------------------------------ badge

  /** Center badge: baked medallion + live progress ring + i18n pct label. */
  private buildBadge(): void {
    const sp = LR_ART.splash;
    const badge = this.add.container(GAME_W / 2, BADGE_Y);
    badge.add(this.add.image(0, 0, ensureSplashBadge(this)).setScale(1 / LR_BAKE_SCALE));
    this.ringG = this.add.graphics();
    badge.add(this.ringG);
    this.badge = badge;
    this.drawRing(0);
    const labelY = BADGE_Y + sp.badgeR + dp(sp.ringGapDp) + 44;
    this.pctText = uiText(
      this,
      GAME_W / 2,
      labelY,
      t('loading.pct', { pct: 0 }),
      20,
      LR_COLORS.textOnDark,
      '700',
    );
    this.pctText.setAlpha(0.9);
  }

  /** Progress arc around the badge: faint track + filled gold arc from 12h. */
  private drawRing(frac: number): void {
    const g = this.ringG;
    if (!g) return;
    const sp = LR_ART.splash;
    const r = sp.badgeR + dp(sp.ringGapDp);
    g.clear();
    g.lineStyle(dp(sp.ringDp), LR_COLORS.gold700, 0.35);
    g.strokeCircle(0, 0, r);
    if (frac > 0) {
      g.lineStyle(dp(sp.ringDp), LR_COLORS.gold500, 1);
      g.beginPath();
      g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(frac, 1), false);
      g.strokePath();
    }
  }

  // --------------------------------------------------------------- showcase

  /**
   * Bottom diorama + rays + confetti + logo shine — built the moment the
   * last bake lands (all of its textures exist from that point on), so it
   * decorates the remainder of the minimum splash time.
   */
  private buildShowpieces(): void {
    if (this.showpiecesBuilt) return;
    this.showpiecesBuilt = true;
    const sp = LR_ART.splash;
    const reduced = reducedMotion();

    if (!reduced) {
      const rays = this.add
        .image(GAME_W / 2, DIORAMA_Y - 24, 'fx_rays')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(LR_COLORS.gold300)
        .setAlpha(sp.raysAlpha)
        .setScale(2.4)
        .setDepth(-6);
      this.tweens.add({ targets: rays, angle: 360, duration: sp.raysMs, repeat: -1, ease: 'Linear' });
      this.buildConfetti();
      this.time.delayedCall(400, () => this.sweepLogo());
      this.time.addEvent({ delay: sp.shineEveryMs, loop: true, callback: () => this.sweepLogo() });
    }

    // Diorama: y-squashed board reads as perspective; face pawns flank it
    // (back pair smaller for depth) and two mismatched dice tumble in front.
    const d = this.add.container(GAME_W / 2, DIORAMA_Y).setDepth(-5);
    const boardScale = 0.24;
    d.add(this.add.image(0, 96, 'board_shadow').setScale(0.55).setAlpha(0.8));
    d.add(this.add.image(0, 0, 'board').setScale(boardScale, boardScale * 0.72));
    bakeBoardCrown(this);
    d.add(this.add.image(0, 0, 'board_crown').setScale(boardScale, boardScale * 0.72));
    d.add(this.add.image(-56, -46, 'piece_blue_face').setScale(0.4));
    d.add(this.add.image(56, -46, 'piece_yellow_face').setScale(0.4));
    d.add(this.add.image(-108, 6, 'piece_red_face').setScale(0.5));
    d.add(this.add.image(108, 6, 'piece_green_face').setScale(0.5));
    d.add(this.add.image(-34, 76, 'dice_face_5').setScale(0.3).setAngle(-12));
    d.add(this.add.image(36, 84, 'dice_face_2').setScale(0.32).setAngle(15));

    if (reduced) return;
    const targetY = d.y;
    d.setY(targetY + 30).setAlpha(0);
    this.tweens.add({
      targets: d,
      y: targetY,
      alpha: 1,
      duration: sp.dioramaInMs,
      ease: LR_EASE.backOut,
    });
  }

  /** Sparse splash confetti — SceneBackdrop's §1.4 mechanics, low density. */
  private buildConfetti(): void {
    const c = LR_ART.confetti;
    const sp = LR_ART.splash;
    const tints: readonly number[] = [
      LR_COLORS.confettiPink,
      LR_COLORS.confettiGold,
      LR_COLORS.confettiCyan,
      LR_COLORS.confettiViolet,
    ];
    for (let i = 0; i < sp.confettiCount; i++) {
      const fallMs = c.fallMinMs + Math.random() * (c.fallMaxMs - c.fallMinMs);
      const x0 = 20 + Math.random() * (GAME_W - 40);
      const img = this.add
        .image(x0, -20 - Math.random() * GAME_H, 'fx_confetti')
        .setDepth(-8)
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

  /** Fall + sine drift + slow spin, respawn at the top (update-driven). */
  private driveConfetti(delta: number): void {
    if (this.confetti.length === 0) return;
    const now = this.time.now;
    for (const bit of this.confetti) {
      bit.img.y += bit.fall * delta;
      bit.img.x = bit.x0 + Math.sin(now * bit.driftFreq + bit.phase) * bit.driftAmp;
      bit.img.angle += bit.spin * delta;
      if (bit.img.y > GAME_H + 20) {
        bit.img.y = -20 - Math.random() * 60;
        bit.x0 = 20 + Math.random() * (GAME_W - 40);
      }
    }
  }

  // ----------------------------------------------------------------- finish

  /** 100%: badge pop, short fade to the splash ink, hand over to Home. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.drawRing(1);
    this.pctText?.setText(t('loading.pct', { pct: 100 }));
    const sp = LR_ART.splash;
    const reduced = reducedMotion();
    const goHome = (): void => {
      const ink = LR_COLORS.splashBottom;
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Home');
      });
      this.cameras.main.fadeOut(
        reduced ? LR_MOTION.reducedFadeMs : sp.fadeMs,
        (ink >> 16) & 0xff,
        (ink >> 8) & 0xff,
        ink & 0xff,
      );
    };
    if (reduced || !this.badge) {
      goHome();
      return;
    }
    this.tweens.add({
      targets: this.badge,
      scale: sp.popScale,
      duration: sp.popMs,
      yoyo: true,
      ease: LR_EASE.backOut,
      onComplete: goHome,
    });
  }
}

// ------------------------------------------------------- art normalization

const PIECE_ART_KEYS = ['piece_red', 'piece_green', 'piece_yellow', 'piece_blue'] as const;

/**
 * Shipped pawn PNGs arrive with arbitrary canvas padding (AI generations are
 * square with lots of transparent air), while PieceView positions/scales by
 * the CANONICAL baked footprint ((PAWN_W+8)×(PAWN_H+8) @2×). Re-rasterize
 * each art pawn into that exact canvas: alpha-trim, fit at 88% of the body
 * box (art pawns read heavier than the procedural cone — this is the
 * "achícalo"), feet on the baker's baseline. Consumers stay untouched.
 */
function normalizePieceArt(scene: Phaser.Scene): void {
  const S = LR_BAKE_SCALE;
  const w = (PAWN_W + 8) * S;
  const h = (PAWN_H + 8) * S;
  for (const key of PIECE_ART_KEYS) {
    if (!scene.textures.exists(key)) continue;
    const src: unknown = scene.textures.get(key).getSourceImage();
    if (src instanceof HTMLCanvasElement) continue; // procedural — already canonical
    if (
      !(src instanceof HTMLImageElement) &&
      !(typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap)
    ) {
      continue;
    }
    const read = document.createElement('canvas');
    read.width = src.width;
    read.height = src.height;
    const rctx = read.getContext('2d');
    if (!rctx) continue;
    rctx.drawImage(src as CanvasImageSource, 0, 0);
    const box = alphaBounds(rctx, src.width, src.height);
    if (!box) continue;
    scene.textures.remove(key);
    const { ctx, texture } = makeCanvas(scene, key, w, h);
    const fit = Math.min((PAWN_W * S * 0.88) / box.w, (PAWN_H * S * 0.88) / box.h);
    const dw = box.w * fit;
    const dh = box.h * fit;
    ctx.drawImage(read, box.x, box.y, box.w, box.h, (w - dw) / 2, h - 8 * S - dh, dw, dh);
    texture.refresh();
  }
}

/** Bounding box of pixels with alpha > 8 (ignores compression ghosting). */
function alphaBounds(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((data[(y * w + x) * 4 + 3] ?? 0) > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// -------------------------------------------------------------------- bakes

/**
 * Splash backdrop: deep violet-navy vertical gradient (darker than Home's
 * stage), faint deterministic star dust, a soft brand glow behind the badge
 * band and the edge vignette. Baked once, before any pipeline task runs.
 */
function ensureSplashSky(scene: Phaser.Scene): string {
  const key = 'splash_sky';
  if (scene.textures.exists(key)) return key;
  const { ctx, texture } = makeCanvas(scene, key, GAME_W, GAME_H);

  const sky = ctx.createLinearGradient(0, 0, 0, GAME_H);
  sky.addColorStop(0, cssColor(LR_COLORS.splashTop));
  sky.addColorStop(1, cssColor(LR_COLORS.splashBottom));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  // Faint static star dust across the upper two thirds.
  const rand = mulberry32(0x51a5);
  for (let i = 0; i < 70; i++) {
    const x = 12 + rand() * (GAME_W - 24);
    const y = (0.03 + rand() * 0.62) * GAME_H;
    const r = 0.6 + rand() * 1.0;
    const gold = rand() < 0.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = cssRgba(gold ? LR_COLORS.sceneStarGold : LR_COLORS.sceneStar, 0.1 + rand() * 0.22);
    ctx.fill();
  }

  // Soft brand glow behind the badge band — makes the center the focus.
  const glowR = GAME_W * 0.5;
  const glow = ctx.createRadialGradient(GAME_W / 2, BADGE_Y, 12, GAME_W / 2, BADGE_Y, glowR);
  glow.addColorStop(0, cssRgba(LR_COLORS.brand300, 0.16));
  glow.addColorStop(1, cssRgba(LR_COLORS.brand300, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(GAME_W / 2 - glowR, BADGE_Y - glowR, glowR * 2, glowR * 2);

  // Edge vignette, deeper ink than the in-game one.
  const vig = ctx.createRadialGradient(
    GAME_W / 2,
    GAME_H / 2,
    GAME_W * 0.42,
    GAME_W / 2,
    GAME_H / 2,
    GAME_W * 1.02,
  );
  vig.addColorStop(0, cssRgba(LR_COLORS.splashVignette, 0));
  vig.addColorStop(1, cssRgba(LR_COLORS.splashVignette, 0.6));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  texture.refresh();
  return key;
}

/**
 * Badge medallion (baked @2x): cream disc, thick gold gradient rim, a mini
 * 2×2 ludo board (one rounded tile per player color, white pip each) and a
 * small gold star pinned at the cross. The live progress ring is drawn by
 * the scene around it — this texture is only the static core.
 */
function ensureSplashBadge(scene: Phaser.Scene): string {
  const key = 'splash_badge';
  if (scene.textures.exists(key)) return key;
  const S = LR_BAKE_SCALE;
  const sp = LR_ART.splash;
  const size = (sp.badgeR + dp(8)) * 2;
  const { ctx, texture } = makeCanvas(scene, key, size * S, size * S);
  ctx.scale(S, S);
  const c = size / 2;
  const R = sp.badgeR;

  // 1. Cream disc, lit from the top, warming toward the rim.
  const disc = ctx.createRadialGradient(c, c - R * 0.35, R * 0.2, c, c, R);
  disc.addColorStop(0, cssColor(LR_COLORS.surface));
  disc.addColorStop(0.75, cssColor(LR_COLORS.sceneCream));
  disc.addColorStop(1, cssColor(LR_COLORS.gold300));
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.fill();

  // 2. Thick gold rim (gold300 top → gold700 bottom).
  const rim = ctx.createLinearGradient(c, c - R, c, c + R);
  rim.addColorStop(0, cssColor(LR_COLORS.gold300));
  rim.addColorStop(1, cssColor(LR_COLORS.gold700));
  ctx.beginPath();
  ctx.arc(c, c, R - dp(4), 0, Math.PI * 2);
  ctx.lineWidth = dp(8);
  ctx.strokeStyle = rim;
  ctx.stroke();

  // 3. Mini 2×2 board: red TL, green TR, blue BL, yellow BR + white pips.
  const q = R * 0.52;
  const gap = dp(6);
  const quads = [
    { pal: LR_PLAYERS.red, dx: -1, dy: -1 },
    { pal: LR_PLAYERS.green, dx: 1, dy: -1 },
    { pal: LR_PLAYERS.blue, dx: -1, dy: 1 },
    { pal: LR_PLAYERS.yellow, dx: 1, dy: 1 },
  ] as const;
  for (const { pal, dx, dy } of quads) {
    const tx = dx < 0 ? c - q - gap / 2 : c + gap / 2;
    const ty = dy < 0 ? c - q - gap / 2 : c + gap / 2;
    roundedRectPath(ctx, tx, ty, q, q, dp(10));
    const tile = ctx.createLinearGradient(tx, ty, tx, ty + q);
    tile.addColorStop(0, cssColor(pal.light));
    tile.addColorStop(1, cssColor(pal.mid));
    ctx.fillStyle = tile;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = cssRgba(pal.dark, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx + q / 2, ty + q / 2, q * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(LR_COLORS.surface);
    ctx.fill();
    ctx.strokeStyle = cssRgba(pal.dark, 0.6);
    ctx.stroke();
  }

  // 4. Gold star pinned over the cross — the "royale" seal.
  ctx.save();
  ctx.lineJoin = 'round';
  starPath(ctx, c, c, dp(16), dp(7));
  ctx.fillStyle = cssColor(LR_COLORS.gold500);
  ctx.strokeStyle = cssColor(LR_COLORS.gold700);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fill();
  ctx.restore();

  // 5. Top gloss — glazed-toy finish.
  ctx.beginPath();
  ctx.ellipse(c, c - R * 0.55, R * 0.62, R * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fill();

  texture.refresh();
  return key;
}
