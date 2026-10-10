import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

import Phaser from 'phaser';
import { GAME } from './config.js';
import { RENDER_SCALE, VIEW_H, VIEW_W } from './view.js';
import { Boot } from './scenes/Boot.js';
import { Home } from './scenes/Home.js';

// iOS Safari ignores user-scalable=no for pinch; cancel its gesture events.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W * RENDER_SCALE,
  height: VIEW_H * RENDER_SCALE,
  transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: GAME.physics.gravity }, fps: GAME.physics.fps },
  },
  input: { activePointers: 4 },
  disableContextMenu: true,
  banner: false,
  scene: [Boot, Home],
});
