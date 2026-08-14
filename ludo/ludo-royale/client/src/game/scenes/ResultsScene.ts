/**
 * Results screen on the CelebrationPanel contract (ARTPASS-GAMEFEEL §5):
 * cream panel + gold frame + title ribbon; a human win gets the full
 * theatre (rays, glow, confetti-lite), other outcomes the calm framed
 * variant. Reward count-ups stay Sprint-3 DOM territory.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_W } from '../layout';
import { LR_COLORS, LR_FONTS, cssColor, dp } from '../../theme/tokens';
import { t } from '../../i18n';
import type { I18nKey } from '../../i18n';
import { CelebrationPanel } from '../ui/CelebrationPanel';
import { SceneBackdrop } from '../objects/SceneBackdrop';
import { uiText } from '../ui/text';
import { reducedMotion } from '../fx/Juice';
import type { ResultsData } from '../matchTypes';
import { refreshProfile } from '../../meta/store';

const PLACE_COLORS: readonly number[] = [
  LR_COLORS.gold500,
  0xc0c8d8, // silver
  LR_COLORS.gold700, // bronze
  LR_COLORS.textFaint,
];

export class ResultsScene extends Phaser.Scene {
  // Named `results` (not `data`) to avoid shadowing Phaser.Scene#data (DataManager).
  private results!: ResultsData;

  constructor() {
    super('Results');
  }

  init(data: ResultsData): void {
    this.results = data;
  }

  create(): void {
    new SceneBackdrop(this, 'game');

    const won = this.results.humanWon;
    // Online rematch is a Sprint-3 feature (the room already disconnected) —
    // offline modes keep the instant "Play Again".
    const actions =
      this.results.init.mode === 'online'
        ? [
            {
              label: t('results.home'),
              style: 'success' as const,
              onTap: () => this.scene.start('Home'),
            },
          ]
        : [
            {
              label: t('results.play_again'),
              style: 'success' as const,
              onTap: () => this.scene.start('Game', this.results.init),
            },
            {
              label: t('results.home'),
              style: 'amber' as const,
              onTap: () => this.scene.start('Home'),
            },
          ];
    new CelebrationPanel(this, {
      title: won ? t('game.victory') : t('results.title'),
      festive: won,
      width: 540,
      height: 660,
      actions,
      populate: (content) => this.buildRows(content),
    });

    if (won && !reducedMotion()) this.confettiLite();
    // online prizes already hit Laravel; refresh HUD coins from site wallet
    void refreshProfile().catch(() => undefined);
  }

  /** Champion HERO + medal rows + a motivating subtitle (Jose: impecable). */
  private buildRows(content: Phaser.GameObjects.Container): void {
    const rows = this.results.rows;
    const winner = rows.find((r) => r.place === 1);
    const rest = rows.filter((r) => r.place !== 1);

    if (winner) {
      const heroY = -168;
      const glow = this.add
        .image(0, heroY, 'fx_glow')
        .setScale(2.4)
        .setTint(LR_COLORS.gold300)
        .setAlpha(0.85)
        .setBlendMode(Phaser.BlendModes.ADD);
      content.add(glow);
      content.add(this.add.circle(0, heroY, 54, 0xffffff, 1).setStrokeStyle(5, LR_COLORS.gold500));
      content.add(this.avatarFor(winner, 0, heroY, 86));
      content.add(this.add.text(0, heroY - 82, '👑', { fontSize: '36px' }).setOrigin(0.5));
      content.add(
        this.add
          .text(0, heroY + 80, winner.name, {
            fontFamily: LR_FONTS.display,
            fontSize: '26px',
            fontStyle: '800',
            color: cssColor(LR_COLORS.text),
          })
          .setOrigin(0.5),
      );
      content.add(
        this.add
          .text(0, heroY + 102, `${t('results.place_1')} · ${t('results.champion')}`, {
            fontFamily: LR_FONTS.display,
            fontSize: '15px',
            fontStyle: '800',
            color: cssColor(LR_COLORS.gold700),
          })
          .setOrigin(0.5),
      );
    }

    // Vertical budget: the champion subtitle ends near -58 and the action
    // buttons start at panel-local y=126 — the stack lives in between with
    // clear air on both sides for every table size (2P/3P/4P).
    const n = rest.length;
    const rowW = 452;
    const rowH = n <= 1 ? 62 : n === 2 ? 58 : 48;
    const gap = n <= 2 ? 12 : 7;
    const startY = n <= 1 ? 10 : n === 2 ? 2 : -20;
    const medalR = n >= 3 ? 17 : 20;
    const avSize = n >= 3 ? 42 : 48;
    rest.forEach((row, i) => {
      const y = startY + i * (rowH + gap);
      const bg = this.add.graphics();
      bg.fillStyle(LR_COLORS.surface, 0.92);
      bg.fillRoundedRect(-rowW / 2, y - rowH / 2, rowW, rowH, dp(16));
      bg.lineStyle(1.5, LR_COLORS.borderStrong, 0.7);
      bg.strokeRoundedRect(-rowW / 2, y - rowH / 2, rowW, rowH, dp(16));
      content.add(bg);

      const placeColor = PLACE_COLORS[row.place - 1] ?? LR_COLORS.textFaint;
      content.add(
        this.add.circle(-rowW / 2 + 40, y, medalR, placeColor, 1).setStrokeStyle(2.5, 0xffffff),
      );
      const placeKey = `results.place_${Math.min(row.place, 4)}` as I18nKey;
      content.add(
        this.add
          .text(-rowW / 2 + 40, y, t(placeKey), {
            fontFamily: LR_FONTS.display,
            fontSize: n >= 3 ? '14px' : '16px',
            fontStyle: '800',
            color: '#ffffff',
          })
          .setOrigin(0.5),
      );
      content.add(this.avatarFor(row, -rowW / 2 + 92, y, avSize));
      // Name LEFT-aligned beside the avatar (a centered name floated oddly
      // in the empty row); the player's pawn closes the row on the right.
      content.add(
        uiText(this, -rowW / 2 + 132, y, row.name, n >= 3 ? 18 : 19, LR_COLORS.text, '800').setOrigin(
          0,
          0.5,
        ),
      );
      content.add(
        this.add
          .image(rowW / 2 - 38, y + avSize * 0.16, `piece_${row.color}`)
          .setOrigin(0.5, 0.74)
          .setScale((avSize * 0.8) / 176)
          .setAlpha(0.95),
      );
    });

    // Motivating close — only the 1v1 table has air for it (subY 75 sits
    // between the row bottom at 41 and the button top at 126).
    if (n === 1) {
      content.add(
        uiText(
          this,
          0,
          startY + 65,
          this.results.humanWon ? t('results.sub_win') : t('results.sub_lose'),
          16,
          LR_COLORS.textFaint,
          '700',
        ),
      );
    }

    const me =
      this.results.humanSeat != null
        ? this.results.rows.find((r) => r.seat === this.results.humanSeat)
        : undefined;
    const delta = me?.coinsDelta;
    if (typeof delta === 'number' && delta !== 0) {
      const abs = Math.abs(delta);
      const line =
        delta > 0
          ? t('results.payout_win', { n: abs })
          : t('results.payout_lose', { n: abs });
      content.add(
        uiText(this, 0, 95, line, 18, delta > 0 ? LR_COLORS.gold700 : LR_COLORS.textFaint, '800'),
      );
    }
  }

  /** Avatar of a row: your pet, CPU robot, or the color pawn. */
  private avatarFor(
    row: { seat: number; color: string },
    x: number,
    y: number,
    size: number,
  ): Phaser.GameObjects.Image {
    const isYou = this.results.humanSeat != null && row.seat === this.results.humanSeat;
    const key = isYou ? 'art_mascot' : this.results.init.mode === 'cpu' ? 'art_avatar_robot' : '';
    if (key !== '' && this.textures.exists(key)) {
      return this.add.image(x, y, key).setDisplaySize(size, size);
    }
    return this.add
      .image(x, y + size * 0.3, `piece_${row.color}`)
      .setOrigin(0.5, 0.74)
      .setScale(size / 176);
  }

  /** §5.8 confetti-lite: one small burst over the panel on a human win. */
  private confettiLite(): void {
    const em = this.add.particles(0, 0, 'fx_confetti', {
      speed: { min: 220, max: 420 },
      angle: { min: 240, max: 300 },
      gravityY: 500,
      lifespan: { min: 900, max: 1400 },
      rotate: { min: 0, max: 360 },
      scale: { min: 0.6, max: 1.1 },
      alpha: { start: 1, end: 0, ease: 'Expo.easeIn' },
      emitting: false,
      tint: [
        LR_COLORS.gold500,
        LR_COLORS.brand1,
        LR_COLORS.success,
        LR_COLORS.info,
        LR_COLORS.gold300,
      ],
    });
    em.setDepth(DEPTH.modal + 10); // above the panel
    this.time.delayedCall(360, () => em.explode(36, GAME_W / 2, 260));
    this.time.delayedCall(1000, () => em.explode(24, GAME_W / 2, 300));
  }
}
