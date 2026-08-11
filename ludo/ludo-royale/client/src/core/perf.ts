/**
 * Device performance profile (UX sprint §2 — the "se pega" fix). Low-end
 * hardware is detected once at boot from the two signals every engine uses
 * (logical cores and device memory, when the browser exposes it) and the
 * ambient inventory downshifts to a LITE preset: fewer twinkles, no falling
 * confetti, fewer floating decor pieces, no card shimmer, no parallax. The
 * gameplay juice (dice/hops/capture/victory) is untouched — lite trims only
 * decoration.
 *
 * The resolved profile is exposed on `window.__LR_PERF` so QA can check from
 * DevTools exactly which preset a device landed on and why.
 */

export interface LrPerfTweaks {
  /** Home twinkle stars (full 14 → lite 6). In-game stays at its own count. */
  twinkleHome: number;
  /** Ambient falling confetti on Home (lite: OFF). */
  confetti: boolean;
  /** Floating sky decor pieces — 4 pawns + 1 die (full 5 → lite 2). */
  floatingDecor: number;
  /** Periodic shimmer sweep across the mode cards (lite: OFF). */
  shimmer: boolean;
  /** Skyline parallax drift on Home (lite: OFF). */
  parallax: boolean;
}

export interface LrPerfInfo {
  lite: boolean;
  dpr: number;
  /**
   * Device-pixel budget: min(devicePixelRatio, 2). Informational — Phaser
   * 4.2 under Scale.FIT renders a fixed 720×1280 backing store (see the
   * note in main.ts), so the real cost already sits below this cap.
   */
  dprCap: number;
  cores: number | null;
  deviceMemoryGb: number | null;
  tweaks: LrPerfTweaks;
}

declare global {
  interface Window {
    __LR_PERF?: LrPerfInfo;
  }
}

const FULL_TWEAKS: LrPerfTweaks = {
  twinkleHome: 14,
  confetti: true,
  floatingDecor: 5,
  shimmer: true,
  parallax: true,
};

const LITE_TWEAKS: LrPerfTweaks = {
  twinkleHome: 6,
  confetti: false,
  floatingDecor: 2,
  shimmer: false,
  parallax: false,
};

let liteMode = false;
let tweaks: LrPerfTweaks = FULL_TWEAKS;

/** Detect once at boot (before Phaser), publish window.__LR_PERF for QA. */
export function initPerf(): LrPerfInfo {
  const cores =
    typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
  // Chromium-only hint; Firefox/Safari fall back to the cores signal alone.
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  liteMode = (cores !== null && cores <= 4) || (memory !== null && memory <= 4);
  tweaks = liteMode ? LITE_TWEAKS : FULL_TWEAKS;
  const dpr = window.devicePixelRatio || 1;
  const info: LrPerfInfo = {
    lite: liteMode,
    dpr,
    dprCap: Math.min(dpr, 2),
    cores,
    deviceMemoryGb: memory,
    tweaks,
  };
  window.__LR_PERF = info;
  return info;
}

export function perfLite(): boolean {
  return liteMode;
}

export function perfTweaks(): LrPerfTweaks {
  return tweaks;
}
