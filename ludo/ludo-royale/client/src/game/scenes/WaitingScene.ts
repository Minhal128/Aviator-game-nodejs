/**
 * WaitingScene — online lobby, LW "Friend-Power" popup parity (Jose ref):
 * one big violet card with the mode title, avatar slots (empty seats show
 * an invite silhouette), the room-code pill (tap to copy), a waiting line
 * and the Invitar / Empezar pair — Empezar stays GRAY until the table has
 * 2+ players and only the host can fire it. Hands the live driver to
 * GameBoardScene the moment the room turns 'playing'.
 */
import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../layout';
import { LR_COLORS, LR_FONTS, cssColor, dp } from '../../theme/tokens';
import { errText, t } from '../../i18n';
import { Button } from '../ui/Button';
import { Toast } from '../ui/Toast';
import { uiText, gameText } from '../ui/text';
import { SceneBackdrop } from '../objects/SceneBackdrop';
import { ColyseusClient } from '../net/ColyseusClient';
import type { LobbyInfo } from '../net/ColyseusClient';
import type { MatchInit } from '../matchTypes';

export interface WaitingParams {
  kind: 'quick' | 'create' | 'join';
  size?: 2 | 3 | 4;
  code?: string;
  /** POWER tables — quick queues split by it; joiners inherit the room's. */
  powerMode?: boolean;
}

const SLOT_RADIUS = 50;
const CARD_X = GAME_W / 2;
const CARD_Y = 600;

export class WaitingScene extends Phaser.Scene {
  private params!: WaitingParams;
  private driver?: ColyseusClient;
  private lobbyInfo?: LobbyInfo;
  private handedOff = false;
  private failing = false;

  private titleText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private slotsBox!: Phaser.GameObjects.Container;
  private buttonsBox!: Phaser.GameObjects.Container;
  private codeBox?: Phaser.GameObjects.Container;
  private toast!: Toast;

  constructor() {
    super('Waiting');
  }

  init(params: WaitingParams): void {
    this.params = params;
  }

  create(): void {
    this.handedOff = false;
    this.failing = false;
    this.driver = undefined;
    this.lobbyInfo = undefined;
    this.codeBox = undefined;

    new SceneBackdrop(this, 'home');
    this.buildChevron();

    // LW popup card: the whole lobby lives on one violet slab.
    const card = this.add.graphics();
    card.fillStyle(0x3d3480, 0.96);
    card.fillRoundedRect(CARD_X - 330, CARD_Y - 340, 660, 680, 36);
    card.lineStyle(3, 0xffffff, 0.18);
    card.strokeRoundedRect(CARD_X - 330, CARD_Y - 340, 660, 680, 36);

    // Join learns the room's mode from the first lobby snapshot.
    const power = this.params.kind === 'join' ? undefined : (this.params.powerMode ?? false);
    this.titleText = gameText(this, CARD_X, CARD_Y - 280, this.cardTitle(power), 36, {
      strokeColor: LR_COLORS.titleStrokeCool,
    });
    this.slotsBox = this.add.container(CARD_X, CARD_Y - 150);
    this.statusText = uiText(this, CARD_X, CARD_Y + 160, t('online.connecting'), 20, LR_COLORS.textOnDark, '700');
    this.buttonsBox = this.add.container(CARD_X, CARD_Y + 264);
    this.toast = new Toast(this, GAME_W / 2, GAME_H - 200);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Leaving without a handoff (back/fail) releases the seat.
      if (!this.handedOff) this.driver?.destroy();
    });

    void this.connect();
  }

  override update(): void {
    const info = this.lobbyInfo;
    if (!info || this.handedOff) return;
    if (info.phase === 'countdown' && info.countdownEnds > 0) {
      const secs = Math.max(1, Math.ceil((info.countdownEnds - Date.now()) / 1000));
      this.statusText.setText(t('online.starting_in', { s: secs }));
    }
  }

  // -------------------------------------------------------------------------

  private cardTitle(power?: boolean): string {
    const base = this.params.kind === 'quick' ? t('online.waiting_title') : t('online.friends_room');
    return power === true ? `${base} · POWER` : base;
  }

  /** Same back chevron as the Home setup screens — leaving frees the seat. */
  private buildChevron(): void {
    const back = this.add.container(60, 64);
    const g = this.add.graphics();
    g.fillStyle(0x3d3480, 0.9);
    g.fillRoundedRect(-32, -32, 64, 64, 18);
    g.lineStyle(2, 0xffffff, 0.25);
    g.strokeRoundedRect(-32, -32, 64, 64, 18);
    back.add(g);
    back.add(uiText(this, -1, -1, '❮', 26, LR_COLORS.textOnDark, '800'));
    back.setSize(88, 88);
    back.setInteractive(new Phaser.Geom.Rectangle(0, 0, 88, 88), Phaser.Geom.Rectangle.Contains);
    back.on(Phaser.Input.Events.POINTER_DOWN, () => this.scene.start('Home'));
  }

  private async connect(): Promise<void> {
    try {
      const driver =
        this.params.kind === 'quick'
          ? await ColyseusClient.quickMatch(this.params.size ?? 2, this.params.powerMode ?? false)
          : this.params.kind === 'create'
            ? await ColyseusClient.createPrivate(this.params.size ?? 4, this.params.powerMode ?? false)
            : await ColyseusClient.joinPrivate(this.params.code ?? '');

      if (!this.scene.isActive('Waiting')) {
        driver.destroy(); // player cancelled while connecting
        return;
      }
      this.driver = driver;
      driver.onLobbyUpdate = (info) => this.renderLobby(info);
      driver.onConnectionStatus = (status) => {
        if (status === 'lost') this.failOut(t('online.connection_lost'));
      };
      this.renderLobby(driver.lobby);
    } catch (err) {
      // Timeouts and transport failures reject with ERR_CONNECT_TIMEOUT or a
      // raw WS message; §6.5 codes map to their own strings via errText.
      // failOut() toasts, unblocks and returns to Home — never a dead lobby.
      const raw = err instanceof Error ? err.message : String(err);
      const fallback =
        this.params.kind === 'join' ? t('online.join_failed') : t('online.connect_failed');
      this.failOut(errText(raw, fallback));
    }
  }

  private renderLobby(info: LobbyInfo): void {
    if (this.handedOff || !this.driver) return;
    this.lobbyInfo = info;

    if (info.phase === 'playing') {
      this.handedOff = true;
      const numPlayers = (info.numPlayers >= 2 && info.numPlayers <= 4 ? info.numPlayers : 2) as
        | 2
        | 3
        | 4;
      const init: MatchInit = {
        mode: 'online',
        numPlayers,
        aiLevel: 'easy',
        powerMode: this.driver.snapshot().config.powerMode,
        driver: this.driver,
        roomCode: info.code !== '' ? info.code : undefined,
      };
      this.scene.start('Game', init);
      return;
    }

    this.titleText.setText(this.cardTitle(this.driver.snapshot().config.powerMode));
    if (info.phase === 'lobby') this.statusText.setText(t('online.waiting_players'));
    this.renderSlots(info);
    if (info.code !== '') this.ensureCodeBox(info.code);
    this.renderButtons(info);
  }

  /** LW slots: blue disc + initial for seated, invite silhouette for empty. */
  private renderSlots(info: LobbyInfo): void {
    this.slotsBox.removeAll(true);
    const count = info.size;
    const gap = dp(20);
    const totalW = count * SLOT_RADIUS * 2 + (count - 1) * gap;
    for (let i = 0; i < count; i++) {
      const x = -totalW / 2 + SLOT_RADIUS + i * (SLOT_RADIUS * 2 + gap);
      const slot = info.players[i];
      const g = this.add.graphics();
      if (slot) {
        g.fillStyle(0x5a67d8, 1);
        g.fillCircle(x, 0, SLOT_RADIUS);
        g.lineStyle(5, slot.isYou ? LR_COLORS.gold500 : 0x3f4ab0, 1);
        g.strokeCircle(x, 0, SLOT_RADIUS - 2);
        this.slotsBox.add(g);
        this.slotsBox.add(
          this.add
            .text(x, 0, slot.name.charAt(0).toUpperCase(), {
              fontFamily: LR_FONTS.display,
              fontSize: '36px',
              fontStyle: '800',
              color: cssColor(0xffffff),
            })
            .setOrigin(0.5),
        );
        this.slotsBox.add(
          uiText(this, x, SLOT_RADIUS + 22, slot.name, 15, LR_COLORS.textOnDark, '700'),
        );
        if (slot.isYou) {
          this.slotsBox.add(uiText(this, x, -SLOT_RADIUS - 18, t('game.you'), 13, LR_COLORS.gold300, '800'));
        }
      } else {
        // Empty seat = faded disc + person silhouette + gold "+" (LW Invite).
        g.fillStyle(0x5a67d8, 0.45);
        g.fillCircle(x, 0, SLOT_RADIUS);
        g.lineStyle(3, 0xffffff, 0.25);
        g.strokeCircle(x, 0, SLOT_RADIUS - 2);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(x, -14, 13);
        g.fillRoundedRect(x - 20, 2, 40, 26, 13);
        g.fillStyle(LR_COLORS.gold500, 1);
        g.fillCircle(x + 28, 16, 12);
        this.slotsBox.add(g);
        this.slotsBox.add(uiText(this, x + 28, 15, '+', 18, LR_COLORS.textOnDark, '800'));
        this.slotsBox.add(
          uiText(this, x, SLOT_RADIUS + 22, t('online.invite'), 14, LR_COLORS.textFaint, '700'),
        );
      }
    }
  }

  /** Room-code pill (LW): dark capsule, gold digits, tap anywhere to copy. */
  private ensureCodeBox(code: string): void {
    if (this.codeBox) return;
    const box = this.add.container(CARD_X, CARD_Y + 40);
    const g = this.add.graphics();
    g.fillStyle(LR_COLORS.hudInk, 0.9);
    g.fillRoundedRect(-250, -48, 500, 96, 48);
    g.lineStyle(2, LR_COLORS.gold500, 0.4);
    g.strokeRoundedRect(-250, -48, 500, 96, 48);
    box.add(g);
    box.add(uiText(this, 0, -24, t('online.room_code'), 14, LR_COLORS.textFaint, '700'));
    box.add(
      gameText(this, 0, 14, code.split('').join(' '), 40, {
        tint: [LR_COLORS.gold300, LR_COLORS.gold300, LR_COLORS.gold500, LR_COLORS.gold500],
        strokeColor: LR_COLORS.titleStrokeBrown, // §7: gold numbers → brown outline
      }),
    );
    box.setSize(500, 96);
    box.setInteractive(new Phaser.Geom.Rectangle(0, 0, 500, 96), Phaser.Geom.Rectangle.Contains);
    box.on(Phaser.Input.Events.POINTER_UP, () => void this.copyCode(code));
    this.codeBox = box;
  }

  /**
   * LW pair: Invitar (share sheet, clipboard fallback) + Empezar — gray
   * 'muted' until the host can start, so the button EXISTS from second one
   * like Ludo World's. Quick matches have nothing to press (auto-start).
   */
  private renderButtons(info: LobbyInfo): void {
    this.buttonsBox.removeAll(true);
    if (info.code === '' || info.phase !== 'lobby') return;
    const canStart = info.isHost && info.players.length >= 2;
    if (info.isHost) {
      this.buttonsBox.add(
        new Button(this, -155, 0, 280, 96, t('online.invite'), 'brand', () => void this.invite(info.code), 24),
      );
      this.buttonsBox.add(
        new Button(
          this,
          155,
          0,
          280,
          96,
          t('online.start_now'),
          canStart ? 'success' : 'muted',
          () => {
            if (canStart) this.driver?.sendStartMatch();
            else void this.toast.show(t('online.need_players'), 1200);
          },
          24,
        ),
      );
    } else {
      this.buttonsBox.add(
        new Button(this, 0, 0, 320, 96, t('online.invite'), 'brand', () => void this.invite(info.code), 24),
      );
    }
  }

  private async invite(code: string): Promise<void> {
    const text = t('online.invite_text', { code });
    try {
      if ('share' in navigator) {
        await navigator.share({ text, url: window.location.origin });
        return;
      }
    } catch {
      return; // user dismissed the share sheet — not an error
    }
    await this.copyCode(code);
  }

  private async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      await this.toast.show(t('online.copied'), 900);
    } catch {
      // Clipboard unavailable (http / WebView) — the code stays visible.
    }
  }

  private failOut(message: string): void {
    if (this.failing || this.handedOff) return;
    this.failing = true;
    this.statusText.setText(message);
    void this.toast.show(message, 1500);
    this.time.delayedCall(1700, () => {
      if (this.scene.isActive('Waiting')) this.scene.start('Home');
    });
  }
}
