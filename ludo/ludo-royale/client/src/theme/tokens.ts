/**
 * Design tokens — the single Phaser-side source for every color, size,
 * duration and easing (STYLE-GUIDE §2, §4, §5, §7). Sprint 3 replaces the
 * literals with the theme.json loader + dual CSS-custom-property output
 * (§8); scenes keep importing from here either way, so nothing else moves.
 */
import type { PlayerColor } from '@ludo/shared';

/** STYLE-GUIDE dp values are specced @1080 ref; the game runs 720 logical. */
export function dp(v: number): number {
  return Math.round((v * 720) / 1080);
}

/** Procedural textures bake at 2x and render at 0.5 scale for crisp edges. */
export const LR_BAKE_SCALE = 2;

export function cssColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function cssRgba(c: number, alpha: number): string {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface PlayerPalette {
  /** Rim-light / top shine (300). */
  light: number;
  /** Body (500). */
  mid: number;
  /** Base / outline / shadow (700). */
  dark: number;
  /** Soft home/lane background. */
  tint: number;
}

export const LR_PLAYERS: Readonly<Record<PlayerColor, PlayerPalette>> = {
  red: { light: 0xff6b73, mid: 0xf5333f, dark: 0xc21521, tint: 0xfde7e8 },
  green: { light: 0x5fe3a0, mid: 0x23c275, dark: 0x128a50, tint: 0xe4f8ee },
  yellow: { light: 0xffd75a, mid: 0xfbbf16, dark: 0xc98a00, tint: 0xfff6dc },
  blue: { light: 0x6bb2ff, mid: 0x2d8cf5, dark: 0x175fbf, tint: 0xe3f0ff },
};

export const LR_COLORS = {
  // LUDOWORLD-PARITY §1: vivid-purple override. Same keys, new values — the
  // bakers consume these by name, so the whole scene re-paints from here.
  worldTop: 0x5e3fd6,
  worldBottom: 0xc77de0,
  worldSpotlight: 0xb98bea,
  worldVignette: 0x3a1e78,
  surface: 0xffffff,
  surface2: 0xf4f6fb,
  surfaceSunken: 0xe9edf6,
  panelInk: 0x1b2140,
  border: 0xe2e7f2,
  borderStrong: 0xcbd3e4,
  boardSurface: 0xfbfbfe,
  cellLine: 0xe6e9f2,
  brand1: 0xff4d8d,
  brand2: 0x7b3ff2,
  brand500: 0x7b3ff2,
  brand700: 0x5a22c9,
  brand300: 0xb78bff,
  gold300: 0xffe08a,
  gold500: 0xf5a623,
  gold700: 0xc77a12,
  success: 0x16b364,
  warning: 0xff9f1c,
  danger: 0xe23744,
  info: 0x2d8cf5,
  text: 0x1b2140,
  textMuted: 0x5a6486,
  textFaint: 0x8a93ad,
  textOnDark: 0xffffff,
  // --- ARTPASS-GAMEFEEL §A scene tokens, re-painted by LUDOWORLD-PARITY §1 ---
  sceneSkyTop: 0x5e3fd6, // §1.1 top of the sky (vivid royal violet)
  sceneSkyUpper: 0x7b54dc, // §1.1 gradient stop @0.38
  sceneSkyMid: 0x9463dd, // §1.1 gradient stop @0.52 (violet-lilac)
  sceneSkyLower: 0xb074e0, // §1.1 gradient stop @0.78 (lilac)
  sceneSkyBottom: 0xc77de0, // = worldBottom (reuse, bright pink-lilac anchor)
  sceneHorizonGlow: 0xffa6de, // §1.1 candy-pink sun glow
  sceneHorizonLine: 0xffd1f0, // §1.1 warm horizon hairline
  sceneCityFar: 0x9e74d8, // §1.2 far skyline (lilac haze)
  sceneCityNear: 0x6b41b4, // §1.2 near skyline (deep violet)
  sceneWindowWarm: 0xffe0a0,
  sceneWindowCool: 0xa6e4ff,
  sceneBeacon: 0xff5a5a, // signature red pinnacle beacon — kept
  sceneGround: 0x4e2ca0, // §1.3 stage floor (deep violet platform)
  sceneGroundLip: 0x8a66e0, // §1.3 lit platform lip
  sceneStar: 0xffffff,
  sceneStarGold: 0xffe9b0,
  sceneCream: 0xfdf1d6, // §1.5 warm cream-beige panel body
  sceneRibbonRed: 0xf0402e, // §1.5 flame-red ribbon top (no longer = danger)
  sceneRibbonRedDk: 0xc4241e,
  sceneRibbonInk: 0x7a1810, // ribbon-title stroke (§2/§5)
  sceneBevelLight: 0x6e4fc8, // §1.5 light bevel lip on violet ink panels
  sceneBevelDark: 0x1e1050,
  sceneShadowInk: 0x2a1560, // §1.5 shadow ink — purple-tinted, never navy
  successDark: 0x0e8a4c, // success button gradient bottom (§A variants)
  successDeep: 0x0a6e3c, // success bevel/outline dark (§2)
  // --- NEW confetti (LUDOWORLD-PARITY §1.4 — home ambient falling bits) ---
  confettiPink: 0xff5fa2, // candy pink
  confettiGold: 0xffd24d, // = gold300 vibe
  confettiCyan: 0x34e0e0, // mint cyan
  confettiViolet: 0xb78bff, // = brand300
  // --- NEW hud/nav (§1.6 — candy-violet chrome surfaces; panelInk stays ink) ---
  hudInk: 0x3a2270, // HUD pills (coins/gems/avatar), medallion base
  hudLip: 0x6e4fc8, // light bevel lip of the HUD (= sceneBevelLight)
  navBand: 0x2e1866, // bottom nav band (very deep violet)
  navBandLip: 0x5a3fb0, // lit top lip of the nav band
  // --- NEW mode-card gradients (§1.7 — saturated per mode) ---
  cardOnlineA: 0xffa61e, // online = golden orange (HOT, flagship)
  cardOnlineB: 0xf26d1c,
  cardOnlineDark: 0xb8460f,
  cardCpuA: 0xff7a5c, // vs CPU = red-coral
  cardCpuB: 0xf0384a,
  cardCpuDark: 0xb5203a,
  cardLocalA: 0x7c6bf0, // pass&play = blue-violet
  cardLocalB: 0x5340d4,
  cardLocalDark: 0x33228f,
  // --- NEW glossy candy buttons (§1.8 — popup CTAs) ---
  collectA: 0x46c85a, // green "COLLECT"
  collectB: 0x1e9a3a,
  collectDark: 0x127a2c,
  doubleA: 0x45a3f2, // blue "DOUBLE BONUS" (rewarded video)
  doubleB: 0x1e6fd6,
  doubleDark: 0x155ab8,
  // --- NEW gem (§1.9 — faceted violet gem, pairs with the gold set) ---
  gem300: 0xc99cff,
  gem500: 0x8b4dff,
  gem700: 0x6222c9,
  // --- NEW title strokes (§1.9 — chunky Ludo-World outline) ---
  titleStrokeBrown: 0x5a3a1e, // outline on GOLD titles and over warm cards
  titleStrokeDark: 0x33280f, // deeper outline for the biggest gold numbers
  titleStrokeCool: 0x2e2246, // dark-violet outline for white titles on cool cards/scene
  // --- NEW splash screen (SPLASH — deep violet-navy, darker than Home) ---
  splashTop: 0x2a1b66, // splash gradient top (deep royal violet)
  splashBottom: 0x1a1040, // splash gradient bottom (violet-navy, near-ink)
  splashVignette: 0x0e0826, // splash edge vignette (deeper than worldVignette)
} as const;

/** ARTPASS-GAMEFEEL motion/treatment values (§1–§5) — do not invent. */
export const LR_ART = {
  /** §2 press-sink: body drops while its detached shadow shrinks toward it. */
  sink: {
    dropDp: 5,
    bodyScaleY: 0.96,
    inMs: 90,
    outMs: 160,
    shadowScale: 0.72,
    shadowAlpha: 0.6,
    shadowRestAlpha: 0.9,
    shadowRestDp: 10,
    shadowPressDp: 4,
  },
  /** §3 Home ambient loops (budget: ≤24 tweens / ≤40 live sprites). */
  ambient: {
    logoFloatDp: 6,
    logoFloatMs: 3000,
    logoTiltDeg: 1.5,
    logoTiltMs: 6000,
    shineMs: 600,
    shineEveryMs: 7000,
    breathScale: 1.015,
    breathMs: 2600,
    breathStaggerMs: 400,
    ribbonSwayDeg: 3,
    ribbonSwayMs: 2600,
    clusterBobDp: 3,
    clusterBobMs: 2800,
    dieTiltDeg: 4,
    dieTiltMs: 3200,
    shimmerMs: 700,
    shimmerAlpha: 0.3,
    shimmerMinDelayMs: 6000,
    shimmerMaxDelayMs: 8000,
    sparkMinDelayMs: 9000,
    sparkMaxDelayMs: 14000,
  },
  /** §1 scene layers (twinkle is update-driven — zero tween cost). */
  scene: {
    twinkleHome: 14,
    twinkleGame: 6,
    twinkleMinMs: 1800,
    twinkleMaxMs: 3200,
    parallaxPx: 8,
    parallaxMs: 28000,
    beaconMs: 2000,
    floatDriftPx: 14,
    floatMinMs: 5000,
    floatMaxMs: 7000,
    floatTiltDeg: 6,
    floatTiltMs: 8000,
    shootMinDelayMs: 12000,
    shootMaxDelayMs: 20000,
    shootMs: 700,
  },
  /**
   * LUDOWORLD-PARITY §1.4 home confetti — update-driven like the twinkles
   * (zero tweens), OFF in-game and under reduced motion. Counts toward the
   * ≤40 ambient-sprite cap.
   */
  confetti: {
    count: 12,
    wPx: 6,
    hPx: 10,
    alphaMin: 0.35,
    alphaMax: 0.6,
    fallMinMs: 9000,
    fallMaxMs: 14000,
    spinDeg: 180,
    driftPx: 26,
  },
  /** §4 board medallion "trophy waiting" pulse. */
  medallion: {
    glowMs: 2400,
    glowAlphaMax: 0.35,
    glowScaleMin: 0.9,
    glowScaleMax: 1.05,
    sparkMs: 3000,
    reducedGlowAlpha: 0.2,
  },
  /**
   * SPLASH loading screen choreography (Ludo-World-style splash, darker).
   * The badge ring + pct label report REAL task progress; minMs keeps the
   * splash on screen long enough to be appreciated even on instant loads.
   */
  splash: {
    minMs: 1200,
    fadeMs: 300,
    ringDp: 6,
    badgeR: 88,
    ringGapDp: 12,
    raysMs: 18000,
    raysAlpha: 0.25,
    confettiCount: 8,
    logoInMs: 500,
    dioramaInMs: 320,
    shineEveryMs: 2800,
    shineMs: 600,
    popScale: 1.1,
    popMs: 140,
  },
  /** §5 CelebrationPanel choreography. */
  celebration: {
    scrimAlpha: 0.62,
    scrimMs: 150,
    panelMs: 260,
    ribbonDelayMs: 200,
    raysMs: 9000,
    raysAlpha: 0.3,
    reducedRaysAlpha: 0.2,
    glowPulseMs: 2000,
    heroMs: 420,
    btnStaggerMs: 60,
    primaryPulseMs: 2000,
    primaryPulseScale: 1.03,
  },
} as const;

/**
 * System-font fallback stacks until the art pass ships the self-hosted
 * Baloo 2 / Nunito woff2 + bitmap atlases (STYLE-GUIDE §7).
 */
export const LR_FONTS = {
  display: '"Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif',
  ui: '"Nunito", "Segoe UI", system-ui, sans-serif',
} as const;

export const LR_EASE = {
  backOut: 'Back.easeOut',
  cubicOut: 'Cubic.easeOut',
  cubicIn: 'Cubic.easeIn',
  cubicInOut: 'Cubic.easeInOut',
  sineInOut: 'Sine.easeInOut',
  quadOut: 'Quad.easeOut',
  quadIn: 'Quad.easeIn',
  expoOut: 'Expo.easeOut',
} as const;

/** Frame-by-frame numbers straight from STYLE-GUIDE §4/§5 — do not invent. */
export const LR_MOTION = {
  dice: {
    windupMs: 60,
    windupScale: 0.9,
    tumbleFrames: 10,
    tumbleFps: 24,
    arcUpMs: 180,
    arcDownMs: 160,
    arcHeightDp: 90,
    squashStepMs: 70,
    revealMs: 160,
    revealScale: 1.12,
    flashMs: 140,
    flashAlpha: 0.6,
    dustCount: 7,
  },
  hop: {
    perCellMs: 180,
    heightDp: 34,
    liftScale: 1.08,
    landSquashMs: 90,
    midSquashX: 1.06,
    midSquashY: 0.94,
    finalSquashX: 1.14,
    finalSquashY: 0.88,
    trailCount: 4,
    reducedSlideMs: 260,
  },
  capture: {
    hitStopMs: 45,
    shakeMs: 220,
    shakeIntensity: 0.01,
    burstCount: 16,
    victimPopMs: 120,
    victimPopScale: 1.3,
    victimFlightMs: 420,
    victimSpinDeg: 720,
    victimShrink: 0.4,
    plopMs: 160,
    flashAlpha: 0.25,
    flashMs: 90,
    sealRiseDp: 30,
    sealMs: 500,
    attackerBobMs: 160,
    attackerBobScale: 1.15,
    reducedMs: 200,
  },
  victory: {
    zoomTo: 1.12,
    zoomMs: 400,
    confettiBurst: 60,
    confettiRainMs: 1200,
    gravityY: 400,
    lifeMinMs: 2500,
    lifeMaxMs: 3500,
    bannerMs: 420,
    bannerOvershoot: 1.15,
    heroCapMs: 800,
  },
  emote: {
    staggerMs: 30,
    itemInMs: 220,
    bubbleInMs: 220,
    holdMs: 1600,
    fadeMs: 200,
    wiggleDeg: 8,
    cooldownMs: 2000,
    scrimAlpha: 0.2,
  },
  timer: {
    warnFrac: 0.33,
    dangerFrac: 0.15,
    pulseBelowMs: 5000,
    pulseMs: 500,
    pulseScale: 1.05,
    strokeDp: 6,
  },
  selectable: {
    pulseMs: 700,
    scaleMax: 1.06,
    bobDp: 6,
  },
  press: {
    scale: 0.94,
    ms: 90,
  },
  reducedFadeMs: 120,
} as const;

/**
 * STYLE-GUIDE §8 dual output — the SAME origin feeds both render media:
 * Phaser consumes the JS constants above by import; the DOM overlay consumes
 * CSS custom properties generated here (one `--lr-<kebab-key>` per LR_COLORS
 * entry, plus the two font stacks). Zero hex ever hardcoded in overlay CSS.
 */
export function applyCssTokens(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(LR_COLORS)) {
    root.style.setProperty(`--lr-${kebabCase(key)}`, cssColor(value));
  }
  root.style.setProperty('--lr-font-display', LR_FONTS.display);
  root.style.setProperty('--lr-font-ui', LR_FONTS.ui);
}

function kebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Global reduced-motion flag (STYLE-GUIDE §5): tweens become fades ≤120ms,
 * shake/confetti/loops are killed, information is preserved.
 */
export const LR_RUNTIME = {
  reducedMotion: false,
};

export function initReducedMotion(): void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  LR_RUNTIME.reducedMotion = mq.matches;
  mq.addEventListener('change', (e) => {
    LR_RUNTIME.reducedMotion = e.matches;
  });
}
