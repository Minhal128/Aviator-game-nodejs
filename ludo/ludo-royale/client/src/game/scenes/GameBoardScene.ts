/**
 * GameBoardScene — the match (ARQUITECTURA §4.2). It only speaks to a
 * GameDriver (§4.5): Sprint 1b plugs OfflineDriver, Sprint 2 will plug
 * ColyseusClient with zero scene changes.
 *
 * Driver callbacks enqueue animation tasks into a serial queue, so engine
 * events (which resolve instantly) always render in order at juice speed:
 * dice tumble → hops → capture combo → turn change → victory.
 */
import Phaser from 'phaser';
import {
  describeMove,
  ENTRY_CELLS,
  HOME_STEPS,
  isFrozen,
  isOnTrack,
  isShielded,
  LAST_TRACK_STEP,
  SAFE_CELLS,
  SKIP_DISPLAY_MS,
  toAbsoluteCell,
  TRACK_SIZE,
} from '@ludo/shared';
import type {
  CaptureNotice,
  DiceMessage,
  EmoteShownMessage,
  MatchEndMessage,
  MoveResultMessage,
  PlayerStatusMessage,
  PowerType,
  PowerUsedMessage,
  Seat,
  TokenCollectedMessage,
  TokenSpawnedMessage,
  TrapTriggeredMessage,
  TurnMessage,
  TurnSkippedMessage,
} from '@ludo/shared';
import { GAME_H, ACTION, BOARD_SIZE, BOARD_Y, CHIP, DEPTH, GAME_W, HUD } from '../layout';
import { LR_ART, LR_BAKE_SCALE, LR_COLORS, LR_MOTION, cssColor, dp, LR_FONTS } from '../../theme/tokens';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import { errText, t } from '../../i18n';
import type { I18nKey } from '../../i18n';
import { OfflineDriver } from '../OfflineDriver';
import type { ConnectionStatus, MatchInit, ResultsData, SceneDriver, SeatInfo } from '../matchTypes';
import { api } from '../../meta/api';
import { metaState } from '../../meta/store';
import { formatCompact } from '../../meta/format';
import { DICE_SKINS, bakeGoBubble, ensureDiceSkin } from '../textures/bakeDice';
import { bakeBoard, boardTextureKey, normalizeBoardTheme } from '../textures/bakeBoard';
import {
  ensureTokenSkin,
  normalizeBubbleSkin,
  normalizeTokenSkin,
  pieceSkinKey,
} from '../textures/bakeSkins';
import type { DiceSkinId } from '../textures/bakeDice';
import { BoardView } from '../objects/BoardView';
import { SceneBackdrop } from '../objects/SceneBackdrop';
import { ensureInkPanel } from '../ui/toyBake';
import { PieceView } from '../objects/PieceView';
import { DiceView } from '../objects/DiceView';
import { AvatarChip } from '../objects/AvatarChip';
import { EmoteWheelView, EMOTES, TAUNTS, emoteArtKey } from '../objects/EmoteWheelView';
import { FxLayer } from '../fx/FxLayer';
import { playCaptureCombo } from '../fx/CaptureCombo';
import { playVictoryFx } from '../fx/VictoryFx';
import { delayP, pressFeedback, reducedMotion } from '../fx/Juice';
import { Toast } from '../ui/Toast';
import { uiText } from '../ui/text';
import { confirmModal } from '../ui/ConfirmModal';

/** How long a rival's landed mini die stays readable before fading out. */
const RIVAL_DICE_LINGER_MS = 700;

export class GameBoardScene extends Phaser.Scene {
  private matchInit!: MatchInit;
  private driver!: SceneDriver;
  private board!: BoardView;
  private fx!: FxLayer;
  private toast!: Toast;
  private dice!: DiceView;
  /** YOUR-turn cue: a pulsing glow behind the die + a bouncing finger above it. */
  private turnGlow!: Phaser.GameObjects.Arc;
  private turnPointer!: Phaser.GameObjects.Container;
  /** Tap-to-roll hit zone covering the WHOLE bubble (not just the GO glyph). */
  private rollZone!: Phaser.GameObjects.Zone;
  private tapLabel!: Phaser.GameObjects.Text;
  private goBubble!: Phaser.GameObjects.Image;
  private goText!: Phaser.GameObjects.Text;
  /** LW camera: clockwise quarter-turns so YOUR yard reads bottom-left. */
  private viewTurns = 0;
  private canRoll = false;
  private banner!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private seconds!: Phaser.GameObjects.Text;
  private emoteWheel!: EmoteWheelView;
  private emoteButton!: Phaser.GameObjects.Container;

  private seats: SeatInfo[] = [];
  private readonly chips = new Map<Seat, AvatarChip>();
  private readonly pieceViews = new Map<string, PieceView>();
  /** One transient tumbling die per rival seat (destroyed after linger). */
  private readonly rivalDice = new Map<Seat, DiceView>();

  // POWER mode (Ludo World parity)
  private powerMode = false;
  private readonly tokenSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly trapSprites = new Map<number, Phaser.GameObjects.Image>();
  /** The single POWER orb button + its charge-count badge. */
  private powerOrb?: Phaser.GameObjects.Container;
  private powerOrbBadge?: Phaser.GameObjects.Text;
  /** The little "your powers" window the orb opens. */
  private powerPopover?: Phaser.GameObjects.Container;
  private pickPopover?: Phaser.GameObjects.Container;
  /** Bomb targeting: tappable markers on eligible ring cells. */
  private cellPickers: Phaser.GameObjects.Container[] = [];
  /** POWER charges rail: quick-use medallions filling the bottom band. */
  private readonly railButtons = new Map<
    PowerType,
    { root: Phaser.GameObjects.Container; badge: Phaser.GameObjects.Text }
  >();
  private targetPower: PowerType | null = null;

  private tasks: (() => Promise<void>)[] = [];
  private pumping = false;
  private alive = true;

  private activeSeat: Seat | null = null;
  private deadline = 0;
  private timerTotalMs = 1;
  private matchOver = false;
  private emoteCooldown = false;
  private chatPopover: Phaser.GameObjects.Container | null = null;
  private static readonly CHAT_BASE = 100;
  /** Taunt ids ride the emote pipe as 200 + taunt*4 + targetSeat. */
  private static readonly TAUNT_BASE = 200;
  private static readonly CHAT_KEYS = [
    'chat.p0',
    'chat.p1',
    'chat.p2',
    'chat.p3',
    'chat.p4',
    'chat.p5',
  ] as const;
  private connDot?: Phaser.GameObjects.Arc;

  constructor() {
    super('Game');
  }

  init(data: MatchInit): void {
    this.matchInit = data;
  }

  create(): void {
    this.alive = true;
    this.matchOver = false;
    this.activeSeat = null;
    this.deadline = 0;
    this.tasks = [];
    this.pumping = false;
    this.emoteCooldown = false;
    this.chips.clear();
    this.pieceViews.clear();
    this.rivalDice.clear();
    this.tokenSprites.clear();
    this.trapSprites.clear();
    this.powerOrb = undefined;
    this.powerOrbBadge = undefined;
    this.powerPopover = undefined;
    this.railButtons.clear();
    this.pickPopover = undefined;
    this.cellPickers = [];
    this.targetPower = null;
    this.tweens.timeScale = 1; // defensive after any interrupted hit-stop

    // Trimmed ambient budget in-match: twinkle 6, no parallax/floating decor.
    new SceneBackdrop(this, 'game');
    // §4.2: contact shadow grounds the board on the stage platform.
    this.add
      .image(GAME_W / 2, BOARD_Y + BOARD_SIZE + dp(6), 'board_shadow')
      .setDepth(0.6)
      .setAlpha(0.9);
    // §4.5: same scene, two transports — WaitingScene hands over a live
    // ColyseusClient for online; offline modes build their local driver.
    this.driver =
      this.matchInit.driver ??
      new OfflineDriver({
        mode: this.matchInit.mode === 'local' ? 'local' : 'cpu',
        numPlayers: this.matchInit.numPlayers,
        aiLevel: this.matchInit.aiLevel,
        powerMode: this.matchInit.powerMode ?? false,
        seatZeroColor: this.matchInit.seatZeroColor,
        humanLoadout: this.matchInit.humanLoadout,
      });
    this.timerTotalMs = this.driver.turnTimerS * 1000;
    this.powerMode = this.matchInit.powerMode ?? this.driver.snapshot().config.powerMode;
    // Shop model (vs CPU): every human USE_POWER burns one owned unit via
    // the API (fire-and-forget; the online room consumes server-side).
    if (this.driver instanceof OfflineDriver) {
      this.driver.onConsumePower = (power) => {
        void api.consumePower(power).catch(() => undefined);
      };
    }
    this.buildSeats();

    // LW camera: rotate the WHOLE view so YOUR color reads bottom-left —
    // pass&play keeps the fixed view (the device rotates hands, not the board).
    const mySeat = this.seats.find((s) => s.human);
    this.viewTurns =
      this.matchInit.mode === 'local' || !mySeat ? 0 : BoardView.TURNS_FOR[mySeat.color];

    // Equipped board theme — bake lazily, then hand BoardView the key.
    const boardTheme = normalizeBoardTheme(metaState.boardTheme);
    bakeBoard(this, boardTheme);
    this.board = new BoardView(this, boardTextureKey(boardTheme), this.viewTurns);
    this.buildMedallionGlow();
    this.fx = new FxLayer(this);
    this.toast = new Toast(this, GAME_W / 2, ACTION.toastY);
    this.buildHudPill();
    this.buildChips();
    this.buildPieces();
    this.buildActionZone();
    if (this.powerMode) this.buildPowerBar();
    this.wireDriver();
    // Online (and resumed) matches may already have pieces on the board.
    if (this.matchInit.mode === 'online') this.resyncFromState();
    if (this.powerMode) this.syncPowerState();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      this.tasks = [];
      this.driver.destroy();
      this.tweens.timeScale = 1;
    });

    this.driver.start();
  }

  override update(): void {
    if (this.matchOver || this.activeSeat === null || this.deadline === 0) return;
    const chip = this.chips.get(this.activeSeat);
    if (!chip) return;
    const remaining = this.deadline - Date.now();
    const frac = Phaser.Math.Clamp(remaining / this.timerTotalMs, 0, 1);
    chip.updateTimer(frac);
    chip.setUrgent(remaining > 0 && remaining < LR_MOTION.timer.pulseBelowMs);
    if (remaining < 10000 && remaining > 0) {
      this.seconds.setText(`${Math.ceil(remaining / 1000)}s`).setVisible(true);
    } else {
      this.seconds.setVisible(false);
    }
  }

  // -- construction ----------------------------------------------------------

  private buildSeats(): void {
    const snap = this.driver.snapshot();
    const cpuCount = snap.players.filter((p) => !this.driver.isHumanSeat(p.seat)).length;
    let cpuIdx = 0;
    this.seats = snap.players.map((p) => {
      const human = this.driver.isHumanSeat(p.seat);
      let name: string;
      if (this.matchInit.mode === 'online') {
        // Real display names travel in the room schema (§6.4).
        const remote = this.driver.seatName?.(p.seat) ?? '';
        name = remote !== '' ? remote : t(`color.${p.color}` as I18nKey);
      } else if (this.matchInit.mode === 'cpu') {
        // Number the bots when there is more than one ("CPU 1", "CPU 2").
        name = human ? t('game.you') : cpuCount > 1 ? `${t('game.cpu')} ${++cpuIdx}` : t('game.cpu');
      } else {
        name = t(`color.${p.color}` as I18nKey);
      }
      return { seat: p.seat, color: p.color, name, human };
    });
  }

  /** §4.5: lazy gold pulse on the center medallion — the trophy waiting. */
  private buildMedallionGlow(): void {
    const center = this.board.centerXY;
    const m = LR_ART.medallion;
    const glow = this.add
      .image(center.x, center.y, 'fx_glow')
      .setDepth(DEPTH.board + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(LR_COLORS.gold500)
      .setScale(1.3);
    if (reducedMotion()) {
      glow.setAlpha(m.reducedGlowAlpha);
      return;
    }
    glow.setAlpha(0);
    this.tweens.add({
      targets: glow,
      alpha: m.glowAlphaMax,
      scale: { from: 1.3 * m.glowScaleMin, to: 1.3 * m.glowScaleMax },
      duration: m.glowMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    const spark = this.add
      .image(center.x, center.y, 'fx_spark')
      .setDepth(DEPTH.board + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(LR_COLORS.gold300)
      .setScale(0.8)
      .setAlpha(0.2);
    this.tweens.add({
      targets: spark,
      alpha: { from: 0.2, to: 0.8 },
      duration: m.sparkMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({ targets: spark, angle: 360, duration: m.sparkMs * 4, repeat: -1, ease: 'Linear' });
  }

  private buildHudPill(): void {
    // LW parity header: a floating SQUARE back button (arrow, not an X bar)
    // + a compact centered mode chip — no full-width toolbar.
    const chipW = 264;
    const chipX = 118 + chipW / 2 + 12;
    const pillKey = ensureInkPanel(this, chipW, 52, 26);
    this.add
      .image(chipX, HUD.y + HUD.h / 2, pillKey)
      .setScale(1 / LR_BAKE_SCALE)
      .setDepth(DEPTH.hud);

    const modeLabel =
      this.matchInit.mode === 'online'
        ? `${t('game.online')} · ${this.matchInit.roomCode ?? `${this.matchInit.numPlayers}P`}`
        : this.matchInit.mode === 'cpu'
          ? `${t('home.vs_cpu')} · ${t(`home.level_${this.matchInit.aiLevel}` as I18nKey)}`
          : `${t('home.pass_play')} · ${this.matchInit.numPlayers}P`;
    uiText(this, chipX, HUD.y + HUD.h / 2, modeLabel, 14, LR_COLORS.textOnDark, '700').setDepth(
      DEPTH.hud,
    );

    // Interesting bits (Jose): your coins live at the right — matches
    // matter — plus the win streak flame when it's rolling.
    const coins = metaState.profile?.wallet.coins ?? 0;
    const coinKey = ensureInkPanel(this, 132, 48, 24);
    const coinX = GAME_W - 88;
    this.add.image(coinX, HUD.y + HUD.h / 2, coinKey).setScale(1 / LR_BAKE_SCALE).setDepth(DEPTH.hud);
    if (this.textures.exists('coin_gold')) {
      this.add
        .image(coinX - 42, HUD.y + HUD.h / 2, 'coin_gold')
        .setDisplaySize(30, 30)
        .setDepth(DEPTH.hud);
    }
    uiText(this, coinX + 12, HUD.y + HUD.h / 2, formatCompact(coins), 15, LR_COLORS.textOnDark, '800')
      .setDepth(DEPTH.hud);
    const streak = metaState.profile?.user.winStreak ?? 0;
    if (streak > 0) {
      const stKey = ensureInkPanel(this, 84, 48, 24);
      this.add
        .image(coinX - 118, HUD.y + HUD.h / 2, stKey)
        .setScale(1 / LR_BAKE_SCALE)
        .setDepth(DEPTH.hud);
      uiText(this, coinX - 118, HUD.y + HUD.h / 2, `🔥 ${streak}`, 15, LR_COLORS.textOnDark, '800')
        .setDepth(DEPTH.hud);
    }

    // Online: a small live-connection dot on the chip (green/amber/red).
    if (this.matchInit.mode === 'online') {
      this.connDot = this.add
        .circle(chipX + chipW / 2 - 24, HUD.y + HUD.h / 2, 7, LR_COLORS.success, 1)
        .setStrokeStyle(2, LR_COLORS.panelInk)
        .setDepth(DEPTH.hud);
    }

    // Back / forfeit with confirm (44dp target).
    const exit = this.add.container(HUD.marginX + 38, HUD.y + HUD.h / 2).setDepth(DEPTH.hud);
    const backKey = ensureInkPanel(this, 64, 64, 18);
    exit.add(this.add.image(0, 0, backKey).setScale(1 / LR_BAKE_SCALE));
    exit.add(uiText(this, -1, -1, '❮', 26, LR_COLORS.textOnDark, '800'));
    // Top-left based rect: sized containers get displayOrigin added to the
    // local point before the hitArea test (see invariant note in ModeCard).
    exit.setSize(dp(44), dp(44));
    exit.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, dp(44), dp(44)),
      Phaser.Geom.Rectangle.Contains,
    );
    exit.on(Phaser.Input.Events.POINTER_DOWN, () => pressFeedback(this, exit));
    exit.on(Phaser.Input.Events.POINTER_UP, () => void this.confirmLeave());
  }

  private buildChips(): void {
    // Corner ring NW→NE→SE→SW; each view quarter-turn advances a yard one
    // slot clockwise, so chips stay glued to their (rotated) yards.
    const corners = [
      { x: CHIP.leftX, y: CHIP.topY }, // NW
      { x: CHIP.rightX, y: CHIP.topY }, // NE
      { x: CHIP.rightX, y: CHIP.bottomY }, // SE
      { x: CHIP.leftX, y: CHIP.bottomY }, // SW
    ];
    const baseIdx: Record<string, number> = { red: 0, blue: 1, yellow: 2, green: 3 };
    for (const info of this.seats) {
      // LW parity: EVERY chip floats on its color's board corner — the GO
      // bubble (die) travels to the active one, so "whose turn" reads there.
      const pos = corners[((baseIdx[info.color] ?? 0) + this.viewTurns) % 4] ?? corners[0]!;
      const radius = CHIP.radius;
      const initials =
        this.matchInit.mode === 'cpu'
          ? info.human
            ? t('game.you').toUpperCase()
            : t('game.cpu')
          : info.name.charAt(0).toUpperCase();
      // Your PET is your face at the table (ties into the account/pet
      // levelling); bots wear the robot. Other online humans keep initials.
      const artKey =
        this.matchInit.mode !== 'local' && info.human
          ? 'art_mascot'
          : this.matchInit.mode === 'cpu'
            ? 'art_avatar_robot'
            : undefined;
      this.chips.set(
        info.seat,
        new AvatarChip(this, pos.x, pos.y, radius, info.color, initials, info.name, artKey),
      );
    }
    // Equipped chat-bubble skin on the seats this device controls.
    const bubble = normalizeBubbleSkin(metaState.bubbleSkin);
    if (bubble !== 'classic') {
      for (const info of this.seats) {
        if (this.matchInit.mode === 'local' || info.human) {
          this.chips.get(info.seat)?.setBubbleSkin(bubble);
        }
      }
    }
  }

  private buildPieces(): void {
    const snap = this.driver.snapshot();
    // Equipped pawn skin: worn by the seats this device controls (every
    // seat in pass&play — same account); rivals stay classic until §6.5
    // carries per-player skins in the room snapshot.
    const tokenSkin = normalizeTokenSkin(metaState.tokenSkin);
    const skinnedSeats = new Set<number>();
    if (tokenSkin !== 'classic') {
      ensureTokenSkin(this, tokenSkin);
      for (const p of snap.players) {
        if (this.matchInit.mode === 'local' || this.driver.isHumanSeat(p.seat)) {
          skinnedSeats.add(p.seat);
        }
      }
    }
    for (const piece of snap.pieces) {
      const player = snap.players.find((p) => p.seat === piece.seat);
      if (!player) continue;
      const pos = this.board.baseSlotXY(player.color, piece.pieceId);
      const view = new PieceView(
        this,
        pos,
        piece.seat,
        piece.pieceId,
        player.color,
        (pv) => this.onPieceTap(pv),
        skinnedSeats.has(piece.seat) ? pieceSkinKey(player.color, tokenSkin) : undefined,
      );
      this.pieceViews.set(this.pieceKey(piece.seat, piece.pieceId), view);
    }
  }

  private buildActionZone(): void {
    this.banner = uiText(this, GAME_W / 2, ACTION.bannerY, '', 20, LR_COLORS.textOnDark, '800').setDepth(
      DEPTH.hud,
    );
    this.hint = uiText(this, GAME_W / 2, ACTION.bannerY + 30, '', 14, LR_COLORS.textFaint, '600').setDepth(
      DEPTH.hud,
    );
    // §6: HUD numbers live over a busy scene — thin ink stroke, no shadow.
    this.seconds = uiText(this, GAME_W / 2 + 150, ACTION.bannerY, '', 18, LR_COLORS.warning, '800')
      .setStroke(cssColor(LR_COLORS.panelInk), 2)
      .setDepth(DEPTH.hud)
      .setVisible(false);

    // The player's OWN die wears the equipped shop skin ('classic' when the
    // asset key is unknown/stale); rivals keep classic until §6.5 carries
    // per-player skins in the room snapshot.
    const equipped = metaState.diceSkin;
    const skin: DiceSkinId = (DICE_SKINS as readonly string[]).includes(equipped)
      ? (equipped as DiceSkinId)
      : 'classic';
    ensureDiceSkin(this, skin);
    // LW GO bubble: the die floats in a speech bubble BESIDE the active
    // player's chip (placeDice moves it every turn) — no fixed tray zone.
    bakeGoBubble(this);
    // The white "GO" speech bubble is retired: on your turn the die itself is
    // the affordance (glow ring + bouncing finger point at it). The image is
    // kept but permanently hidden — it stays as the position anchor for the
    // die / glow / finger / roll zone (all placed by goBubble.x/y).
    this.goBubble = this.add
      .image(GAME_W / 2, ACTION.bannerY + dp(60), 'go_bubble')
      .setScale(1 / LR_BAKE_SCALE)
      .setDepth(DEPTH.dice - 0.1)
      .setVisible(false);
    this.dice = new DiceView(this, this.goBubble.x, this.goBubble.y, () => this.requestRollTap(), skin);
    this.dice.setScale(0.7);
    // Big LW "GO" inside the bubble while it is YOUR tap-to-roll; the die
    // takes over the moment any seat actually rolls.
    this.goText = this.add
      .text(this.goBubble.x, this.goBubble.y, 'GO', {
        fontFamily: LR_FONTS.display,
        fontSize: '26px',
        fontStyle: '900',
        color: cssColor(LR_COLORS.hudInk),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.dice)
      .setVisible(false);
    // Tap-to-roll hit zone covering the WHOLE bubble: a tap ANYWHERE on the
    // bubble rolls. A dedicated Zone avoids the origin-shifted hit rect on the
    // small "GO" glyph that left only a sliver of the bubble clickable.
    this.rollZone = this.add
      .zone(this.goBubble.x, this.goBubble.y, dp(170), dp(150))
      .setOrigin(0.5)
      .setDepth(DEPTH.dice + 0.5);
    this.rollZone.setInteractive({ useHandCursor: true });
    this.rollZone.on(Phaser.Input.Events.POINTER_UP, () => this.requestRollTap());
    this.tapLabel = uiText(this, -200, -200, '', 12, LR_COLORS.textOnDark, '800')
      .setDepth(DEPTH.hud)
      .setVisible(false);
    this.placeDice(this.driver.snapshot().currentSeat, true);

    // §UX YOUR-turn cue: unmistakable it's your move without reading a banner —
    // a soft pulsing ring behind the die and a bouncing finger above it. Shown
    // ONLY on your roll turn; a rival's turn keeps just the subtle chip glow.
    this.turnGlow = this.add
      .circle(this.goBubble.x, this.goBubble.y, dp(60), LR_COLORS.brand300, 0.14)
      .setStrokeStyle(dp(5), LR_COLORS.brand300, 0.9)
      .setDepth(DEPTH.dice - 0.15)
      .setVisible(false);
    this.tweens.add({
      targets: this.turnGlow,
      scale: 1.16,
      duration: 720,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.turnPointer = this.add
      .container(this.goBubble.x, this.goBubble.y - dp(66))
      .setDepth(DEPTH.hud)
      .setVisible(false);
    const turnFinger = this.add.text(0, 0, '\u{1F447}', { fontSize: '40px' }).setOrigin(0.5);
    this.turnPointer.add(turnFinger);
    this.tweens.add({
      targets: turnFinger,
      y: -dp(10),
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // LW pills: Emoji + Chat side by side on the bottom row, ink capsules.
    const pill = (
      x: number,
      y: number,
      label: string,
      onTap: () => void,
    ): Phaser.GameObjects.Container => {
      const rootC = this.add.container(x, y).setDepth(DEPTH.hud);
      const key = ensureInkPanel(this, 212, 70, 35);
      rootC.add(this.add.image(0, 0, key).setScale(1 / LR_BAKE_SCALE));
      rootC.add(uiText(this, 0, 0, label, 23, LR_COLORS.textOnDark, '800'));
      rootC.setSize(220, 76);
      rootC.setInteractive(new Phaser.Geom.Rectangle(0, 0, 220, 76), Phaser.Geom.Rectangle.Contains);
      rootC.on(Phaser.Input.Events.POINTER_DOWN, () => pressFeedback(this, rootC));
      rootC.on(Phaser.Input.Events.POINTER_UP, onTap);
      return rootC;
    };
    this.emoteWheel = new EmoteWheelView(
      this,
      330,
      ACTION.emojiY,
      (id) => this.onEmotePick(id),
      (tauntId) => this.onTauntPick(tauntId),
    );
    // The Emoji pill doubles as the cooldown indicator (onChatPick /
    // onEmotePick dim it) — the missing assignment crashed setAlpha and
    // bricked chat + emotes after the first message.
    this.emoteButton = pill(ACTION.pillX, ACTION.emojiY, `😄 ${t('game.pill_emoji')}`, () => {
      this.closeChatPopover();
      if (!this.emoteCooldown) this.emoteWheel.toggle();
    });
    pill(ACTION.chatX, ACTION.chatY, `💬 ${t('game.pill_chat')}`, () => this.toggleChatPopover());
  }

  /** Move the GO bubble (die + tap hint) beside a seat's corner chip. */
  private placeDice(seat: Seat | null, instant = false): void {
    const chip = seat !== null ? this.chips.get(seat) : undefined;
    if (!chip || !this.goBubble) return;
    // Rapid turn-passing (several CPUs with no moves) fires placeDice
    // back-to-back; without killing the in-flight travel tweens the bubble
    // and the die inherit DIFFERENT destinations and split apart mid-air.
    this.tweens.killTweensOf([this.goBubble, this.dice, this.goText]);
    const side = chip.x < GAME_W / 2 ? 1 : -1;
    const vside = chip.y < GAME_H / 2 ? 1 : -1; // lean away from the edge
    // RAW logical offsets (dp() shrinks by 0.667 and had the bubble touching
    // the chip ring): bubble half-width is 49, ring edge is 48 from the chip
    // center — 125 leaves ~26px of real air to the tail tip.
    const x = chip.x + side * 125;
    // Bottom chip (the human) drops into the open area below the board so the
    // die clears the avatar (Jose: "bajale un poco mas"); top chips nudge down.
    const y = chip.y + (vside > 0 ? 8 : 26);
    this.goBubble.setFlipX(side < 0);
    // The baked texture includes the tail, so the bubble BODY sits dp(8)
    // off-center — nudge the die toward the body side.
    const dieX = x + side * 4;
    if (instant || reducedMotion()) {
      this.goBubble.setPosition(x, y);
      this.dice.setPosition(dieX, y);
      this.goText.setPosition(dieX, y);
      this.turnGlow?.setPosition(dieX, y);
      this.turnPointer?.setPosition(dieX, y - dp(66));
      this.rollZone?.setPosition(dieX, y);
      return;
    }
    this.tweens.add({ targets: this.goBubble, x, y, duration: 230, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: [this.dice, this.goText], x: dieX, y, duration: 230, ease: 'Quad.easeOut' });
    this.turnGlow?.setPosition(dieX, y);
    this.turnPointer?.setPosition(dieX, y - dp(66));
    this.rollZone?.setPosition(dieX, y);
  }

  /** Quick-chat popover: six LW-style phrases, 2 columns, above the button. */
  private toggleChatPopover(): void {
    if (this.chatPopover) {
      this.closeChatPopover();
      return;
    }
    const root = this.add.container(dp(24) + 222, ACTION.chatY - dp(200)).setDepth(DEPTH.modal);
    const bg = this.add.graphics();
    bg.fillStyle(LR_COLORS.hudInk, 0.96);
    bg.fillRoundedRect(-222, -126, 444, 252, dp(20));
    bg.lineStyle(2, LR_COLORS.brand300, 0.5);
    bg.strokeRoundedRect(-222, -126, 444, 252, dp(20));
    root.add(bg);
    GameBoardScene.CHAT_KEYS.forEach((key, i) => {
      const px = i % 2 === 0 ? -108 : 108;
      const py = Math.floor(i / 2) * 78 - 78;
      const pill = this.add.container(px, py);
      const pg = this.add.graphics();
      pg.fillStyle(0xffffff, 0.94);
      pg.fillRoundedRect(-100, -30, 200, 60, 28);
      pill.add(pg);
      pill.add(
        this.add
          .text(0, 0, t(key as I18nKey), {
            fontFamily: 'Nunito, system-ui, sans-serif',
            fontSize: '20px',
            fontStyle: '800',
            color: '#3b3468',
          })
          .setOrigin(0.5),
      );
      pill.setSize(200, 60);
      pill.setInteractive(new Phaser.Geom.Rectangle(0, 0, 200, 60), Phaser.Geom.Rectangle.Contains);
      pill.on(Phaser.Input.Events.POINTER_UP, () => this.onChatPick(i));
      root.add(pill);
    });
    if (!reducedMotion()) {
      root.setScale(0.9).setAlpha(0);
      this.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 140, ease: 'Back.easeOut' });
    }
    this.chatPopover = root;
  }

  private closeChatPopover(): void {
    this.chatPopover?.destroy();
    this.chatPopover = null;
  }

  private onChatPick(i: number): void {
    this.closeChatPopover();
    if (this.emoteCooldown) return;
    const key = GameBoardScene.CHAT_KEYS[i];
    if (!key) return;
    // Same expressive-seat + anti-spam rules as the emoji wheel.
    const seat =
      this.matchInit.mode === 'local'
        ? this.activeSeat ?? this.seats.find((s) => s.human)?.seat
        : this.seats.find((s) => s.human)?.seat;
    if (seat === undefined) return;
    void this.chips.get(seat)?.showPhrase(t(key as I18nKey));
    this.driver.sendEmote(GameBoardScene.CHAT_BASE + i);
    this.emoteCooldown = true;
    this.emoteButton.setAlpha(0.45);
    this.time.delayedCall(LR_MOTION.emote.cooldownMs, () => {
      this.emoteCooldown = false;
      this.emoteButton.setAlpha(1);
    });
  }

  // -- driver wiring ---------------------------------------------------------

  private wireDriver(): void {
    this.driver.onDice = (msg) => this.enqueue(() => this.taskDice(msg));
    this.driver.onMove = (msg) => this.enqueue(() => this.taskMove(msg));
    this.driver.onCapture = (notice) => this.enqueue(() => this.taskCapture(notice));
    this.driver.onTurn = (msg) => this.enqueue(() => this.taskTurn(msg));
    this.driver.onTurnSkipped = (msg) => this.enqueue(() => this.taskSkipped(msg));
    this.driver.onMatchEnd = (msg) => this.enqueue(() => this.taskMatchEnd(msg));
    this.driver.onError = (msg) => this.enqueue(() => this.toast.show(errText(msg.code), 900));
    // Online-only signals (OfflineDriver never fires these).
    this.driver.onPlayerStatus = (msg) => this.enqueue(() => this.taskPlayerStatus(msg));
    this.driver.onEmoteShown = (msg) => this.showRemoteEmote(msg);
    this.driver.onResync = () => {
      this.resyncFromState();
      if (this.powerMode) this.syncPowerState();
    };
    this.driver.onConnectionStatus = (status) => this.updateConnection(status);
    // POWER events
    this.driver.onTokenSpawned = (msg) => this.enqueue(() => this.taskTokenSpawned(msg));
    this.driver.onTokenCollected = (msg) => this.enqueue(() => this.taskTokenCollected(msg));
    this.driver.onPowerUsed = (msg) => this.enqueue(() => this.taskPowerUsed(msg));
    this.driver.onTrapTriggered = (msg) => this.enqueue(() => this.taskTrapTriggered(msg));
  }

  private enqueue(task: () => Promise<void>): void {
    this.tasks.push(task);
    if (!this.pumping) void this.pump();
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    while (this.tasks.length > 0 && this.alive) {
      const task = this.tasks.shift();
      if (task) await task();
    }
    this.pumping = false;
  }

  // -- animation tasks -------------------------------------------------------

  private async taskDice(msg: DiceMessage): Promise<void> {
    this.canRoll = false;
    this.goText.setVisible(false);
    this.turnGlow.setVisible(false);
    this.turnPointer.setVisible(false);
    this.dice.setRollable(false);
    this.tapLabel.setVisible(false);
    this.closePickPopover();
    // A double roll's value can exceed 6 — the die face shows the FIRST part
    // and the banner spells out the sum.
    const face = msg.parts ? msg.parts[0] : msg.value;
    // Ludo World parity: every player VISIBLY throws. Rival/CPU rolls tumble
    // a mini die next to the roller's own avatar chip; the big action-zone
    // die only animates for hands held on THIS device (you, or pass & play).
    const rivalChip =
      this.matchInit.mode !== 'local' && !this.driver.isHumanSeat(msg.seat)
        ? this.chips.get(msg.seat)
        : undefined;
    if (rivalChip) {
      // Rival roll: hide YOUR action-zone die + bubble entirely; only the mini
      // die beside their chip tumbles (never two dice on screen at once).
      this.dice.setVisible(false);
      this.goBubble.setVisible(false);
      await this.rollAtRival(msg.seat, rivalChip, face, msg.parts);
    } else {
      this.dice.setVisible(true);
      this.goBubble.setVisible(false);
      await this.dice.roll(face, this.fx);
      if (msg.parts) this.showSecondDie(this.dice.x + dp(78), this.dice.y, msg.parts[1]);
    }
    if (msg.parts) {
      this.banner.setText(t('game.double_roll', { a: msg.parts[0], b: msg.parts[1], v: msg.value }));
    } else if (msg.picked) {
      this.banner.setText(t('game.picked_roll', { v: msg.value }));
    }
    if (this.powerMode) this.refreshPowerBar();
    if (this.driver.isHumanSeat(msg.seat) && msg.legalPieceIds.length > 0) {
      // Auto-suggest: a single legal move gets the strong highlight (§4).
      const strong = msg.legalPieceIds.length === 1;
      for (const pid of msg.legalPieceIds) {
        this.pieceOf(msg.seat, pid)?.setSelectable(true, strong);
      }
      this.banner.setText(t('game.choose_piece'));
    }
  }

  /**
   * Tumble a transient mini die beside the roller's chip (offset toward the
   * board so it never covers the avatar). The landing face lingers readable
   * while the queue moves on to the hop; then it fades out and dies.
   */
  private async rollAtRival(
    seat: Seat,
    chip: AvatarChip,
    value: number,
    parts?: [number, number],
  ): Promise<void> {
    this.rivalDice.get(seat)?.destroy();
    // Push the die further from the avatar so it doesn't crowd the photo.
    const dx = chip.x < GAME_W / 2 ? dp(118) : -dp(118);
    const mini = new DiceView(this, chip.x + dx, chip.y, () => undefined);
    mini.disableInteractive();
    mini.setScale(0.62);
    this.rivalDice.set(seat, mini);
    await mini.roll(value, this.fx);
    if (parts) this.showSecondDie(mini.x + dx * 0.7, mini.y, parts[1]);
    this.time.delayedCall(RIVAL_DICE_LINGER_MS, () => {
      if (this.rivalDice.get(seat) !== mini) return; // superseded by a re-roll
      this.rivalDice.delete(seat);
      if (reducedMotion()) {
        mini.destroy();
        return;
      }
      this.tweens.add({
        targets: mini,
        alpha: 0,
        duration: 180,
        ease: 'Quad.easeIn',
        onComplete: () => mini.destroy(),
      });
    });
  }

  private async taskMove(msg: MoveResultMessage): Promise<void> {
    this.clearHighlights();
    const view = this.pieceOf(msg.seat, msg.pieceId);
    if (!view) return;
    const points = msg.path.map((s) => this.board.stepsToXY(view.color, s, msg.pieceId));
    if (msg.teleport) {
      sfx('hop'); // the slide keeps the single blip; hop chains play per-cell steps
      // Portal/bolt: a direct slide with sparks at both ends, not a hop chain.
      const target = points[points.length - 1];
      if (target) {
        this.fx.emitBurst(view.x, view.y, 0x9b5cf6, 10);
        await this.slidePiece(view, target, msg.path[msg.path.length - 1] ?? view.steps);
        this.fx.emitBurst(target.x, target.y, 0x9b5cf6, 10);
      }
    } else {
      await view.moveAlong(points, this.fx);
    }
    view.steps = msg.path[msg.path.length - 1] ?? view.steps;
    if (msg.reachedHome) {
      view.setShielded(false);
      await view.parkHome(this.board.stepsToXY(view.color, HOME_STEPS, msg.pieceId), this.fx);
    }
    this.layoutStacks();
  }

  /** Teleport slide (portal/bolt): one smooth glide onto the target cell. */
  private slidePiece(
    view: PieceView,
    target: { x: number; y: number },
    steps: number,
  ): Promise<void> {
    if (reducedMotion()) {
      view.snapTo(target, steps);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.add({
        targets: view,
        x: target.x,
        y: target.y,
        duration: 380,
        ease: 'Quad.easeInOut',
        onComplete: () => {
          view.snapTo(target, steps);
          resolve();
        },
      });
    });
  }

  private async taskCapture(notice: CaptureNotice): Promise<void> {
    const attacker = this.pieceOf(notice.bySeat, notice.byPieceId);
    const victim = this.pieceOf(notice.victimSeat, notice.victimPieceId);
    if (!attacker || !victim) return;
    const cell = notice.cell >= 0 ? this.board.absCellXY(notice.cell) : victim.anchorXY;
    const base = this.board.baseSlotXY(victim.color, victim.pieceId);
    await playCaptureCombo(this, {
      attacker,
      victim,
      cellX: cell.x,
      cellY: cell.y,
      baseX: base.x,
      baseY: base.y,
      fx: this.fx,
    });
    this.layoutStacks();
  }

  private async taskTurn(msg: TurnMessage): Promise<void> {
    if (this.matchOver) return;
    const prev = this.activeSeat;
    this.activeSeat = msg.seat;
    this.deadline = msg.deadline;

    for (const [seat, chip] of this.chips) {
      chip.setActive2(seat === msg.seat);
    }
    this.placeDice(msg.seat);

    if (this.powerMode) {
      // Engine rule mirror: domes pop when their owner's turn starts.
      if (msg.phase === 'roll' && prev !== msg.seat) {
        for (const view of this.pieceViews.values()) {
          if (view.seat === msg.seat) view.setShielded(false);
        }
      }
      this.exitTargetMode();
      this.closePickPopover();
      this.closePowerPopover();
      // Thaw mirror: frozen marks expire as turns pass (engine truth).
      const powerSnap = this.driver.snapshot();
      for (const view of this.pieceViews.values()) {
        view.setFrozen(isFrozen(powerSnap, view.seat, view.pieceId));
      }
      this.refreshPowerBar();
    }

    const info = this.seats.find((s) => s.seat === msg.seat);
    const human = info?.human ?? false;
    const rollable = human && msg.phase === 'roll';
    this.canRoll = rollable;
    this.dice.setRollable(rollable);
    // LW: big GO while waiting for YOUR tap; the die shows otherwise. The
    // action-zone bubble + die belong to YOU only — a rival's turn hides them
    // (their roll shows a mini die beside their chip) so two dice never appear.
    this.goText.setVisible(false);
    this.dice.setVisible(human);
    this.goBubble.setVisible(false);
    this.turnGlow.setVisible(rollable);
    this.turnPointer.setVisible(rollable);

    if (!info) return;
    if (this.matchInit.mode === 'cpu') {
      this.banner.setText(human ? '' : t('game.cpu_thinking'));
      this.hint.setText('');
    } else if (this.matchInit.mode === 'online') {
      this.banner.setText(human ? '' : t('game.turn_of', { name: info.name }));
      this.hint.setText('');
    } else {
      this.banner.setText(t('game.turn_of', { name: info.name }));
      // Pass-device hint only when the seat actually changes hands.
      this.hint.setText(
        msg.phase === 'roll' && prev !== msg.seat ? t('game.pass_device', { name: info.name }) : '',
      );
    }
    if (human && msg.phase === 'move') this.banner.setText(t('game.choose_piece'));
    await Promise.resolve();
  }

  /** §6.6 presence: chip badge + a short toast so the table knows why. */
  private async taskPlayerStatus(msg: PlayerStatusMessage): Promise<void> {
    if (this.matchOver) return;
    this.chips.get(msg.seat)?.setStatus(msg.connected, msg.auto);
    const info = this.seats.find((s) => s.seat === msg.seat);
    if (!info || info.human) return;
    if (!msg.connected && msg.auto) {
      await this.toast.show(t('online.waiting_for', { name: info.name }), 1100);
    } else if (msg.connected && !msg.auto) {
      await this.toast.show(t('online.back_online', { name: info.name }), 900);
    }
  }

  /** §6.5 emoteShown → rival bubble (own emote already played on tap). */
  private showRemoteEmote(msg: EmoteShownMessage): void {
    if (msg.emoteId >= GameBoardScene.TAUNT_BASE) {
      const off = msg.emoteId - GameBoardScene.TAUNT_BASE;
      this.throwTaunt(msg.seat, (off % 4) as Seat, Math.floor(off / 4));
      return;
    }
    if (msg.emoteId >= GameBoardScene.CHAT_BASE) {
      const key = GameBoardScene.CHAT_KEYS[msg.emoteId - GameBoardScene.CHAT_BASE];
      if (key) void this.chips.get(msg.seat)?.showPhrase(t(key as I18nKey));
      return;
    }
    const emoji = EMOTES[msg.emoteId];
    if (!emoji) return;
    void this.chips.get(msg.seat)?.showEmote(emoji, emoteArtKey(msg.emoteId));
  }

  private updateConnection(status: ConnectionStatus): void {
    if (status === 'connected') {
      this.connDot?.setFillStyle(LR_COLORS.success, 1);
      void this.toast.show(t('online.reconnected'), 800);
      return;
    }
    if (status === 'reconnecting') {
      this.connDot?.setFillStyle(LR_COLORS.warning, 1);
      void this.toast.show(t('online.reconnecting'), 1200);
      return;
    }
    // Lost for good: back to Home (the seat forfeits server-side, §6.7).
    this.connDot?.setFillStyle(LR_COLORS.danger, 1);
    if (this.matchOver) return;
    void this.toast.show(t('online.connection_lost'), 1400);
    this.time.delayedCall(1500, () => {
      if (this.scene.isActive('Game')) this.scene.start('Home');
    });
  }

  private async taskSkipped(msg: TurnSkippedMessage): Promise<void> {
    // A fresh player with nothing on the board reads "no moves" as a bug —
    // when every piece is still in base (or already home), spell out the
    // actual Ludo rule instead.
    const needSix = this.driver
      .snapshot()
      .pieces.filter((p) => p.seat === msg.seat)
      .every((p) => p.steps < 0 || p.steps >= HOME_STEPS);
    const key: I18nKey =
      msg.reason === 'triple_six'
        ? 'game.triple_six'
        : msg.reason === 'timeout'
          ? 'game.times_up'
          : needSix
            ? 'game.need_six'
            : 'game.no_moves';
    // SKIP_DISPLAY_MS: the wasted roll stays visible before the turn passes.
    await this.toast.show(t(key), SKIP_DISPLAY_MS);
  }

  private async taskMatchEnd(msg: MatchEndMessage): Promise<void> {
    this.matchOver = true;
    this.deadline = 0;
    this.dice.setRollable(false);
    this.tapLabel.setVisible(false);
    this.targetPower = null;
    this.closePickPopover();
    this.clearHighlights();
    for (const chip of this.chips.values()) chip.setActive2(false);
    this.banner.setText('');
    this.hint.setText('');
    this.seconds.setVisible(false);

    const first = msg.ranking.find((r) => r.place === 1);
    const humanWon = first ? this.driver.isHumanSeat(first.seat) : false;
    const winner = this.seats.find((s) => s.seat === first?.seat);
    const center = this.board.centerXY;
    await delayP(this, 150);
    await playVictoryFx(this, {
      focusX: center.x,
      focusY: center.y,
      winnerName: winner?.name ?? '',
      big: humanWon,
      fx: this.fx,
    });

    const rows = [...msg.ranking]
      .sort((a, b) => a.place - b.place)
      .map((r) => {
        const info = this.seats.find((s) => s.seat === r.seat);
        return {
          seat: r.seat,
          place: r.place,
          color: info?.color ?? 'red',
          name: info?.name ?? '',
          coinsDelta: r.coinsDelta,
        };
      });
    const humanSeat =
      this.matchInit.mode === 'local' ? null : (this.seats.find((s) => s.human)?.seat ?? null);

    // Offline (vs CPU) progression: local play has no server match record, so
    // report the outcome to credit coins + XP - this is what levels you up.
    // The home return surfaces the coin delta; online is credited server-side.
    if (this.matchInit.mode === 'cpu' && humanSeat != null) {
      const place = msg.ranking.find((r) => r.seat === humanSeat)?.place ?? msg.ranking.length;
      void api
        .reportLocalMatch({
          mode: 'cpu',
          numPlayers: this.matchInit.numPlayers,
          powerMode: this.powerMode,
          place,
          aiLevel: this.matchInit.aiLevel,
        })
        .catch(() => undefined);
    }

    const data: ResultsData = { init: this.matchInit, rows, humanWon, humanSeat };
    this.scene.start('Results', data);
  }

  // -- input -----------------------------------------------------------------

  /** Roll tap: an armed-but-unaimed power cancels first (shield-freeze bug:
   *  rolling with target mode on left stale state that ate the move taps). */
  private requestRollTap(): void {
    if (!this.canRoll) return;
    if (this.targetPower !== null) this.exitTargetMode();
    this.closePowerPopover();
    this.closePickPopover();
    this.driver.requestRoll();
  }

  private onPieceTap(piece: PieceView): void {
    // POWER target selection: the tapped piece receives the armed power —
    // bolt/freeze aim at the tapped ENEMY piece, the rest name an own piece.
    if (this.targetPower !== null) {
      const power = this.targetPower;
      const mySeat = this.barSeat();
      const phase = this.driver.snapshot().turnPhase;
      this.exitTargetMode();
      // Stale target mode (the roll resolved underneath): fall through to a
      // normal move tap instead of firing an illegal USE_POWER.
      if (phase === 'wait_roll') {
        if (mySeat !== undefined && piece.seat !== mySeat) {
          this.driver.usePower(power, { targetSeat: piece.seat, pieceId: piece.pieceId });
        } else {
          this.driver.usePower(power, { pieceId: piece.pieceId });
        }
        return;
      }
    }
    this.clearHighlights();
    this.driver.requestMove(piece.pieceId);
  }

  private onEmotePick(id: number): void {
    const emoji = EMOTES[id];
    if (!emoji || this.emoteCooldown) return;
    // Local expressive seat: your own chip online and vs CPU; whoever holds
    // the device in pass & play.
    const seat =
      this.matchInit.mode === 'local'
        ? this.activeSeat ?? this.seats.find((s) => s.human)?.seat
        : this.seats.find((s) => s.human)?.seat;
    if (seat === undefined) return;
    void this.chips.get(seat)?.showEmote(emoji, emoteArtKey(id));
    this.driver.sendEmote(id);
    // Anti-spam cooldown (§5.5): 1 emote / 2s, button dims meanwhile.
    this.emoteCooldown = true;
    this.emoteButton.setAlpha(0.45);
    this.time.delayedCall(LR_MOTION.emote.cooldownMs, () => {
      this.emoteCooldown = false;
      this.emoteButton.setAlpha(1);
    });
  }

  /** LW parity: throw a taunt at a rival — it arcs to their chip, splats
   * with a burst and shakes them. Target = the rival on turn (or the first
   * alive rival) so 2P games always hit the obvious opponent. */
  private onTauntPick(tauntId: number): void {
    if (this.emoteCooldown) return;
    const from =
      this.matchInit.mode === 'local'
        ? this.activeSeat ?? this.seats.find((s) => s.human)?.seat
        : this.seats.find((s) => s.human)?.seat;
    if (from === undefined) return;
    const snap = this.driver.snapshot();
    const rivals = snap.players.filter((p) => p.seat !== from && !p.forfeited);
    const target = rivals.find((p) => p.seat === snap.currentSeat) ?? rivals[0];
    if (!target) return;
    this.throwTaunt(from, target.seat, tauntId);
    this.driver.sendEmote(GameBoardScene.TAUNT_BASE + tauntId * 4 + target.seat);
    this.emoteCooldown = true;
    this.emoteButton.setAlpha(0.45);
    this.time.delayedCall(LR_MOTION.emote.cooldownMs, () => {
      this.emoteCooldown = false;
      this.emoteButton.setAlpha(1);
    });
  }

  private throwTaunt(fromSeat: Seat, targetSeat: Seat, tauntId: number): void {
    const glyph = TAUNTS[tauntId];
    const from = this.chips.get(fromSeat);
    const to = this.chips.get(targetSeat);
    if (glyph === undefined || !from || !to || from === to) return;
    const proj = this.add
      .text(from.x, from.y - dp(20), glyph, { fontSize: '34px' })
      .setOrigin(0.5)
      .setDepth(DEPTH.fx);
    const dur = 620;
    this.tweens.add({ targets: proj, x: to.x, duration: dur, ease: 'Linear' });
    this.tweens.add({ targets: proj, angle: 540, duration: dur, ease: 'Linear' });
    const peak = Math.min(from.y, to.y) - dp(150);
    this.tweens.add({
      targets: proj,
      y: peak,
      duration: dur * 0.5,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: proj,
          y: to.y - dp(6),
          duration: dur * 0.5,
          ease: 'Quad.easeIn',
          onComplete: () => {
            sfx('capture');
            haptic('capture');
            this.fx.emitBurst(to.x, to.y - dp(6), LR_COLORS.brand300, 12);
            this.tweens.add({
              targets: proj,
              scale: 1.8,
              alpha: 0,
              duration: 260,
              ease: 'Quad.easeOut',
              onComplete: () => proj.destroy(),
            });
            const ox = to.x;
            this.tweens.add({
              targets: to,
              x: ox + 6,
              duration: 50,
              yoyo: true,
              repeat: 3,
              onComplete: () => to.setX(ox),
            });
          },
        });
      },
    });
  }

  private async confirmLeave(): Promise<void> {
    const leave = await confirmModal(
      this,
      t('game.leave_title'),
      t('game.leave_body'),
      t('game.leave_confirm'),
      t('game.leave_cancel'),
    );
    if (!leave || this.matchOver) return;
    this.driver.forfeit();
    // Leaving means LEAVING, in every mode. Online the room keeps playing
    // without us (§6.7 — shutdown destroys the driver, which leaves the room
    // for real); offline there is nothing to spectate, so the old
    // forfeit-and-resync behavior read as "Salir does nothing".
    this.scene.start('Home');
  }

  /** Forfeit retires pieces without events — snap views to engine truth. */
  private resyncFromState(): void {
    const snap = this.driver.snapshot();
    for (const piece of snap.pieces) {
      const view = this.pieceOf(piece.seat, piece.pieceId);
      const player = snap.players.find((p) => p.seat === piece.seat);
      if (!view || !player) continue;
      if (view.steps !== piece.steps) {
        view.snapTo(this.board.stepsToXY(player.color, piece.steps, piece.pieceId), piece.steps);
      }
    }
    for (const player of snap.players) {
      if (player.forfeited) this.chips.get(player.seat)?.setDimmed(true);
    }
    // §6.6: the schema already carries each player's connected/auto flags —
    // paint the presence badges NOW (silently, no toasts) instead of waiting
    // for that player's next playerStatus broadcast after a resume/resync.
    for (const status of this.driver.seatStatuses?.() ?? []) {
      this.chips.get(status.seat)?.setStatus(status.connected, status.auto);
    }
    this.layoutStacks();
  }

  // -- POWER mode (Ludo World parity) ----------------------------------------

  private static readonly POWER_ORDER: readonly PowerType[] = [
    'plus',
    'double',
    'pick',
    'shield',
    'bomb',
    'bolt',
    'freeze',
    'portal',
  ];

  /**
   * The single POWER button (Jose: "un solo ícono que impacte"): a glossy
   * pulsing energy orb in the action zone. Tapping it opens the popover
   * with every power and its remaining per-match charges.
   */
  private buildPowerBar(): void {
    const root = this.add
      .container(ACTION.powerX, ACTION.powerY)
      .setDepth(DEPTH.hud);
    const glow = this.add
      .circle(0, 0, dp(46), LR_COLORS.brand300, 0.2)
      .setStrokeStyle(dp(3), LR_COLORS.brand300, 0.7);
    const orb = this.add.image(0, 0, 'power_orb').setDisplaySize(dp(78), dp(78));
    const badge = uiText(this, dp(28), dp(24), '', 17, LR_COLORS.textOnDark, '800')
      .setStroke(cssColor(LR_COLORS.panelInk), 4);
    root.add([glow, orb, badge]);
    // Top-left based rect for a sized container (see ModeCard invariant).
    root.setSize(dp(96), dp(96));
    root.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, dp(96), dp(96)),
      Phaser.Geom.Rectangle.Contains,
    );
    root.on(Phaser.Input.Events.POINTER_UP, () => this.togglePowerPopover());
    if (!reducedMotion()) {
      // The "impact" invite: breathing halo + a subtle orb wobble.
      this.tweens.add({
        targets: glow,
        scale: 1.18,
        alpha: 0.55,
        duration: 760,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.tweens.add({
        targets: orb,
        angle: { from: -4, to: 4 },
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.powerOrb = root;
    this.powerOrbBadge = badge;
    this.buildPowerRail();
    this.refreshPowerBar();
  }

  /**
   * POWER charges rail — the 8 powers in one row filling the band under the
   * dice (Jose: "aprovecha el espacio"): live counts, tap-to-use shortcuts
   * (same flows as the orb popover, which stays for names/details).
   */
  private buildPowerRail(): void {
    const spacing = 78;
    const startX = GAME_W / 2 - (spacing * (GameBoardScene.POWER_ORDER.length - 1)) / 2;
    const holder = this.add.container(0, 0).setDepth(DEPTH.hud);
    const bg = this.add.graphics();
    bg.fillStyle(LR_COLORS.hudInk, 0.4);
    bg.fillRoundedRect(GAME_W / 2 - 330, ACTION.railY - 42, 660, 84, 26);
    bg.lineStyle(2, LR_COLORS.brand300, 0.3);
    bg.strokeRoundedRect(GAME_W / 2 - 330, ACTION.railY - 42, 660, 84, 26);
    holder.add(bg);
    GameBoardScene.POWER_ORDER.forEach((power, i) => {
      const x = startX + spacing * i;
      const root = this.add.container(x, ACTION.railY).setDepth(DEPTH.hud + 1);
      const ring = this.add
        .circle(0, 0, 30, LR_COLORS.panelInk, 0.85)
        .setStrokeStyle(2, LR_COLORS.gold500, 0.85);
      const icon = this.add.image(0, 0, `power_${power}`).setDisplaySize(48, 48);
      const badge = uiText(this, 21, -20, '', 14, LR_COLORS.textOnDark, '800').setStroke(
        cssColor(LR_COLORS.panelInk),
        4,
      );
      root.add([ring, icon, badge]);
      // Top-left based rect for a sized container (see ModeCard invariant).
      root.setSize(70, 70);
      root.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, 70, 70),
        Phaser.Geom.Rectangle.Contains,
      );
      root.on(Phaser.Input.Events.POINTER_UP, () => this.onPowerTap(power));
      this.railButtons.set(power, { root, badge });
    });
  }

  /** Whose charges the bar shows: the device's hand (pass&play rotates). */
  private barSeat(): Seat | undefined {
    if (this.matchInit.mode === 'local') {
      return this.activeSeat ?? this.driver.snapshot().currentSeat;
    }
    return this.seats.find((s) => s.human)?.seat;
  }

  private refreshPowerBar(): void {
    if (!this.powerMode || !this.powerOrb || !this.powerOrbBadge) return;
    const snap = this.driver.snapshot();
    const seat = this.barSeat();
    const charges = seat !== undefined ? snap.charges[seat] : undefined;
    const total = charges
      ? GameBoardScene.POWER_ORDER.reduce((sum, p) => sum + (charges[p] ?? 0), 0)
      : 0;
    const usable =
      seat !== undefined &&
      snap.phase === 'playing' &&
      snap.currentSeat === seat &&
      snap.turnPhase === 'wait_roll' &&
      !this.matchOver;
    this.powerOrbBadge.setText(total > 0 ? `${total}` : '');
    this.powerOrb.setAlpha(total > 0 ? (usable ? 1 : 0.75) : 0.4);
    for (const [power, { root, badge }] of this.railButtons) {
      const count = charges?.[power] ?? 0;
      badge.setText(count > 0 ? `${count}` : '');
      root.setAlpha(count > 0 ? (usable ? 1 : 0.7) : 0.3);
    }
  }

  private togglePowerPopover(): void {
    if (this.powerPopover) {
      this.closePowerPopover();
      return;
    }
    this.openPowerPopover();
  }

  /** The little "your powers" window: 8 medallions with ×count badges. */
  private openPowerPopover(): void {
    this.closePowerPopover();
    this.closePickPopover();
    if (this.targetPower !== null) this.exitTargetMode();
    const seat = this.barSeat();
    if (seat === undefined || this.matchOver) return;
    const snap = this.driver.snapshot();
    const charges = snap.charges[seat];
    const usable = snap.currentSeat === seat && snap.turnPhase === 'wait_roll';
    const total = charges
      ? GameBoardScene.POWER_ORDER.reduce((sum, p) => sum + (charges[p] ?? 0), 0)
      : 0;

    const cols = 4;
    const cell = dp(104);
    const w = cols * cell + dp(28);
    const h = (total === 0 ? dp(96) : 2 * cell) + dp(64);
    const cx = Math.min(Math.max(ACTION.powerX, w / 2 + dp(12)), GAME_W - w / 2 - dp(12));
    const root = this.add
      .container(cx, ACTION.powerY - dp(78) - h / 2)
      .setDepth(DEPTH.modal);
    const bg = this.add.graphics();
    bg.fillStyle(LR_COLORS.hudInk, 0.96);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, dp(18));
    bg.lineStyle(2, LR_COLORS.gold500, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, dp(18));
    root.add(bg);
    root.add(uiText(this, 0, -h / 2 + dp(24), t('power.orb_title'), 15, LR_COLORS.textOnDark, '800'));

    if (total === 0) {
      const empty = uiText(this, 0, dp(10), t('power.empty'), 13, LR_COLORS.textOnDark, '600');
      empty.setWordWrapWidth(w - dp(48));
      empty.setAlign('center');
      root.add(empty);
    } else {
      GameBoardScene.POWER_ORDER.forEach((power, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const px = -w / 2 + dp(14) + cell * col + cell / 2;
        const py = -h / 2 + dp(48) + cell * row + cell / 2;
        const count = charges?.[power] ?? 0;
        const entry = this.add.container(px, py);
        const ring = this.add
          .circle(0, 0, dp(38), LR_COLORS.panelInk, 0.9)
          .setStrokeStyle(2.5, LR_COLORS.gold500, count > 0 ? 0.95 : 0.25);
        const icon = this.add.image(0, 0, `power_${power}`).setDisplaySize(dp(58), dp(58));
        const badge = uiText(
          this,
          dp(24),
          -dp(26),
          count > 0 ? `${count}` : '',
          15,
          LR_COLORS.textOnDark,
          '800',
        ).setStroke(cssColor(LR_COLORS.panelInk), 4);
        entry.add([ring, icon, badge]);
        entry.setAlpha(count > 0 ? (usable ? 1 : 0.55) : 0.28);
        if (count > 0 && usable) {
          entry.setSize(dp(92), dp(92));
          entry.setInteractive(
            new Phaser.Geom.Rectangle(0, 0, dp(92), dp(92)),
            Phaser.Geom.Rectangle.Contains,
          );
          entry.on(Phaser.Input.Events.POINTER_UP, () => {
            this.closePowerPopover();
            this.onPowerTap(power);
          });
        }
        root.add(entry);
      });
    }

    if (!reducedMotion()) {
      root.setAlpha(0).setScale(0.92);
      this.tweens.add({ targets: root, alpha: 1, scale: 1, duration: 160, ease: 'Back.easeOut' });
    }
    this.powerPopover = root;
  }

  private closePowerPopover(): void {
    this.powerPopover?.destroy();
    this.powerPopover = undefined;
  }

  private onPowerTap(power: PowerType): void {
    const seat = this.barSeat();
    if (seat === undefined || this.matchOver) return;
    const snap = this.driver.snapshot();
    if (snap.currentSeat !== seat || snap.turnPhase !== 'wait_roll') return;
    if ((snap.charges[seat]?.[power] ?? 0) <= 0) return;

    this.closePickPopover();
    if (this.targetPower !== null) this.exitTargetMode();

    if (power === 'double') {
      this.driver.usePower('double');
      void this.toast.show(t('power.armed_double'), 1100);
      return;
    }
    if (power === 'pick') {
      this.openPickPopover();
      return;
    }
    if (power === 'bomb') {
      this.enterBombTargeting(snap);
      return;
    }
    // Piece-target powers: own piece (shield/plus/portal) or ENEMY (bolt/freeze).
    const eligible = this.eligibleTargets(power, seat, snap);
    if (eligible.length === 0) {
      void this.toast.show(t('power.no_target'), 1000);
      return;
    }
    this.targetPower = power;
    for (const view of eligible) view.setSelectable(true, true);
    this.banner.setText(
      power === 'bolt' || power === 'freeze' ? t('power.choose_enemy') : t('power.choose_target'),
    );
  }

  /** Bomb: pulsing tap markers on every free, non-safe, untrapped ring cell. */
  private enterBombTargeting(snap: ReturnType<SceneDriver['snapshot']>): void {
    this.targetPower = 'bomb';
    this.banner.setText(t('power.choose_cell'));
    const occupied = new Set<number>();
    for (const piece of snap.pieces) {
      if (!isOnTrack(piece.steps)) continue;
      const color = snap.players.find((p) => p.seat === piece.seat)?.color;
      const abs = color !== undefined ? toAbsoluteCell(color, piece.steps) : null;
      if (abs !== null) occupied.add(abs);
    }
    for (let cellIdx = 0; cellIdx < TRACK_SIZE; cellIdx++) {
      if (SAFE_CELLS.has(cellIdx)) continue;
      if (occupied.has(cellIdx)) continue;
      // Only YOUR traps block targeting: rival traps are hidden, and skipping
      // their cells here would leak them (the engine allows stacking on them).
      if (snap.traps.some((tr) => tr.cell === cellIdx && this.driver.isHumanSeat(tr.seat))) continue;
      const pos = this.board.absCellXY(cellIdx);
      const marker = this.add.container(pos.x, pos.y).setDepth(DEPTH.modal - 1);
      const dot = this.add
        .circle(0, 0, dp(15), LR_COLORS.brand300, 0.35)
        .setStrokeStyle(2, LR_COLORS.brand300, 0.9);
      marker.add(dot);
      marker.setSize(dp(40), dp(40));
      marker.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, dp(40), dp(40)),
        Phaser.Geom.Rectangle.Contains,
      );
      const cell = cellIdx;
      marker.on(Phaser.Input.Events.POINTER_UP, () => {
        this.exitTargetMode();
        this.driver.usePower('bomb', { cell });
      });
      if (!reducedMotion()) {
        this.tweens.add({
          targets: dot,
          alpha: 0.85,
          scale: 1.25,
          duration: 620,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      this.cellPickers.push(marker);
    }
    if (this.cellPickers.length === 0) {
      this.targetPower = null;
      void this.toast.show(t('power.no_target'), 1000);
    }
  }

  private eligibleTargets(
    power: PowerType,
    seat: Seat,
    snap: ReturnType<SceneDriver['snapshot']>,
  ): PieceView[] {
    const views: PieceView[] = [];
    for (const piece of snap.pieces) {
      let ok = false;
      if (power === 'bolt' || power === 'freeze') {
        // Offensive: a LIVE enemy piece (bolt: ring only; freeze: ring+lane).
        if (piece.seat === seat) continue;
        const enemy = snap.players.find((p) => p.seat === piece.seat);
        if (!enemy || enemy.forfeited || enemy.place > 0) continue;
        ok =
          power === 'bolt'
            ? isOnTrack(piece.steps) && !isShielded(snap, piece.seat, piece.pieceId)
            : piece.steps >= 0 &&
              piece.steps < HOME_STEPS &&
              !isShielded(snap, piece.seat, piece.pieceId) &&
              !isFrozen(snap, piece.seat, piece.pieceId);
      } else {
        if (piece.seat !== seat) continue;
        if (power === 'shield') {
          ok = isOnTrack(piece.steps) && !isShielded(snap, seat, piece.pieceId);
        } else if (power === 'plus') {
          ok = describeMove(snap, seat, piece.pieceId, 1) !== null;
        } else if (power === 'portal') {
          ok = isOnTrack(piece.steps) && this.hasSafeCellAhead(snap, seat, piece.steps);
        }
      }
      if (!ok) continue;
      const view = this.pieceOf(piece.seat, piece.pieceId);
      if (view) views.push(view);
    }
    return views;
  }

  /** Client mirror of the engine's portal reachability (pre-filters targets). */
  private hasSafeCellAhead(
    snap: ReturnType<SceneDriver['snapshot']>,
    seat: Seat,
    steps: number,
  ): boolean {
    const color = snap.players.find((p) => p.seat === seat)?.color;
    if (color === undefined) return false;
    for (let s = steps + 1; s <= LAST_TRACK_STEP; s++) {
      const abs = toAbsoluteCell(color, s);
      if (abs !== null && SAFE_CELLS.has(abs)) return true;
    }
    return false;
  }

  private exitTargetMode(): void {
    for (const marker of this.cellPickers) marker.destroy();
    this.cellPickers = [];
    if (this.targetPower === null) return;
    this.targetPower = null;
    this.clearHighlights();
    // If the roll already resolved underneath the armed power, the clear
    // above just wiped the MOVE highlights — restore them from the engine
    // truth so the turn never bricks (shield-freeze bug).
    const snap = this.driver.snapshot();
    const seat = this.barSeat();
    if (
      seat !== undefined &&
      snap.phase === 'playing' &&
      snap.currentSeat === seat &&
      snap.turnPhase === 'wait_move' &&
      snap.dice > 0
    ) {
      for (const piece of snap.pieces) {
        if (piece.seat !== seat) continue;
        if (describeMove(snap, seat, piece.pieceId, snap.dice) !== null) {
          this.pieceOf(seat, piece.pieceId)?.setSelectable(true);
        }
      }
      this.banner.setText(t('game.choose_piece'));
      return;
    }
    this.banner.setText(t('game.your_turn'));
  }

  /** Six mini faces above the dice — tap one to arm the pick. */
  private openPickPopover(): void {
    this.closePickPopover();
    // Anchored over the travelling GO bubble, clamped inside the screen.
    const px = Math.min(Math.max(this.goBubble.x, 252), GAME_W - 252);
    const root = this.add.container(px, this.goBubble.y - dp(120)).setDepth(DEPTH.modal);
    const w = dp(64);
    const bg = this.add.graphics();
    bg.fillStyle(LR_COLORS.hudInk, 0.95);
    bg.fillRoundedRect(-w * 3 - dp(10), -dp(38), w * 6 + dp(20), dp(76), dp(16));
    root.add(bg);
    root.add(
      uiText(this, 0, -dp(54), t('power.pick_title'), 14, LR_COLORS.textOnDark, '700').setStroke(
        cssColor(LR_COLORS.panelInk),
        3,
      ),
    );
    for (let face = 1; face <= 6; face++) {
      const bx = (face - 3.5) * w;
      const btn = this.add.container(bx, 0);
      const img = this.add.image(0, 0, `dice_face_${face}`);
      img.setDisplaySize(dp(52), dp(52));
      btn.add(img);
      btn.setSize(dp(56), dp(56));
      btn.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, dp(56), dp(56)),
        Phaser.Geom.Rectangle.Contains,
      );
      btn.on(Phaser.Input.Events.POINTER_UP, () => {
        this.closePickPopover();
        this.driver.usePower('pick', { face });
      });
      root.add(btn);
    }
    this.pickPopover = root;
  }

  private closePickPopover(): void {
    this.pickPopover?.destroy();
    this.pickPopover = undefined;
  }

  /** Sync tokens/domes/bar straight from the snapshot (create + resync). */
  private syncPowerState(): void {
    const snap = this.driver.snapshot();
    const wanted = new Map(snap.tokens.map((tk) => [tk.cell, tk.power] as const));
    for (const [cell, sprite] of this.tokenSprites) {
      if (!wanted.has(cell)) {
        sprite.destroy();
        this.tokenSprites.delete(cell);
      }
    }
    for (const [cell, power] of wanted) {
      if (!this.tokenSprites.has(cell)) this.placeToken(cell, power, false);
    }
    // Rival bombs are secret weapons: only traps planted by a seat driven
    // from THIS device (you online; any human in pass&play) get a marker.
    const wantedTraps = new Set(
      snap.traps.filter((tr) => this.driver.isHumanSeat(tr.seat)).map((tr) => tr.cell),
    );
    for (const [cell, sprite] of this.trapSprites) {
      if (!wantedTraps.has(cell)) {
        sprite.destroy();
        this.trapSprites.delete(cell);
      }
    }
    for (const cell of wantedTraps) {
      if (!this.trapSprites.has(cell)) this.placeTrap(cell, false);
    }
    for (const view of this.pieceViews.values()) {
      view.setShielded(isShielded(snap, view.seat, view.pieceId));
      view.setFrozen(isFrozen(snap, view.seat, view.pieceId));
    }
    this.refreshPowerBar();
  }

  private placeToken(cell: number, power: PowerType, animate: boolean): void {
    const pos = this.board.absCellXY(cell);
    const sprite = this.add
      .image(pos.x, pos.y, `power_${power}`)
      .setDepth(DEPTH.pieces - 0.5)
      .setDisplaySize(dp(38), dp(38));
    this.tokenSprites.set(cell, sprite);
    if (!animate || reducedMotion()) return;
    sprite.setAlpha(0).setY(pos.y - dp(40));
    this.tweens.add({
      targets: sprite,
      alpha: 1,
      y: pos.y,
      duration: 320,
      ease: 'Bounce.easeOut',
    });
  }

  private async taskTokenSpawned(msg: TokenSpawnedMessage): Promise<void> {
    if (this.tokenSprites.has(msg.cell)) return;
    this.placeToken(msg.cell, msg.power, true);
    await Promise.resolve();
  }

  private async taskTokenCollected(msg: TokenCollectedMessage): Promise<void> {
    const sprite = this.tokenSprites.get(msg.cell);
    if (sprite) {
      this.tokenSprites.delete(msg.cell);
      this.fx.emitBurst(sprite.x, sprite.y, LR_COLORS.gold300, 8);
      if (reducedMotion()) {
        sprite.destroy();
      } else {
        this.tweens.add({
          targets: sprite,
          alpha: 0,
          scale: 1.6,
          duration: 220,
          ease: 'Quad.easeOut',
          onComplete: () => sprite.destroy(),
        });
      }
    }
    this.refreshPowerBar();
    if (this.driver.isHumanSeat(msg.seat)) {
      await this.toast.show(
        t('power.collected', { name: t(`power.${msg.power}` as I18nKey) }),
        900,
      );
    }
  }

  private async taskPowerUsed(msg: PowerUsedMessage): Promise<void> {
    this.refreshPowerBar();
    const own = this.driver.isHumanSeat(msg.seat);
    const name = this.seats.find((s) => s.seat === msg.seat)?.name ?? '';
    switch (msg.power) {
      case 'shield': {
        if (msg.pieceId !== undefined) {
          this.pieceOf(msg.seat, msg.pieceId)?.setShielded(true);
          sfx('shield');
          haptic('tap');
        }
        await this.toast.show(
          own ? t('power.shield_on') : t('power.rival_shield', { name }),
          own ? 900 : 1100,
        );
        return;
      }
      case 'bomb': {
        if (msg.cell !== undefined && own) this.placeTrap(msg.cell, true);
        haptic('tap');
        await this.toast.show(own ? t('power.bomb_set') : t('power.rival_bomb', { name }), 1100);
        return;
      }
      case 'freeze': {
        if (msg.targetSeat !== undefined && msg.pieceId !== undefined) {
          this.pieceOf(msg.targetSeat, msg.pieceId)?.setFrozen(true);
          haptic('tap');
        }
        await this.toast.show(
          own ? t('power.freeze_on') : t('power.rival_freeze', { name }),
          1100,
        );
        return;
      }
      case 'bolt': {
        if (msg.targetSeat !== undefined && msg.pieceId !== undefined) {
          const view = this.pieceOf(msg.targetSeat, msg.pieceId);
          if (view) {
            this.fx.emitBurst(view.x, view.y, 0xffd34d, 14);
            if (!reducedMotion()) this.cameras.main.shake(120, 0.004);
          }
          haptic('tap');
        }
        await this.toast.show(own ? t('power.bolt_hit') : t('power.rival_bolt', { name }), 1100);
        return;
      }
      case 'portal': {
        if (msg.pieceId !== undefined) {
          const view = this.pieceOf(msg.seat, msg.pieceId);
          if (view) this.fx.emitBurst(view.x, view.y, 0x9b5cf6, 12);
        }
        await this.toast.show(
          own ? t('power.portal_jump') : t('power.rival_portal', { name }),
          1100,
        );
        return;
      }
      case 'pick':
        if (!own) await this.toast.show(t('power.rival_pick', { name, v: msg.face ?? 0 }), 1100);
        return;
      case 'double':
        if (!own) await this.toast.show(t('power.rival_double', { name }), 1100);
        return;
      default:
        return;
    }
  }

  /** 💥 an armed bomb went off — explosion, then the victim flies home. */
  private async taskTrapTriggered(msg: TrapTriggeredMessage): Promise<void> {
    const sprite = this.trapSprites.get(msg.cell);
    if (sprite) {
      this.trapSprites.delete(msg.cell);
      sprite.destroy();
    }
    const pos = this.board.absCellXY(msg.cell);
    this.fx.emitBurst(pos.x, pos.y, 0xe63950, 18);
    if (!reducedMotion()) this.cameras.main.shake(160, 0.006);
    sfx('capture');
    haptic('tap');
    const victim = this.pieceOf(msg.victimSeat, msg.victimPieceId);
    if (msg.blocked) {
      victim?.setShielded(false);
    } else if (victim) {
      await this.flyVictimHome(victim);
    }
    await this.toast.show(t(msg.blocked ? 'power.trap_blocked' : 'power.trap_boom'), 1200);
    this.layoutStacks();
  }

  /** Send a bombed piece back to its base slot (quick arc, no hop chain). */
  private flyVictimHome(victim: PieceView): Promise<void> {
    const base = this.board.baseSlotXY(victim.color, victim.pieceId);
    if (reducedMotion()) {
      victim.snapTo(base, -1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.add({
        targets: victim,
        x: base.x,
        y: base.y,
        duration: 420,
        ease: 'Quad.easeIn',
        onComplete: () => {
          victim.snapTo(base, -1);
          resolve();
        },
      });
    });
  }

  /** Armed bomb marker on a ring cell — only for traps this device may see. */
  private placeTrap(cell: number, animate: boolean): void {
    if (this.trapSprites.has(cell)) return;
    const pos = this.board.absCellXY(cell);
    const sprite = this.add
      .image(pos.x, pos.y, 'fx_trap')
      .setDepth(DEPTH.pieces - 0.6)
      .setDisplaySize(dp(40), dp(40));
    this.trapSprites.set(cell, sprite);
    if (!animate || reducedMotion()) return;
    sprite.setAlpha(0).setY(pos.y - dp(30));
    this.tweens.add({
      targets: sprite,
      alpha: 1,
      y: pos.y,
      duration: 300,
      ease: 'Bounce.easeOut',
    });
  }

  /** Static second face beside a die after a double roll (short-lived). */
  private showSecondDie(x: number, y: number, face: number): void {
    const img = this.add
      .image(x, y, `dice_face_${face}`)
      .setDepth(DEPTH.dice + 1)
      .setDisplaySize(dp(56), dp(56))
      .setAlpha(0);
    this.tweens.add({
      targets: img,
      alpha: 1,
      duration: reducedMotion() ? 80 : 160,
      ease: 'Quad.easeOut',
    });
    this.time.delayedCall(1400, () => {
      if (reducedMotion()) {
        img.destroy();
        return;
      }
      this.tweens.add({ targets: img, alpha: 0, duration: 200, onComplete: () => img.destroy() });
    });
  }

  // -- helpers ---------------------------------------------------------------

  private pieceKey(seat: Seat, pieceId: number): string {
    return `${seat}:${pieceId}`;
  }

  private pieceOf(seat: Seat, pieceId: number): PieceView | undefined {
    return this.pieceViews.get(this.pieceKey(seat, pieceId));
  }

  private clearHighlights(): void {
    for (const view of this.pieceViews.values()) view.setSelectable(false);
  }

  /** Fan out pieces sharing one cell so walls/stacks stay readable. */
  private layoutStacks(): void {
    const groups = new Map<string, PieceView[]>();
    for (const view of this.pieceViews.values()) {
      if (view.steps === HOME_STEPS) continue;
      let key: string;
      if (view.steps < 0) {
        key = `base:${view.color}:${view.pieceId}`; // unique — never stacked
      } else if (view.steps <= LAST_TRACK_STEP) {
        key = `abs:${(ENTRY_CELLS[view.color] + view.steps) % TRACK_SIZE}`;
      } else {
        key = `lane:${view.color}:${view.steps}`;
      }
      const arr = groups.get(key) ?? [];
      arr.push(view);
      groups.set(key, arr);
    }
    // Real-board formations (Jose feedback): 2 side by side, 3 in a
    // triangle, 4 in a 2x2 grid - every pawn ENTERS the cell, no blob.
    const FORMS: Record<number, { x: number; y: number }[]> = {
      2: [{ x: -9, y: 1 }, { x: 9, y: 1 }],
      3: [{ x: 0, y: -7 }, { x: -9, y: 7 }, { x: 9, y: 7 }],
      4: [{ x: -9, y: -6 }, { x: 9, y: -6 }, { x: -9, y: 8 }, { x: 9, y: 8 }],
    };
    const MULS: Record<number, number> = { 2: 0.78, 3: 0.68, 4: 0.6 };
    for (const arr of groups.values()) {
      if (arr.length === 1) {
        arr[0]?.applyStackOffset({ x: 0, y: 0 }, 1);
        continue;
      }
      const form = FORMS[arr.length];
      const mul = MULS[arr.length] ?? 0.52;
      arr.forEach((view, i) => {
        if (form) {
          view.applyStackOffset(form[i] ?? { x: 0, y: 0 }, mul);
        } else {
          const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
          view.applyStackOffset({ x: Math.cos(a) * 10, y: Math.sin(a) * 7 }, mul);
        }
      });
    }
  }
}
