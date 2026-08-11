/**
 * AudioManager — 100% synthesized WebAudio (no binary assets, no licensing):
 * a soft candy-pop background LOOP (I–V–vi–IV arpeggios + sine bass, 104
 * BPM, lookahead scheduler) plus the six game SFX (dice roll ticks, hop
 * blip, capture sting, win arpeggio, shield shimmer, power zap). Browsers
 * gate audio behind a user gesture: `unlockAudio()` runs once on the first
 * pointerdown (wired in main.ts). Music and SFX have separate persistent
 * toggles (Settings): `lr_music` / legacy `lr_muted` for effects.
 */

export type SfxName = 'tap' | 'roll' | 'hop' | 'step' | 'capture' | 'win' | 'shield' | 'power';

const MUTE_KEY = 'lr_muted';
const MUSIC_KEY = 'lr_music';

let muted = readFlag(MUTE_KEY, false);
let musicOn = readFlag(MUSIC_KEY, true);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let unlocked = false;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // private mode: session-only toggle
  }
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.13;
  musicBus.connect(master);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.5;
  sfxBus.connect(master);
  return ctx;
}

/** First-gesture unlock (autoplay policy) — starts the music if enabled. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const c = ensureCtx();
  if (!c) return;
  void c.resume().then(() => {
    if (musicOn) startMusic();
  });
}

// ---------------------------------------------------------------------------
// Settings surface
// ---------------------------------------------------------------------------

export function isMuted(): boolean {
  return muted;
}

export function setMuted(on: boolean): void {
  muted = on;
  writeFlag(MUTE_KEY, on);
}

export function isMusicOn(): boolean {
  return musicOn;
}

export function setMusicOn(on: boolean): void {
  musicOn = on;
  writeFlag(MUSIC_KEY, on);
  if (on) {
    if (unlocked) startMusic();
  } else {
    stopMusic();
  }
}

// ---------------------------------------------------------------------------
// Background music — generative candy loop (C – G – Am – F)
// ---------------------------------------------------------------------------

const BPM = 104;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
/** Chord tones as MIDI notes. */
const PROGRESSION: number[][] = [
  [60, 64, 67], // C
  [55, 59, 62], // G
  [57, 60, 64], // Am
  [53, 57, 60], // F
];

let musicTimer: number | null = null;
let nextBarTime = 0;
let barIndex = 0;

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function startMusic(): void {
  const c = ensureCtx();
  if (!c || !musicBus || musicTimer !== null) return;
  nextBarTime = c.currentTime + 0.1;
  barIndex = 0;
  musicTimer = window.setInterval(() => {
    if (!ctx || !musicBus) return;
    // Lookahead: keep ~1 bar scheduled ahead of the clock.
    while (nextBarTime < ctx.currentTime + BAR) {
      scheduleBar(ctx, musicBus, nextBarTime, barIndex);
      nextBarTime += BAR;
      barIndex = (barIndex + 1) % PROGRESSION.length;
    }
  }, 250);
}

function stopMusic(): void {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}

function scheduleBar(c: AudioContext, bus: GainNode, t0: number, bar: number): void {
  const chord = PROGRESSION[bar % PROGRESSION.length] ?? [60, 64, 67];
  // Bass: root as two half-notes, one octave down.
  for (let i = 0; i < 2; i++) {
    tone(c, bus, midiHz((chord[0] ?? 60) - 12), t0 + i * BEAT * 2, BEAT * 1.8, 'sine', 0.5);
  }
  // Arpeggio: gentle 8th-note up-down pattern one octave up.
  const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
  pattern.forEach((idx, step) => {
    const note = (chord[idx] ?? 60) + 12;
    tone(c, bus, midiHz(note), t0 + step * (BEAT / 2), BEAT * 0.45, 'triangle', 0.32);
  });
  // Lead melody: a bright per-chord phrase two octaves up.
  const phrase = MELODY[bar % MELODY.length] ?? [];
  for (const [beat, midi, len] of phrase) {
    tone(c, bus, midiHz(midi), t0 + beat * BEAT, BEAT * len, 'sine', 0.26);
  }
  // Soft off-beat hats for groove.
  for (let i = 0; i < 4; i++) {
    hat(c, bus, t0 + (i + 0.5) * BEAT);
  }
  // Sparkle every other bar: one soft high ping on the off-beat.
  if (bar % 2 === 1) {
    tone(c, bus, midiHz((chord[2] ?? 64) + 24), t0 + BEAT * 2.5, BEAT * 0.9, 'sine', 0.16);
  }
}

/** Per-bar lead phrases [beat, midi, lengthBeats] over C-G-Am-F. */
const MELODY: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[0, 76, 0.9], [1, 79, 0.9], [2, 84, 1.4], [3.5, 79, 0.45]],
  [[0, 74, 0.9], [1, 79, 0.9], [2, 83, 0.9], [3, 79, 0.9]],
  [[0, 72, 0.9], [1, 76, 0.9], [2, 81, 1.4], [3.5, 76, 0.45]],
  [[0, 72, 0.9], [1, 77, 0.9], [2, 81, 0.9], [3, 84, 0.9]],
];

/** Tiny high-passed noise tick (hi-hat). */
function hat(c: AudioContext, bus: GainNode, at: number): void {
  const len = Math.max(1, Math.floor(c.sampleRate * 0.03));
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.07, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
  src.connect(filter);
  filter.connect(g);
  g.connect(bus);
  src.start(at);
  src.stop(at + 0.05);
}

/** One enveloped oscillator note. */
function tone(
  c: AudioContext,
  bus: GainNode,
  hz: number,
  at: number,
  dur: number,
  type: OscillatorType,
  vol: number,
): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g);
  g.connect(bus);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

// ---------------------------------------------------------------------------
// SFX — short synthesized effects
// ---------------------------------------------------------------------------

export function sfx(name: SfxName, variant = 0): void {
  // Audio must NEVER break gameplay: sfx() runs inside move/turn task
  // chains, and a WebAudio hiccup (autoplay policy, context suspended
  // after device sleep, exotic browsers) would otherwise freeze the match.
  try {
    sfxInner(name, variant);
  } catch {
    // skip the blip, keep the game moving
  }
}

function sfxInner(name: SfxName, variant = 0): void {
  if (muted || !unlocked) return;
  const c = ensureCtx();
  if (!c || !sfxBus) return;
  const bus = sfxBus;
  const t = c.currentTime;
  switch (name) {
    case 'tap': {
      // Soft UI pop for every button press.
      sweep(c, bus, t, 0.05, 'sine', 950, 620, 0.28);
      break;
    }
    case 'roll': {
      // Dice tumble: five descending ticks, like a die knocking the tray.
      for (let i = 0; i < 5; i++) {
        noiseBurst(c, bus, t + i * 0.07, 0.035, 1400 - i * 180, 0.55 - i * 0.07);
      }
      break;
    }
    case 'hop': {
      sweep(c, bus, t, 0.09, 'square', 420, 660, 0.3);
      break;
    }
    case 'step': {
      // Footstep tick — one per crossed cell; pitch alternates like
      // left/right feet so long runs read as walking, not a stutter.
      const base = variant % 2 === 0 ? 460 : 560;
      sweep(c, bus, t, 0.05, 'triangle', base, base + 90, 0.24);
      break;
    }
    case 'capture': {
      sweep(c, bus, t, 0.28, 'sawtooth', 320, 70, 0.4);
      noiseBurst(c, bus, t + 0.05, 0.12, 700, 0.35);
      break;
    }
    case 'win': {
      [523, 659, 784, 1047].forEach((hz, i) => {
        tone(c, bus, hz, t + i * 0.12, 0.4, 'triangle', 0.5);
      });
      break;
    }
    case 'shield': {
      tone(c, bus, 880, t, 0.25, 'sine', 0.35);
      tone(c, bus, 894, t, 0.25, 'sine', 0.25); // detuned shimmer
      break;
    }
    case 'power': {
      sweep(c, bus, t, 0.14, 'square', 200, 880, 0.35);
      break;
    }
  }
}

/** Frequency-sweep note (zaps, stings, hops). */
function sweep(
  c: AudioContext,
  bus: GainNode,
  at: number,
  dur: number,
  type: OscillatorType,
  fromHz: number,
  toHz: number,
  vol: number,
): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g);
  g.connect(bus);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** Band-passed white-noise hit (dice ticks, impacts). */
function noiseBurst(
  c: AudioContext,
  bus: GainNode,
  at: number,
  dur: number,
  hz: number,
  vol: number,
): void {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = hz;
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(bus);
  src.start(at);
  src.stop(at + dur + 0.02);
}
