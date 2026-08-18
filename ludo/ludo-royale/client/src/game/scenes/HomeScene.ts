/**
 * Home on the twilight stage (ARTPASS-GAMEFEEL §1–§3): scene backdrop with
 * parallax skyline + floating decor, diorama mode cards, and the "todo se
 * mueve" ambient inventory — card breathing, CTA shimmer and occasional
 * gold sparks. Ambient budget: ≤24 tweens / ≤40 live sprites (twinkle is
 * update-driven and costs zero tweens); everything ambient is OFF under
 * reduced motion.
 *
 * Sprint 3c: the Home SHELL chrome (top HUD, events row, bottom nav,
 * ticker, panels) is the DOM overlay (§4.6, src/meta/) — this scene keeps
 * ONLY the backdrop and the mode cards, laid out for the chrome bands:
 * HUD + events row above (~250 logical px), ticker + nav below (~160).
 * The old Phaser logo/tagline/version text moved out (the splash carries
 * the brand; the shell covers those bands).
 *
 * Sprint 2 (Gate 1 decision): the hero card is ONLINE Quick Match, above
 * vs CPU and Pass & Play. Home also retries a stored reconnection token so
 * a reloaded tab jumps straight back into its live match (§6.6).
 */
import Phaser from 'phaser';
import type { AiLevel, PlayerColor } from '@ludo/shared';
import { PLAYER_COLORS } from '@ludo/shared';
import { GAME_W } from '../layout';
import { LR_ART, LR_COLORS } from '../../theme/tokens';
import { perfTweaks } from '../../core/perf';
import { t } from '../../i18n';
import { Button } from '../ui/Button';
import { MODE_CARD_GRID_W, ModeCard } from '../ui/ModeCard';
import type { ModeCardKind } from '../ui/ModeCard';
import { CodeInput } from '../ui/CodeInput';
import { ensurePlayerName } from '../ui/NamePrompt';
import { SceneBackdrop } from '../objects/SceneBackdrop';
import { gameText, uiText } from '../ui/text';
import { reducedMotion, tweenP } from '../fx/Juice';
import { api } from '../../meta/api';
import type { StakeTier } from '../../meta/api';
import { metaState, on as onMeta } from '../../meta/store';
import { sfx } from '../../core/audio';
import { ColyseusClient } from '../net/ColyseusClient';
import { Toast } from '../ui/Toast';
import type { MatchInit } from '../matchTypes';
import type { WaitingParams } from './WaitingScene';

type HomeStep = 'root' | 'online' | 'private' | 'create' | 'join' | 'cpu' | 'local';

export class HomeScene extends Phaser.Scene {
  private panel?: Phaser.GameObjects.Container;
  private cards: ModeCard[] = [];
  private sparkEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private connecting = false;
  /** CLASSIC vs POWER (Ludo World parity) — sticky across menu steps. */
  private powerSelected = false;
  /** vs CPU board color (Ludo World Computer tab) — sticky like the mode. */
  // Green owns the bottom-left yard — the local player reads "abajo a la
  // izquierda" like LW's You (Jose). Still overridable in the color picker.
  private colorSelected: PlayerColor = 'green';
  private levelSelected: AiLevel = 'easy';
  private playersSelected: 2 | 3 | 4 = 2;
  private mascot?: Phaser.GameObjects.Container;
  /** Cash stake for online tables (1 coin = ₹1). */
  private tiers: StakeTier[] = [];
  private tierSelected: number | null = null;
  private tiersFetched = false;
  private step: HomeStep = 'root';
  private toast?: Toast;

  constructor() {
    super('Home');
  }

  create(): void {
    // Phaser reuses scene instances: drop refs to last visit's objects.
    this.cards = [];
    this.panel = undefined;
    this.sparkEmitter = undefined;
    this.connecting = false;
    this.tiers = [];
    this.tiersFetched = false;
    this.step = 'root';
    this.toast = new Toast(this, GAME_W / 2, 200);
    // A shutdown mid-entrance leaves input disabled (its unlock timer died
    // with the Clock) — every fresh visit must start unlocked.
    this.input.enabled = true;
    new SceneBackdrop(this, 'game');
    void this.loadTiers();

    if (!reducedMotion()) {
      // Periodic loops fire from single timers with jitter — never update().
      if (perfTweaks().shimmer) this.scheduleShimmer(); // §2 lite: shimmer OFF
      this.scheduleSparks();
    }

    this.showStep('root');
    this.buildMascot();
    this.mascot?.setVisible(false);

    // §6.6: a reloaded tab with a live reconnection token resumes its match.
    void this.tryResume();
  }

  private showStep(step: HomeStep): void {
    this.step = step;
    this.panel?.destroy();
    this.cards = [];
    // The buddy only fronts the root menu — submenus need the space.
    this.mascot?.setVisible(false);
    // LW parity: setup screens take the WHOLE display — the DOM chrome
    // (HUD, events, nav, ticker) only frames the root menu.
    document.getElementById('lr-root')?.classList.toggle('lr-root--hidden', step !== 'root');
    const panel = this.add.container(GAME_W / 2, 680);
    this.panel = panel;

    if (step === 'root') {
      // LUDOWORLD-PARITY §2.1: fat full-width hero + a 2-col pair below it,
      // centered in the band the DOM chrome leaves free (HUD + events row
      // above ≈250px, ticker + nav below ≈160px).
      // LW parity (Jose reference): FOUR equal fat tiles in a 2x2 grid.
      const gx = (MODE_CARD_GRID_W + 16) / 2;
      const defs: [ModeCardKind, string, string, string | undefined, () => void][] = [
        ['online', t('home.play_online'), t('home.play_online_sub'), t('home.badge_live'), () => this.showStep('online')],
        ['private', t('home.private_room'), t('home.private_sub'), undefined, () => this.showStep('private')],
        ['cpu', t('home.vs_cpu'), t('home.vs_cpu_sub'), undefined, () => this.showStep('cpu')],
        ['local', t('home.pass_play'), t('home.pass_play_sub'), t('home.badge_hot'), () => this.showStep('local')],
      ];
      defs.forEach(([kind, title, sub, badge, onTap], i) => {
        const card = new ModeCard(
          this,
          i % 2 === 0 ? -gx : gx,
          i < 2 ? -180 : 80,
          kind,
          title,
          sub,
          badge,
          onTap,
        );
        panel.add(card);
        this.cards.push(card);
      });
      this.cards.forEach((card, i) => card.startAmbient(i));
    } else if (step === 'online') {
      // Same full-screen skeleton as vs CPU / local: pick mode + table
      // size, one fat JUGAR that queues quick matchmaking. The private
      // room has its own root tile, so no shortcut here.
      this.setupHeader(panel, t('home.play_online'));
      this.setupSection(panel, -500, 176, t('home.select_mode'));
      this.optionRow(
        panel,
        -380,
        [t('home.mode_classic'), t('home.mode_power')],
        this.powerSelected ? 1 : 0,
        330,
        (i) => {
          this.powerSelected = i === 1;
          this.showStep(step);
        },
      );
      this.setupSection(panel, -304, 176, t('home.select_players'));
      const sizes: (2 | 3 | 4)[] = [2, 3, 4];
      this.optionRow(
        panel,
        -184,
        [t('home.players_2'), t('home.players_3'), t('home.players_4')],
        sizes.indexOf(this.playersSelected),
        215,
        (i) => {
          this.playersSelected = sizes[i] ?? 2;
          this.showStep(step);
        },
      );
      this.setupSection(panel, -70, 176, t('home.select_stake'));
      this.stakeRow(panel, 50, step);
      panel.add(
        new Button(
          this,
          0,
          190,
          460,
          108,
          t('home.start'),
          'amber',
          () =>
            this.goOnline({
              kind: 'quick',
              size: this.playersSelected,
              powerMode: this.powerSelected,
              tierId: this.tierSelected,
            }),
          30,
        ),
      );
    } else if (step === 'private') {
      this.setupHeader(panel, t('home.private_room'));
      panel.add(new Button(this, 0, -300, 460, 108, t('home.create_room'), 'amber', () => this.showStep('create'), 30));
      panel.add(new Button(this, 0, -160, 460, 108, t('home.join_room'), 'brand', () => this.showStep('join'), 30));
    } else if (step === 'create') {
      this.setupHeader(panel, t('home.create_room'), 'private');
      this.setupSection(panel, -500, 176, t('home.select_mode'));
      this.optionRow(
        panel,
        -380,
        [t('home.mode_classic'), t('home.mode_power')],
        this.powerSelected ? 1 : 0,
        330,
        (i) => {
          this.powerSelected = i === 1;
          this.showStep(step);
        },
      );
      this.setupSection(panel, -304, 176, t('home.select_players'));
      const sizesCreate: (2 | 3 | 4)[] = [2, 3, 4];
      this.optionRow(
        panel,
        -184,
        [t('home.players_2'), t('home.players_3'), t('home.players_4')],
        sizesCreate.indexOf(this.playersSelected),
        215,
        (i) => {
          this.playersSelected = sizesCreate[i] ?? 2;
          this.showStep(step);
        },
      );
      this.setupSection(panel, -70, 176, t('home.select_stake'));
      this.stakeRow(panel, 50, step);
      panel.add(
        new Button(
          this,
          0,
          190,
          460,
          108,
          t('home.create_room'),
          'amber',
          () =>
            this.goOnline({
              kind: 'create',
              size: this.playersSelected,
              powerMode: this.powerSelected,
              tierId: this.tierSelected,
            }),
          30,
        ),
      );
    } else if (step === 'join') {
      this.setupHeader(panel, t('home.enter_code'), 'private');
      // Dark card behind the keypad — the bright sky washes it out bare.
      const g = this.add.graphics();
      g.fillStyle(0x3d3480, 0.72);
      g.fillRoundedRect(-345, -484, 690, 496, 26);
      g.lineStyle(2, 0xffffff, 0.14);
      g.strokeRoundedRect(-345, -484, 690, 496, 26);
      panel.add(g);
      panel.add(new CodeInput(this, 0, -420, (code) => this.goOnline({ kind: 'join', code })));
    } else if (step === 'cpu') {
      // FULL-SCREEN setup (Jose round 4, LW reference): header with back
      // chevron + big titled sections; the home chrome is hidden.
      this.setupHeader(panel, t('home.vs_cpu'));
      this.setupSection(panel, -572, 176, t('home.select_mode'));
      this.optionRow(
        panel,
        -452,
        [t('home.mode_classic'), t('home.mode_power')],
        this.powerSelected ? 1 : 0,
        330,
        (i) => {
          this.powerSelected = i === 1;
          this.showStep(step);
        },
      );
      this.setupSection(panel, -380, 176, t('home.select_level'));
      const levels: AiLevel[] = ['easy', 'medium', 'hard'];
      this.optionRow(
        panel,
        -260,
        [t('home.level_easy'), t('home.level_medium'), t('home.level_hard')],
        levels.indexOf(this.levelSelected),
        215,
        (i) => {
          this.levelSelected = levels[i] ?? 'easy';
          this.showStep(step);
        },
      );
      this.setupSection(panel, -188, 176, t('home.select_players'));
      const sizes: (2 | 3 | 4)[] = [2, 3, 4];
      this.optionRow(
        panel,
        -68,
        [t('home.players_2'), t('home.players_3'), t('home.players_4')],
        sizes.indexOf(this.playersSelected),
        215,
        (i) => {
          this.playersSelected = sizes[i] ?? 2;
          this.showStep(step);
        },
      );
      this.setupSection(panel, 4, 218, t('home.select_color'));
      this.colorRow(panel, 130, step);
      panel.add(
        new Button(
          this,
          0,
          304,
          460,
          108,
          t('home.start'),
          'amber',
          () => void this.startCpuMatch(),
          30,
        ),
      );
    } else {
      this.setupHeader(panel, t('home.pass_play'));
      this.setupSection(panel, -500, 176, t('home.select_mode'));
      this.optionRow(
        panel,
        -380,
        [t('home.mode_classic'), t('home.mode_power')],
        this.powerSelected ? 1 : 0,
        330,
        (i) => {
          this.powerSelected = i === 1;
          this.showStep(step);
        },
      );
      this.setupSection(panel, -304, 176, t('home.select_players'));
      const sizes: (2 | 3 | 4)[] = [2, 3, 4];
      this.optionRow(
        panel,
        -184,
        [t('home.players_2'), t('home.players_3'), t('home.players_4')],
        sizes.indexOf(this.playersSelected),
        215,
        (i) => {
          this.playersSelected = sizes[i] ?? 2;
          this.showStep(step);
        },
      );
      panel.add(
        new Button(
          this,
          0,
          -20,
          460,
          108,
          t('home.start'),
          'amber',
          () =>
            this.startMatch({
              mode: 'local',
              numPlayers: this.playersSelected,
              aiLevel: 'easy',
              powerMode: this.powerSelected,
            }),
          30,
        ),
      );
    }

    // Stagger slide-up entrance (§6-A motion, Back.easeOut).
    // INVARIANT — animate the CONTAINERS themselves (the panel children),
    // never their inner visuals: the input hitArea lives on the container,
    // so tweening container.y keeps visual and tap zone in lockstep and the
    // settled position equals the visual center (see ModeCard invariant).
    if (!reducedMotion()) {
      // UX sprint §2 input robustness: taps DURING the entrance used to land
      // on buttons still in transit (the known bug). Scene input sleeps until
      // the last child settles; create() re-arms it defensively in case a
      // scene switch kills the unlock timer.
      this.input.enabled = false;
      const settleMs = 260 + (panel.list.length - 1) * 40 + 40;
      this.time.delayedCall(settleMs, () => {
        this.input.enabled = true;
      });
      panel.list.forEach((child, i) => {
        const obj = child as unknown as { y: number; setAlpha(a: number): unknown };
        const targetY = obj.y;
        obj.y = targetY + 30;
        obj.setAlpha(0);
        this.tweens.add({
          targets: obj,
          y: targetY,
          alpha: 1,
          duration: 260,
          delay: i * 40,
          ease: 'Back.easeOut',
        });
      });
    }
  }

  /**
   * Home buddy (Jose: "un personaje que suba de nivel y se mueva"): the
   * dice mascot stands on the podium, bobs/tilts idly, hops now and then,
   * wears the player's level on a gold pill and celebrates when tapped.
   * The aura tint climbs with level brackets so progress SHOWS on him.
   */
  private buildMascot(): void {
    if (!this.textures.exists('art_mascot')) return;
    this.mascot?.destroy();
    const root = this.add.container(GAME_W / 2, 1092).setDepth(5);
    this.mascot = root;

    const levelOf = (): number => metaState.profile?.xp.level ?? 1;
    const auraColor = (lv: number): number | null =>
      lv >= 20
        ? LR_COLORS.gem500
        : lv >= 10
          ? LR_COLORS.gold500
          : lv >= 5
            ? LR_COLORS.brand300
            : null;

    const shadow = this.add.ellipse(0, 2, 122, 26, LR_COLORS.sceneShadowInk, 0.35);
    const aura = this.add
      .image(0, -80, 'fx_glow')
      .setScale(2.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    const body = this.add.container(0, 0);
    const img = this.add.image(0, 6, 'art_mascot').setOrigin(0.5, 1);
    img.setScale(196 / img.height);
    body.add(img);
    root.add([shadow, aura, body]);

    // Level pill at the feet.
    const pg = this.add.graphics();
    pg.fillStyle(LR_COLORS.hudInk, 0.95);
    pg.fillRoundedRect(-52, -9, 104, 34, 17);
    pg.lineStyle(2, LR_COLORS.gold500, 0.9);
    pg.strokeRoundedRect(-52, -9, 104, 34, 17);
    const pillText = uiText(this, 0, 8, '', 15, LR_COLORS.textOnDark, '800');
    root.add([pg, pillText]);

    const refresh = (): void => {
      const lv = levelOf();
      pillText.setText(t('hud.level', { n: lv }));
      const tint = auraColor(lv);
      aura.setAlpha(tint === null ? 0 : 0.38);
      if (tint !== null) aura.setTint(tint);
    };
    refresh();
    const offProfile = onMeta('profile', refresh);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offProfile);

    // Hop (small = idle wander, big = tap celebration) with land squash.
    let busy = false;
    const hop = async (big: boolean): Promise<void> => {
      if (busy || reducedMotion() || !this.scene.isActive('Home')) return;
      busy = true;
      await tweenP(this, {
        targets: body,
        y: big ? -44 : -20,
        duration: big ? 230 : 180,
        ease: 'Quad.easeOut',
        yoyo: true,
      });
      body.setScale(1.07, 0.9);
      await tweenP(this, { targets: body, scaleX: 1, scaleY: 1, duration: 170, ease: 'Back.easeOut' });
      busy = false;
    };

    root.setSize(150, 210);
    root.setInteractive(new Phaser.Geom.Rectangle(0, -95, 150, 210), Phaser.Geom.Rectangle.Contains);
    root.on(Phaser.Input.Events.POINTER_DOWN, () => {
      sfx('hop');
      void hop(true);
      // Gold spark pop around the buddy.
      if (reducedMotion()) return;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spark = this.add
          .image(Math.cos(a) * 26, -70 + Math.sin(a) * 26, 'fx_spark')
          .setTint(LR_COLORS.gold300)
          .setScale(0.3)
          .setBlendMode(Phaser.BlendModes.ADD);
        root.add(spark);
        this.tweens.add({
          targets: spark,
          x: Math.cos(a) * 92,
          y: -70 + Math.sin(a) * 92,
          scale: 0.05,
          alpha: 0,
          duration: 480,
          ease: 'Quad.easeOut',
          onComplete: () => spark.destroy(),
        });
      }
    });

    if (!reducedMotion()) {
      // Idle: breathe-bob on the IMAGE (hop owns the body container's y).
      this.tweens.add({
        targets: img,
        y: -2,
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.tweens.add({
        targets: body,
        angle: { from: -2, to: 2 },
        duration: 3400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      const scheduleHop = (): void => {
        this.time.delayedCall(5200 + Math.random() * 3200, () => {
          if (root.visible) void hop(false);
          scheduleHop();
        });
      };
      scheduleHop();
    }
  }

  /** Full-screen setup header: back chevron + big title (LW). */
  private setupHeader(panel: Phaser.GameObjects.Container, title: string, backTo: HomeStep = 'root'): void {
    const back = this.add.container(-300, -616);
    const g = this.add.graphics();
    g.fillStyle(0x3d3480, 0.9);
    g.fillRoundedRect(-32, -32, 64, 64, 18);
    g.lineStyle(2, 0xffffff, 0.25);
    g.strokeRoundedRect(-32, -32, 64, 64, 18);
    back.add(g);
    back.add(uiText(this, -1, -1, '❮', 26, LR_COLORS.textOnDark, '800'));
    back.setSize(88, 88);
    back.setInteractive(new Phaser.Geom.Rectangle(0, 0, 88, 88), Phaser.Geom.Rectangle.Contains);
    back.on(Phaser.Input.Events.POINTER_DOWN, () => this.showStep(backTo));
    panel.add(back);
    panel.add(gameText(this, 0, -616, title, 38, { strokeColor: LR_COLORS.titleStrokeCool }));
  }

  /** LW setup section: rounded card with a BIG chunky title inside. */
  private setupSection(panel: Phaser.GameObjects.Container, y: number, h: number, title: string): void {
    const g = this.add.graphics();
    g.fillStyle(0x3d3480, 0.72);
    g.fillRoundedRect(-345, y, 690, h, 26);
    g.lineStyle(2, 0xffffff, 0.14);
    g.strokeRoundedRect(-345, y, 690, h, 26);
    panel.add(g);
    panel.add(gameText(this, 0, y + 42, title, 34, { strokeColor: LR_COLORS.titleStrokeCool }));
  }

  /** Option pills: selected = gold with a check, rest = LW blue (no white). */
  private optionRow(
    panel: Phaser.GameObjects.Container,
    y: number,
    labels: string[],
    selected: number,
    pillW: number,
    onPick: (i: number) => void,
  ): void {
    const gap = 14;
    const total = labels.length * pillW + (labels.length - 1) * gap;
    labels.forEach((label, i) => {
      const x = -total / 2 + pillW / 2 + i * (pillW + gap);
      const text = i === selected ? `${label} ✓` : label;
      panel.add(
        new Button(
          this,
          x,
          y,
          pillW,
          96,
          text,
          i === selected ? 'amber' : 'brand',
          () => {
            if (i !== selected) onPick(i);
          },
          22,
        ),
      );
    });
  }

  /** Color tiles with the real pawn art (LW "Select Color"). */
  private colorRow(panel: Phaser.GameObjects.Container, y: number, step: HomeStep): void {
    PLAYER_COLORS.forEach((color, i) => {
      const selected = color === this.colorSelected;
      const tile = this.add.container(-256 + i * 170, y);
      const g = this.add.graphics();
      g.fillStyle(selected ? LR_COLORS.gold500 : 0x5a67d8, selected ? 0.38 : 0.85);
      g.fillRoundedRect(-80, -56, 160, 112, 22);
      g.lineStyle(selected ? 5 : 3, selected ? LR_COLORS.gold300 : 0x3f4ab0, 1);
      g.strokeRoundedRect(-80, -56, 160, 112, 22);
      tile.add(g);
      const pawn = this.add.image(0, 44, `piece_${color}`).setOrigin(0.5, 1);
      pawn.setScale(94 / pawn.height);
      tile.add(pawn);
      if (selected) {
        const badge = this.add.circle(62, 38, 17, LR_COLORS.gold500, 1).setStrokeStyle(3, 0xffffff);
        tile.add(badge);
        tile.add(uiText(this, 62, 38, '✓', 18, LR_COLORS.textOnDark, '800'));
      }
      tile.setSize(160, 112);
      tile.setInteractive(new Phaser.Geom.Rectangle(0, 0, 160, 112), Phaser.Geom.Rectangle.Contains);
      tile.on(Phaser.Input.Events.POINTER_DOWN, () => {
        if (this.colorSelected === color) return;
        this.colorSelected = color;
        this.showStep(step);
      });
      panel.add(tile);
    });
  }

  /** Online entry: make sure the player has a name, then hand to the lobby. */
  private goOnline(params: WaitingParams): void {
    if (this.connecting) return;
    const fee = this.tiers.find((x) => x.id === params.tierId)?.entryFee ?? 0;
    const bal = metaState.profile?.wallet.coins ?? 0;
    if (fee > 0 && bal < fee) {
      void this.toast?.show(t('home.stake_short', { fee, bal }), 2200);
      return;
    }
    this.connecting = true;
    void ensurePlayerName().then(() => {
      // If we cannot hand off (scene already stopped/replaced), release the
      // guard so Home never comes back with online entry points wedged.
      if (this.scene.isActive('Home')) this.scene.start('Waiting', params);
      else this.connecting = false;
    });
  }

  private async loadTiers(): Promise<void> {
    try {
      const { tiers } = await api.getTiers();
      this.tiers = tiers;
      if (this.tierSelected == null && tiers[0]) this.tierSelected = tiers[0].id;
    } catch {
      this.tiers = [];
    }
    this.tiersFetched = true;
    // User often opens Play Online before the GET lands — redraw stake row.
    if (this.scene.isActive('Home') && (this.step === 'online' || this.step === 'create')) {
      this.showStep(this.step);
    }
  }

  private stakeRow(panel: Phaser.GameObjects.Container, y: number, step: HomeStep): void {
    if (this.tiers.length === 0) {
      const msg = this.tiersFetched ? '—' : t('home.stake_loading');
      panel.add(uiText(this, 0, y, msg, 18, LR_COLORS.textOnDark, '700').setOrigin(0.5));
      return;
    }
    const labels = this.tiers.map((tier) => `₹${tier.entryFee}`);
    const idx = Math.max(0, this.tiers.findIndex((tier) => tier.id === this.tierSelected));
    this.optionRow(panel, y, labels, idx, 155, (i) => {
      this.tierSelected = this.tiers[i]?.id ?? null;
      this.showStep(step);
    });
    const picked = this.tiers[idx];
    if (picked) {
      panel.add(
        uiText(
          this,
          0,
          y + 70,
          t('home.stake_hint', { name: picked.name, fee: picked.entryFee }),
          16,
          LR_COLORS.textOnDark,
          '600',
        ).setOrigin(0.5),
      );
    }
  }

  /** §6.6: silent resume attempt; jumps into the live match when it works. */
  private async tryResume(): Promise<void> {
    const driver = await ColyseusClient.resume();
    if (!driver) return;
    if (!this.scene.isActive('Home') || this.connecting) {
      driver.destroy();
      return;
    }
    const snap = driver.snapshot();
    const init: MatchInit = {
      mode: 'online',
      numPlayers: snap.config.numPlayers,
      aiLevel: 'easy',
      powerMode: snap.config.powerMode,
      driver,
      roomCode: driver.roomCode !== '' ? driver.roomCode : undefined,
    };
    this.scene.start('Game', init);
  }

  /** §3 shimmer scheduler: hero card + one companion, every 6–8s. */
  private scheduleShimmer(): void {
    const a = LR_ART.ambient;
    const delay = a.shimmerMinDelayMs + Math.random() * (a.shimmerMaxDelayMs - a.shimmerMinDelayMs);
    this.time.delayedCall(delay, () => {
      const hero = this.cards[0];
      hero?.playShimmer();
      const second = this.cards[1];
      if (second) this.time.delayedCall(300, () => second.playShimmer());
      this.scheduleShimmer();
    });
  }

  /** §3 ambient sparks: a small gold burst rises near the mode cards. */
  private scheduleSparks(): void {
    const a = LR_ART.ambient;
    const delay = a.sparkMinDelayMs + Math.random() * (a.sparkMaxDelayMs - a.sparkMinDelayMs);
    this.time.delayedCall(delay, () => {
      if (!reducedMotion()) {
        if (!this.sparkEmitter) {
          this.sparkEmitter = this.add.particles(0, 0, 'fx_spark', {
            speedY: { min: -90, max: -40 },
            speedX: { min: -30, max: 30 },
            lifespan: 900,
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.8, end: 0 },
            emitting: false,
            blendMode: Phaser.BlendModes.ADD,
            tint: [LR_COLORS.gold300, LR_COLORS.gold500],
          });
          this.sparkEmitter.setDepth(1);
        }
        const x = GAME_W / 2 + (Math.random() * 240 - 120);
        const y = Math.random() < 0.5 ? 480 : 730;
        this.sparkEmitter.explode(6 + Math.floor(Math.random() * 5), x, y);
      }
      this.scheduleSparks();
    });
  }

  private startingCpu = false;

  private startMatch(init: MatchInit): void {
    this.scene.start('Game', init);
  }

  /**
   * vs CPU: POWER matches pull the shop loadout FIRST — the match charges
   * are seeded from the owned powers (max 2 uses of each per match). A slow
   * or offline API degrades to an empty loadout, never blocks the play.
   */
  private async startCpuMatch(): Promise<void> {
    if (this.startingCpu) return;
    this.startingCpu = true;
    const init: MatchInit = {
      mode: 'cpu',
      numPlayers: this.playersSelected,
      aiLevel: this.levelSelected,
      powerMode: this.powerSelected,
      seatZeroColor: this.colorSelected,
    };
    if (this.powerSelected) {
      try {
        const res = await Promise.race([
          api.getPowerLoadout(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
        ]);
        init.humanLoadout = res.powers;
      } catch {
        init.humanLoadout = {};
      }
    }
    this.startingCpu = false;
    this.startMatch(init);
  }
}
