/**
 * BootScene (ARQUITECTURA §4.2): zero assets, sub-100ms. Runtime flags
 * (locale, reduced motion) are initialized in main.ts before Phaser boots;
 * this scene only hands over to the splash (which owns the boot pipeline).
 */
import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Splash');
  }
}
