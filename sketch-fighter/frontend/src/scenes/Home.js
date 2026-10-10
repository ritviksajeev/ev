import Phaser from 'phaser';
import { GAME } from '../config.js';
import { HAS_API } from '../api.js';
import { IS_TOUCH } from '../shell.js';
import { mount } from '../ui/overlay.js';
import { fitCamera } from '../view.js';
import { drawPaper, drawTiles } from '../stage/StageView.js';
import { pickSample } from '../stage/stages.js';
import { sfx } from '../audio/sfx.js';

const ATTRACT_AFTER_MS = 60_000;

export class Home extends Phaser.Scene {
  constructor() {
    super('Home');
  }

  create() {
    fitCamera(this);
    this.preview = pickSample();
    drawPaper(this);
    drawTiles(this, this.preview.tiles, { alpha: 0.1 });
    this.mode = this.registry.get('mode') ?? 'cpu';
    this.mountUi();

    // The laptop on the table drifts into attract mode when nobody touches it.
    if (!IS_TOUCH) {
      this.armIdle();
      this.onActivity = () => this.armIdle();
      window.addEventListener('pointermove', this.onActivity);
      this.events.once('shutdown', () => window.removeEventListener('pointermove', this.onActivity));
    }
  }

  armIdle() {
    this.idle?.remove();
    this.idle = this.time.delayedCall(ATTRACT_AFTER_MS, () => this.scene.start('Fight', { mode: 'demo' }));
  }

  mountUi() {
    const server = this.registry.get('server') ?? {};
    const chip = server.static
      ? { state: 'idle', text: 'web preview' }
      : !server.online
        ? { state: 'off', text: 'scanner offline' }
        : server.inSync
          ? { state: 'ok', text: 'scanner online' }
          : { state: 'warn', text: 'config out of date' };

    const el = mount(this, `
      <div class="screen">
        <header class="bar">
          <div class="brand">sketch fighter</div>
          <div class="chip" data-state="${chip.state}"><i></i><span>${chip.text}</span></div>
        </header>

        <main class="home-main">
          <div class="kicker">( Draw it. Snap it. Fight on it. )</div>
          <h1 class="display home-title">Sketch<br/><span class="accent">Fighter</span></h1>
          <div class="home-actions">
            <label class="btn hit" for="snap">Snap a stage <span class="arrow">&rarr;</span></label>
            <input id="snap" type="file" accept="image/*" capture="environment" hidden />
            <button class="btn ghost" data-act="sample">Play a sample stage</button>
            ${IS_TOUCH ? '' : `
              <div class="seg" role="group" aria-label="Players">
                <button data-mode="cpu" aria-pressed="${this.mode === 'cpu'}">vs CPU</button>
                <button data-mode="2p" aria-pressed="${this.mode === '2p'}">2 players</button>
              </div>`}
          </div>
          ${IS_TOUCH ? '' : '<div class="home-hint">Enter to play &middot; A D W J K &middot; gamepads work too</div>'}
        </main>

        <footer class="bar bottom">
          <span><span class="bracket">[</span> Prototype <span class="bracket">]</span> <span class="hide-narrow">evzero.org</span></span>
          <span class="hide-short">40 &times; 24 tiles &middot; ${GAME.match.durationSec}s &middot; 1 stock</span>
          <span>${HAS_API ? 'scan &rarr; fight' : 'samples ready'}</span>
        </footer>

        <aside class="legend card" aria-label="How to draw">
          <div class="kicker">How to draw</div>
          <div class="legend-row"><span class="swatch solid"></span><span><b>Black</b> ground</span></div>
          <div class="legend-row"><span class="swatch pass"></span><span><b>Blue</b> pass-through</span></div>
          <div class="legend-row"><span class="swatch hazard"></span><span><b>Red</b> hazard</span></div>
        </aside>
      </div>`);

    const file = el.querySelector('#snap');
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) this.scene.start('Capture', { file: f });
    });
    el.querySelector('[data-act="sample"]').addEventListener('click', () => this.play());
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      this.mode = b.dataset.mode;
      this.registry.set('mode', this.mode);
      el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sfx('ui');
    }));

    this.onKey = (e) => {
      if (!IS_TOUCH) this.armIdle();
      if (e.code === 'Enter') this.play();
    };
    window.addEventListener('keydown', this.onKey);
    this.events.once('shutdown', () => window.removeEventListener('keydown', this.onKey));
  }

  play() {
    sfx('ui');
    this.scene.start('Fight', { stage: this.preview, mode: this.mode });
  }
}
