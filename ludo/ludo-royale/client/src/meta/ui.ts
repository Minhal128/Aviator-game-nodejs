/**
 * Overlay DOM toolkit — element helpers, the single-modal queue (STYLE-GUIDE
 * §11: max ONE popup at a time, extra ones queue), toasts, DOM count-ups and
 * the "reward flies to the HUD chip" flight (§6 count-up contract), plus the
 * bridge that exports Phaser's baked coin/gem canvases as <img> sources so
 * the DOM chrome shows the exact same procedural art as the canvas.
 */
import Phaser from 'phaser';
import { LR_RUNTIME } from '../theme/tokens';
import { haptic } from '../core/haptics';
import { sfx } from '../core/audio';
import { formatCompact } from './format';

export function reducedMotion(): boolean {
  return LR_RUNTIME.reducedMotion;
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, label: string, onTap: () => void): HTMLButtonElement {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    haptic('tap'); // §4: same 10ms tick as the canvas buttons — self-guarded
    sfx('tap');
    onTap();
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Phaser texture → DOM image bridge
// ---------------------------------------------------------------------------

let textureGame: Phaser.Game | null = null;
const dataUrlCache = new Map<string, string>();

export function bindTextureSource(game: Phaser.Game): void {
  textureGame = game;
}

/**
 * Export a baked texture (canvas) or shipped art PNG (image) as a data/src
 * URL. Returns null before the Splash bakes land — callers fall back to the
 * pure-CSS coin/gem swatches.
 */
export function textureUrl(key: string): string | null {
  const cached = dataUrlCache.get(key);
  if (cached !== undefined) return cached;
  if (!textureGame || !textureGame.textures.exists(key)) return null;
  const source: unknown = textureGame.textures.get(key).getSourceImage();
  let url: string | null = null;
  if (source instanceof HTMLCanvasElement) {
    url = source.toDataURL();
  } else if (
    source instanceof HTMLImageElement ||
    (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
  ) {
    // Phaser 4 loads file textures through blob: URLs and revokes them after
    // GPU upload — an <img src=blob:…> would render broken. Re-rasterize the
    // decoded pixels into a data URL instead (works for ImageBitmap too).
    const cv = document.createElement('canvas');
    cv.width = source.width;
    cv.height = source.height;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.drawImage(source as CanvasImageSource, 0, 0);
      url = cv.toDataURL();
    }
  }
  if (url !== null) dataUrlCache.set(key, url);
  return url;
}

/** `<img>` for a texture key with a CSS-class fallback when not baked yet. */
/**
 * Mouse/touch drag-to-scroll for a horizontal rail (tab bars). Wheel input
 * maps to horizontal scroll too. A real drag (>6px) swallows the click so
 * the chip underneath does not fire.
 */
export function dragScroll(rail: HTMLElement): void {
  let startX = 0;
  let startLeft = 0;
  let dragging = false;
  let moved = false;
  rail.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    startX = e.clientX;
    startLeft = rail.scrollLeft;
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) {
      moved = true;
      rail.classList.add('is-dragging');
      try {
        rail.setPointerCapture(e.pointerId);
      } catch {
        /* pointer may be gone already */
      }
    }
    if (moved) rail.scrollLeft = startLeft - dx;
  });
  const end = (): void => {
    dragging = false;
    rail.classList.remove('is-dragging');
  };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
  // Capture phase: a drag must not fire the click on the chip underneath.
  rail.addEventListener(
    'click',
    (e) => {
      if (!moved) return;
      moved = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  rail.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        rail.scrollBy({ left: e.deltaY });
        e.preventDefault();
      }
    },
    { passive: false },
  );
}

export function textureImg(key: string, className: string, fallbackClass: string): HTMLElement {
  const url = textureUrl(key);
  if (url === null) return el('span', `${className} ${fallbackClass}`);
  const img = el('img', className);
  img.src = url;
  img.alt = '';
  img.draggable = false;
  return img;
}

// ---------------------------------------------------------------------------
// Modal queue (max 1 visible — STYLE-GUIDE §11)
// ---------------------------------------------------------------------------

export interface ModalHandle {
  body: HTMLElement;
  close: () => void;
}

type ModalBuilder = (modal: ModalHandle) => void;

interface PendingModal {
  title: string;
  build: ModalBuilder;
  wide: boolean;
}

let overlayRoot: HTMLElement | null = null;
let activeModal: HTMLElement | null = null;
const modalQueue: PendingModal[] = [];

export function bindOverlayRoot(root: HTMLElement): void {
  overlayRoot = root;
}

export function openPanel(title: string, build: ModalBuilder, opts: { wide?: boolean } = {}): void {
  const pending: PendingModal = { title, build, wide: opts.wide ?? false };
  if (activeModal !== null) {
    modalQueue.push(pending);
    return;
  }
  presentModal(pending);
}

/** Leaving the Home shell: drop the queue and dismiss whatever is open. */
export function closeAllPanels(): void {
  modalQueue.length = 0;
  closeActivePanel();
}

export function closeActivePanel(): void {
  if (activeModal === null) return;
  const node = activeModal;
  activeModal = null;
  if (reducedMotion()) {
    node.remove();
  } else {
    node.classList.add('lr-modal--out');
    window.setTimeout(() => node.remove(), 180);
  }
  const next = modalQueue.shift();
  if (next) presentModal(next);
}

function presentModal(pending: PendingModal): void {
  if (!overlayRoot) return;
  const scrim = el('div', 'lr-modal');
  const panel = el('div', `lr-panel${pending.wide ? ' lr-panel--wide' : ''}`);

  const ribbon = el('div', 'lr-panel__ribbon');
  ribbon.append(el('span', 'lr-panel__ribbon-text', pending.title));
  const closeBtn = button('lr-panel__close', '✕', () => closeActivePanel());
  closeBtn.setAttribute('aria-label', 'close');

  const body = el('div', 'lr-panel__body');
  panel.append(ribbon, closeBtn, body);
  scrim.append(panel);
  // Tap outside the panel dismisses it (scrim only, not bubbled panel taps).
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) closeActivePanel();
  });

  activeModal = scrim;
  overlayRoot.append(scrim);
  pending.build({ body, close: () => closeActivePanel() });
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

let toastNode: HTMLElement | null = null;
let toastTimer = 0;

export function toast(message: string): void {
  if (!overlayRoot) return;
  if (toastNode === null) {
    toastNode = el('div', 'lr-toast');
    overlayRoot.append(toastNode);
  }
  // Max ONE toast, no queue (UX sprint §3): a new message replaces the
  // current one in place; an identical repeat (e.g. several failed fetches
  // reporting the same network error) only extends the visible time — it
  // never re-renders or stacks.
  const isRepeat =
    toastNode.classList.contains('lr-toast--show') && toastNode.textContent === message;
  if (!isRepeat) toastNode.textContent = message;
  toastNode.classList.add('lr-toast--show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastNode?.classList.remove('lr-toast--show');
  }, 2600);
}

// ---------------------------------------------------------------------------
// Count-up + reward flight
// ---------------------------------------------------------------------------

/** rAF-interpolated textContent (STYLE-GUIDE §6 DOM count-up). */
export function countUp(node: HTMLElement, from: number, to: number, ms = 600): void {
  if (from === to || reducedMotion()) {
    node.textContent = formatCompact(to);
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const f = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - f, 3); // cubic-out
    node.textContent = formatCompact(Math.round(from + (to - from) * eased));
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const flyTargets = new Map<string, HTMLElement>();

/** The HUD registers its coin/gem chips here as flight destinations. */
export function registerFlyTarget(kind: 'coins' | 'gems', node: HTMLElement): void {
  flyTargets.set(kind, node);
}

/**
 * Fly a burst of coin/gem sprites from `from` (an element or a point in
 * overlay-local 720×1280 coordinates) to the HUD chip. Pure-DOM WAAPI —
 * no Phaser coupling (§6 "canvas FX bridge" stays optional).
 */
export function flyReward(
  kind: 'coins' | 'gems',
  from: HTMLElement | { x: number; y: number },
  count = 6,
): void {
  if (!overlayRoot || reducedMotion()) return;
  const target = flyTargets.get(kind);
  if (!target) return;

  const rootRect = overlayRoot.getBoundingClientRect();
  const scale = rootRect.width / overlayRoot.offsetWidth || 1;
  const toRect = target.getBoundingClientRect();
  const toX = (toRect.left + toRect.width / 2 - rootRect.left) / scale;
  const toY = (toRect.top + toRect.height / 2 - rootRect.top) / scale;

  let fromX: number;
  let fromY: number;
  if (from instanceof HTMLElement) {
    const r = from.getBoundingClientRect();
    fromX = (r.left + r.width / 2 - rootRect.left) / scale;
    fromY = (r.top + r.height / 2 - rootRect.top) / scale;
  } else {
    fromX = from.x;
    fromY = from.y;
  }

  const key = kind === 'coins' ? 'coin_gold' : 'gem_violet';
  const n = Math.max(1, Math.min(count, 10));
  for (let i = 0; i < n; i++) {
    const bit = textureImg(key, 'lr-fly', kind === 'coins' ? 'lr-coin--css' : 'lr-gem--css');
    bit.style.left = `${fromX - 16}px`;
    bit.style.top = `${fromY - 16}px`;
    overlayRoot.append(bit);
    const spreadX = (Math.random() - 0.5) * 120;
    const spreadY = (Math.random() - 0.5) * 60;
    const anim = bit.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: '1' },
        {
          transform: `translate(${spreadX}px, ${spreadY - 40}px) scale(1.1)`,
          opacity: '1',
          offset: 0.35,
        },
        {
          transform: `translate(${toX - fromX}px, ${toY - fromY}px) scale(0.5)`,
          opacity: '0.9',
        },
      ],
      {
        duration: 500 + i * 60,
        delay: i * 40,
        easing: 'cubic-bezier(0.5, -0.2, 0.6, 1)',
        fill: 'forwards',
      },
    );
    anim.onfinish = () => {
      bit.remove();
      if (i === n - 1) pulse(target);
    };
  }
}

/** Quick attention pulse on a chrome node (chip receiving a reward). */
export function pulse(node: HTMLElement): void {
  if (reducedMotion()) return;
  node.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.12)' },
      { transform: 'scale(1)' },
    ],
    { duration: 260, easing: 'ease-out' },
  );
}

/** Confetti-lite burst inside a panel body (<800ms, DOM only). */
export function confettiBurst(host: HTMLElement): void {
  if (reducedMotion()) return;
  const colors = ['pink', 'gold', 'cyan', 'violet'];
  for (let i = 0; i < 14; i++) {
    const bit = el('span', `lr-confetti lr-confetti--${colors[i % colors.length]}`);
    bit.style.left = `${20 + Math.random() * 60}%`;
    bit.style.top = '30%';
    host.append(bit);
    const dx = (Math.random() - 0.5) * 320;
    const dy = 120 + Math.random() * 220;
    const anim = bit.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: '1' },
        {
          transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 540 - 270}deg)`,
          opacity: '0',
        },
      ],
      { duration: 700 + Math.random() * 100, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => bit.remove();
  }
}

/**
 * Radial star burst from the host's centre - the "you won!" splash. Emoji
 * stars fly out, pop to full size, then shrink and fade. No CSS dependency.
 */
export function starBurst(host: HTMLElement): void {
  if (reducedMotion()) return;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const star = el('span', 'lr-starburst');
    star.textContent = i % 3 === 0 ? '\u2728' : '\u2B50';
    star.style.position = 'absolute';
    star.style.left = '50%';
    star.style.top = '46%';
    star.style.fontSize = `${16 + Math.random() * 18}px`;
    star.style.pointerEvents = 'none';
    star.style.zIndex = '40';
    host.append(star);
    const ang = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.5;
    const dist = 90 + Math.random() * 130;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const spin = (Math.random() - 0.5) * 360;
    const anim = star.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.2) rotate(0deg)', opacity: '0' },
        {
          transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5}px)) scale(1.25) rotate(${spin * 0.5}deg)`,
          opacity: '1',
          offset: 0.4,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5) rotate(${spin}deg)`,
          opacity: '0',
        },
      ],
      { duration: 850 + Math.random() * 450, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => star.remove();
  }
}
