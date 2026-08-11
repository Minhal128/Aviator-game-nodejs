/**
 * Single confirm dialog (forfeit/leave). Enforces the "max 1 modal" rule
 * by construction: callers await the promise; a second open() while one is
 * live resolves false immediately.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_H, GAME_W } from '../layout';
import { LR_COLORS, dp } from '../../theme/tokens';
import { reducedMotion } from '../fx/Juice';
import { Button } from './Button';
import { uiText } from './text';

let openModal = false;

export function confirmModal(
  scene: Phaser.Scene,
  title: string,
  body: string,
  confirmLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  if (openModal) return Promise.resolve(false);
  openModal = true;

  return new Promise((resolve) => {
    const root = scene.add.container(0, 0).setDepth(DEPTH.modal);

    const scrim = scene.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, LR_COLORS.worldVignette, 0.62)
      .setInteractive(); // swallow taps behind the modal
    root.add(scrim);
    // If the scene shuts down with the modal open (connection lost, match
    // end), the display objects die with it — without this reset the
    // module-level guard would stay latched and every future confirm
    // dialog would silently refuse to open.
    root.once(Phaser.GameObjects.Events.DESTROY, () => {
      openModal = false;
    });

    const panelW = 480;
    const panelH = 260;
    const panel = scene.add.container(GAME_W / 2, GAME_H / 2);
    const bg = scene.add.graphics();
    bg.fillStyle(LR_COLORS.surface, 1);
    bg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, dp(20));
    panel.add(bg);
    panel.add(uiText(scene, 0, -panelH / 2 + 56, title, 24, LR_COLORS.text, '800'));
    panel.add(uiText(scene, 0, -panelH / 2 + 100, body, 16, LR_COLORS.textMuted, '500'));

    const close = (value: boolean): void => {
      openModal = false;
      root.destroy();
      resolve(value);
    };
    // Tap outside the panel = cancel (standard dismiss affordance).
    scrim.on(Phaser.Input.Events.POINTER_UP, () => close(false));

    const confirm = new Button(scene, -110, panelH / 2 - 60, 190, 56, confirmLabel, 'danger', () =>
      close(true),
    );
    const cancel = new Button(scene, 110, panelH / 2 - 60, 190, 56, cancelLabel, 'surface', () =>
      close(false),
    );
    panel.add([confirm, cancel]);
    root.add(panel);

    if (!reducedMotion()) {
      panel.setScale(0.9).setAlpha(0);
      scene.tweens.add({
        targets: panel,
        scale: 1,
        alpha: 1,
        duration: 180,
        ease: 'Back.easeOut',
      });
    }
  });
}
