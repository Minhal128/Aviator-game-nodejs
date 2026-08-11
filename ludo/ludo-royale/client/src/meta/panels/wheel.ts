/**
 * LUCKY WHEEL panel — the wheel is DRAWN (overlay-local <canvas>, no Phaser):
 * 8 candy segments from GET /wheel, gold rim, top pointer. A spin POSTs
 * /wheel/spin, then rotates the canvas wrapper with a ~4s decelerating
 * cubic-bezier that lands EXACTLY on the winning segment (forward-only
 * cumulative rotation so back-to-back spins keep momentum). Prize
 * celebration: label pop + coins/gems flight to the HUD + balances straight
 * from the spin response. Endpoint 404 (flag off / not deployed yet) shows
 * a friendly "warming up" state — the contract lands with a parallel agent.
 */
import { errText, t } from '../../i18n';
import { LR_COLORS, cssColor } from '../../theme/tokens';
import { api, MetaApiError } from '../api';
import type { WheelSegment, WheelState } from '../api';
import { formatCompact } from '../format';
import { bumpBalance, metaState, refreshEquipment, refreshProfile, setWheelSpins } from '../store';
import { button, confettiBurst, el, flyReward, openPanel, reducedMotion, starBurst } from '../ui';

const WHEEL_SIZE = 440;
const SPIN_MS = 4000;
const SPIN_TURNS = 5;

/** Candy palette rotation for the 8 segments; jackpot always gold. */
const SEGMENT_COLORS: readonly number[] = [
  LR_COLORS.cardOnlineA,
  LR_COLORS.brand2,
  LR_COLORS.success,
  LR_COLORS.info,
  LR_COLORS.cardCpuB,
  LR_COLORS.gem500,
  LR_COLORS.warning,
  LR_COLORS.brand1,
];

export function openWheelPanel(): void {
  openPanel(t('wheel.title'), ({ body }) => {
    body.append(el('p', 'lr-muted lr-center', t('common.loading')));
    void api
      .getWheel()
      .then((state) => {
        setWheelSpins(state.spinsLeft);
        body.replaceChildren();
        render(body, state);
      })
      .catch((err: unknown) => {
        if (err instanceof MetaApiError && err.status === 404) setWheelSpins(null);
        body.replaceChildren(el('p', 'lr-muted lr-center', t('wheel.unavailable')));
      });
  });
}

function render(body: HTMLElement, state: WheelState): void {
  const stage = el('div', 'lr-wheel');
  const pointer = el('span', 'lr-wheel__pointer');
  const disc = el('div', 'lr-wheel__disc');
  disc.append(drawWheel(state.segments));
  const hub = el('span', 'lr-wheel__hub');
  stage.append(disc, pointer, hub);

  const prizeLine = el('p', 'lr-wheel__prize');
  const spinsLine = el('p', 'lr-muted lr-center', spinsLabel(state.spinsLeft));
  const spinBtn = button('lr-btn lr-btn--collect', t('wheel.spin'), () => spin());
  spinBtn.disabled = state.spinsLeft <= 0;

  body.append(stage, prizeLine, spinsLine, spinBtn);

  let rotation = 0;
  let spinning = false;

  const spin = (): void => {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    prizeLine.textContent = '';
    void api
      .spinWheel()
      .then((result) => {
        const index = Math.max(
          0,
          state.segments.findIndex((s) => s.id === result.segmentId),
        );
        const segAngle = 360 / state.segments.length;
        // Segment i is drawn from (i·seg) clockwise starting at 12 o'clock;
        // landing its CENTER under the top pointer needs this disc angle:
        const target = 360 - (index * segAngle + segAngle / 2);
        const current = ((rotation % 360) + 360) % 360;
        const forward = (target - current + 360) % 360;
        rotation += (reducedMotion() ? 0 : SPIN_TURNS * 360) + forward;

        const settle = (): void => {
          spinning = false;
          setWheelSpins(result.spinsLeft);
          spinsLine.textContent = spinsLabel(result.spinsLeft);
          spinBtn.disabled = result.spinsLeft <= 0;
          const prize = result.prize;
          if (prize.type === 'coins' || prize.type === 'gems') {
            // The server already credited the prize; reflect it on the HUD by
            // applying the delta (bumpBalance emits 'profile' -> the coin/gem
            // pills tick up). The prize amount IS the delta.
            if (metaState.profile !== null) bumpBalance(prize.type, prize.amount);
            else void refreshProfile().catch(() => undefined);
            prizeLine.textContent = t(
              prize.type === 'coins' ? 'wheel.prize_coins' : 'wheel.prize_gems',
              { n: prize.amount },
            );
            flyReward(prize.type, stage, 12);
            confettiBurst(body);
            starBurst(body);
          } else if (prize.type === 'item') {
            prizeLine.textContent = t('wheel.prize_item');
            confettiBurst(body);
            starBurst(body);
            void refreshEquipment().catch(() => undefined);
          } else {
            prizeLine.textContent = t('wheel.prize_nothing');
          }
          prizeLine.classList.remove('lr-wheel__prize--pop');
          void prizeLine.offsetWidth;
          prizeLine.classList.add('lr-wheel__prize--pop');
        };

        if (reducedMotion()) {
          disc.style.transition = 'none';
          disc.style.transform = `rotate(${rotation}deg)`;
          settle();
          return;
        }
        disc.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.75, 0.18, 1)`;
        disc.style.transform = `rotate(${rotation}deg)`;
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          settle();
        };
        disc.addEventListener('transitionend', finish, { once: true });
        window.setTimeout(finish, SPIN_MS + 400); // safety net if the tab hid
      })
      .catch((err: unknown) => {
        spinning = false;
        spinBtn.disabled = false;
        prizeLine.textContent =
          err instanceof MetaApiError ? errText(err.code, t('err.ERR_INTERNAL')) : t('err.ERR_NETWORK');
      });
  };
}

function spinsLabel(n: number): string {
  return n > 0 ? t('wheel.spins_left', { n }) : t('wheel.no_spins');
}

/** Paint the segment disc once at 2x for crisp edges. */
function drawWheel(segments: WheelSegment[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const S = 2;
  canvas.width = WHEEL_SIZE * S;
  canvas.height = WHEEL_SIZE * S;
  canvas.className = 'lr-wheel__canvas';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(S, S);

  const c = WHEEL_SIZE / 2;
  const rOuter = c - 4;
  const rInner = rOuter - 14; // gold rim thickness
  const n = Math.max(1, segments.length);
  const seg = (Math.PI * 2) / n;
  const top = -Math.PI / 2;

  // Gold rim.
  ctx.beginPath();
  ctx.arc(c, c, rOuter, 0, Math.PI * 2);
  ctx.fillStyle = cssColor(LR_COLORS.gold500);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = cssColor(LR_COLORS.gold700);
  ctx.stroke();

  segments.forEach((segment, i) => {
    const start = top + i * seg;
    const end = start + seg;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, rInner, start, end);
    ctx.closePath();
    const color =
      segment.kind === 'jackpot'
        ? LR_COLORS.gold300
        : (SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? LR_COLORS.brand2);
    ctx.fillStyle = cssColor(color);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssColor(LR_COLORS.sceneCream);
    ctx.stroke();

    // Prize glyph + amount along the segment's bisector (UX sprint §3 —
    // "×500" with a mini coin / "×5" with a gem, never a raw i18n key).
    // After rotate(mid + π/2), local -y points toward the rim: glyph sits
    // near the rim, the amount reads below it toward the hub.
    const mid = start + seg / 2;
    ctx.save();
    ctx.translate(c + Math.cos(mid) * rInner * 0.62, c + Math.sin(mid) * rInner * 0.62);
    ctx.rotate(mid + Math.PI / 2);
    const hasGlyph = segment.kind !== 'nothing';
    if (segment.kind === 'gems') drawGemGlyph(ctx, 0, -26, 13);
    else if (hasGlyph) drawCoinGlyph(ctx, 0, -26, 13);
    const label = segmentText(segment);
    const fontPx = label.length > 5 ? 17 : 22;
    ctx.font = `800 ${fontPx}px "Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const dark = segment.kind === 'jackpot';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = cssColor(dark ? LR_COLORS.gold300 : LR_COLORS.titleStrokeCool);
    ctx.fillStyle = cssColor(dark ? LR_COLORS.titleStrokeBrown : LR_COLORS.textOnDark);
    const textY = hasGlyph ? 12 : 0;
    ctx.strokeText(label, 0, textY);
    ctx.fillText(label, 0, textY);
    ctx.restore();
  });

  // Inner hub ring shadow for depth.
  ctx.beginPath();
  ctx.arc(c, c, 40, 0, Math.PI * 2);
  ctx.fillStyle = cssColor(LR_COLORS.gold700);
  ctx.fill();

  return canvas;
}

/**
 * Human text for a segment. Server labels sometimes arrive as raw i18n keys
 * (`wheel_seg_500`) — key-shaped labels are ignored and the text derives
 * from kind+amount instead, so the wheel never paints a translation key.
 */
function segmentText(segment: WheelSegment): string {
  const label = segment.label.trim();
  const keyLike = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i.test(label);
  if (label !== '' && !keyLike) return label;
  if (segment.kind === 'nothing') return t('wheel.seg_nothing');
  if (segment.kind === 'jackpot') return t('wheel.jackpot');
  return `×${formatCompact(segment.amount)}`;
}

/** Mini gold coin painted into the segment (matches the coin_gold bake). */
function drawCoinGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = cssColor(LR_COLORS.gold300);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = cssColor(LR_COLORS.gold700);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r - 4.5, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = cssColor(LR_COLORS.gold500);
  ctx.stroke();
  ctx.restore();
}

/** Mini violet gem (five-point cut, matches the gem_violet bake). */
function drawGemGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.95, y - r * 0.35);
  ctx.lineTo(x + r * 0.6, y + r);
  ctx.lineTo(x - r * 0.6, y + r);
  ctx.lineTo(x - r * 0.95, y - r * 0.35);
  ctx.closePath();
  ctx.fillStyle = cssColor(LR_COLORS.gem500);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = cssColor(LR_COLORS.gem700);
  ctx.stroke();
  // Top-light facet.
  ctx.beginPath();
  ctx.moveTo(x, y - r + 3);
  ctx.lineTo(x + r * 0.5, y - r * 0.28);
  ctx.lineTo(x - r * 0.5, y - r * 0.28);
  ctx.closePath();
  ctx.fillStyle = cssColor(LR_COLORS.gem300);
  ctx.fill();
  ctx.restore();
}
