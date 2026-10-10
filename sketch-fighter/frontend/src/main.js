import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

import Phaser from 'phaser';
import { initShell } from './shell.js';
import { initAudioUnlock } from './audio/sfx.js';
import { RENDER_SCALE, VIEW_H, VIEW_W } from './view.js';
import { Boot } from './scenes/Boot.js';
import { Home } from './scenes/Home.js';
import { Capture } from './scenes/Capture.js';
import { Reveal } from './scenes/Reveal.js';
import { Fight } from './scenes/Fight.js';
import { Result } from './scenes/Result.js';
import { SAMPLE_STAGES } from './stage/stages.js';

initShell();
initAudioUnlock();

// Phaser only draws. Input comes from DOM listeners (controls/), and the
// canvas is sized by CSS from shell.js, so scaling and rotation stay ours.
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W * RENDER_SCALE,
  height: VIEW_H * RENDER_SCALE,
  transparent: true,
  scale: { mode: Phaser.Scale.NONE },
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  // Raw frame time: the fight runs its own fixed-step loop (capped per frame),
  // and Phaser's smoothing would slow timers and the sim whenever fps < 60.
  fps: { smoothStep: false },
  banner: false,
  scene: [Boot, Home, Capture, Reveal, Fight, Result],
});
// Handle for tests and the browser console.
window.sketch = { samples: SAMPLE_STAGES };
