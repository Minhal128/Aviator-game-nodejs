/**
 * 6-char room-code entry with an in-canvas keyboard (task: simple Phaser
 * keyboard). The alphabet mirrors the server generator — A-Z2-9 minus the
 * ambiguous 0/O/1/I (§6.1) — laid out as 4 rows of 8 keys plus backspace.
 * Physical keyboards work too (desktop QA niceness).
 */
import Phaser from 'phaser';
import { LR_COLORS, LR_FONTS, cssColor, dp } from '../../theme/tokens';
import { t } from '../../i18n';
import { Button } from './Button';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const SLOT_W = 56;
const SLOT_H = 64;
const SLOT_GAP = 10;
const KEY_W = 52;
const KEY_H = 56;
const KEY_GAP = 6;
const KEYS_PER_ROW = 8;

export class CodeInput extends Phaser.GameObjects.Container {
  private code = '';
  private readonly slotTexts: Phaser.GameObjects.Text[] = [];
  private readonly joinButton: Button;
  private readonly keyHandler: (ev: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, onSubmit: (code: string) => void) {
    super(scene, x, y);
    scene.add.existing(this);

    // -- code slots ----------------------------------------------------------
    const slotsW = CODE_LENGTH * SLOT_W + (CODE_LENGTH - 1) * SLOT_GAP;
    const slotBg = scene.add.graphics();
    for (let i = 0; i < CODE_LENGTH; i++) {
      const sx = -slotsW / 2 + i * (SLOT_W + SLOT_GAP);
      slotBg.fillStyle(LR_COLORS.hudInk, 0.55);
      slotBg.fillRoundedRect(sx, -SLOT_H / 2, SLOT_W, SLOT_H, dp(12));
      slotBg.lineStyle(2, LR_COLORS.brand300, 0.8);
      slotBg.strokeRoundedRect(sx, -SLOT_H / 2, SLOT_W, SLOT_H, dp(12));
      const txt = scene.add
        .text(sx + SLOT_W / 2, 0, '', {
          fontFamily: LR_FONTS.display,
          fontSize: '30px',
          fontStyle: '800',
          color: cssColor(LR_COLORS.textOnDark),
        })
        .setOrigin(0.5);
      this.slotTexts.push(txt);
    }
    this.add(slotBg);
    for (const txt of this.slotTexts) this.add(txt);

    // -- keyboard ------------------------------------------------------------
    const rows = CODE_ALPHABET.length / KEYS_PER_ROW; // 4
    const rowW = KEYS_PER_ROW * KEY_W + (KEYS_PER_ROW - 1) * KEY_GAP;
    const keysTop = SLOT_H / 2 + dp(26);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < KEYS_PER_ROW; c++) {
        const ch = CODE_ALPHABET.charAt(r * KEYS_PER_ROW + c);
        const kx = -rowW / 2 + c * (KEY_W + KEY_GAP) + KEY_W / 2;
        const ky = keysTop + r * (KEY_H + KEY_GAP) + KEY_H / 2;
        this.add(this.makeKey(scene, kx, ky, ch, () => this.typeChar(ch)));
      }
    }

    // -- backspace + join ----------------------------------------------------
    const actionsY = keysTop + rows * (KEY_H + KEY_GAP) + dp(36);
    this.add(
      this.makeKey(scene, -rowW / 2 + KEY_W, actionsY, '⌫', () => this.erase(), KEY_W * 2),
    );
    this.joinButton = new Button(scene, rowW / 2 - 105, actionsY, 210, 60, t('home.join_room_cta'), 'success', () => {
      if (this.code.length === CODE_LENGTH) onSubmit(this.code);
    });
    this.add(this.joinButton);
    this.updateJoinState();

    // Physical keyboard passthrough for desktop.
    this.keyHandler = (ev: KeyboardEvent) => {
      if (ev.key === 'Backspace') {
        this.erase();
        return;
      }
      if (ev.key === 'Enter') {
        if (this.code.length === CODE_LENGTH) onSubmit(this.code);
        return;
      }
      const ch = ev.key.toUpperCase();
      if (ch.length === 1 && CODE_ALPHABET.includes(ch)) this.typeChar(ch);
    };
    scene.input.keyboard?.on('keydown', this.keyHandler);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.keyboard?.off('keydown', this.keyHandler);
    });
  }

  /** Total height (slots + keyboard + actions), for panel layout. */
  static get totalHeight(): number {
    const rows = CODE_ALPHABET.length / KEYS_PER_ROW;
    return SLOT_H / 2 + dp(26) + rows * (KEY_H + KEY_GAP) + dp(36) + KEY_H / 2;
  }

  private makeKey(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    onTap: () => void,
    width: number = KEY_W,
  ): Phaser.GameObjects.Container {
    const key = scene.add.container(x, y);
    const bg = scene.add.graphics();
    bg.fillStyle(LR_COLORS.surface, 0.12);
    bg.fillRoundedRect(-width / 2, -KEY_H / 2, width, KEY_H, dp(10));
    bg.lineStyle(1.5, LR_COLORS.textFaint, 0.35);
    bg.strokeRoundedRect(-width / 2, -KEY_H / 2, width, KEY_H, dp(10));
    key.add(bg);
    key.add(
      scene.add
        .text(0, 0, label, {
          fontFamily: LR_FONTS.ui,
          fontSize: '20px',
          fontStyle: '700',
          color: cssColor(LR_COLORS.textOnDark),
        })
        .setOrigin(0.5),
    );
    // Top-left based rect: sized containers get displayOrigin added to the
    // local point before the hitArea test (see invariant note in ModeCard).
    key.setSize(width, KEY_H);
    key.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, KEY_H),
      Phaser.Geom.Rectangle.Contains,
    );
    key.on(Phaser.Input.Events.POINTER_DOWN, () => key.setAlpha(0.6));
    key.on(Phaser.Input.Events.POINTER_UP, () => {
      key.setAlpha(1);
      onTap();
    });
    key.on(Phaser.Input.Events.POINTER_OUT, () => key.setAlpha(1));
    return key;
  }

  private typeChar(ch: string): void {
    if (this.code.length >= CODE_LENGTH) return;
    this.code += ch;
    this.render();
  }

  private erase(): void {
    if (this.code.length === 0) return;
    this.code = this.code.slice(0, -1);
    this.render();
  }

  private render(): void {
    this.slotTexts.forEach((txt, i) => txt.setText(this.code.charAt(i)));
    this.updateJoinState();
  }

  private updateJoinState(): void {
    this.joinButton.setAlpha(this.code.length === CODE_LENGTH ? 1 : 0.45);
  }
}
