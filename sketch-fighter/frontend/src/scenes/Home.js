import Phaser from 'phaser';
import { GAME } from '../config.js';
import { COLOR } from '../theme.js';
import { mount } from '../ui/overlay.js';
import { fitCamera, STAGE_X, STAGE_Y } from '../view.js';

const T = GAME.tileSize;
const P = GAME.physics;

// Phase 0 placeholder layout, drawn on the right half of the stage area.
const DEMO = [
  { code: 1, row: 19, from: 22, to: 37 },
  { code: 1, row: 20, from: 22, to: 37 },
  { code: 2, row: 14, from: 25, to: 29 },
  { code: 4, row: 16, from: 35, to: 36 },
  { code: 3, row: 9, from: 32, to: 34 },
];

export class Home extends Phaser.Scene {
  constructor() {
    super('Home');
  }

  create() {
    fitCamera(this);
    this.drawStageFrame();
    this.drawDemoTiles();
    this.spawnDemoFighter();
    this.mountUi();
  }

  drawStageFrame() {
    const g = this.add.graphics();
    const w = GAME.cols * T;
    const h = GAME.rows * T;
    g.lineStyle(1, COLOR.line, 0.035);
    for (let c = 1; c < GAME.cols; c++) g.lineBetween(STAGE_X + c * T, STAGE_Y, STAGE_X + c * T, STAGE_Y + h);
    for (let r = 1; r < GAME.rows; r++) g.lineBetween(STAGE_X, STAGE_Y + r * T, STAGE_X + w, STAGE_Y + r * T);
    g.lineStyle(1, COLOR.line, 0.08);
    g.strokeRect(STAGE_X, STAGE_Y, w, h);
    // crosshair marks on the corners
    g.lineStyle(1, COLOR.line, 0.4);
    for (const [x, y] of [[STAGE_X, STAGE_Y], [STAGE_X + w, STAGE_Y], [STAGE_X, STAGE_Y + h], [STAGE_X + w, STAGE_Y + h]]) {
      g.lineBetween(x - 6, y, x + 6, y);
      g.lineBetween(x, y - 6, x, y + 6);
    }
  }

  drawDemoTiles() {
    const g = this.add.graphics();
    for (const { code, row, from, to } of DEMO) {
      for (let col = from; col <= to; col++) {
        const x = STAGE_X + col * T;
        const y = STAGE_Y + row * T;
        if (code === 2) {
          g.fillStyle(COLOR.pass, 0.12).fillRect(x, y, T, T);
          g.fillStyle(COLOR.pass, 1).fillRect(x, y, T, 5);
        } else {
          const color = { 1: COLOR.solid, 3: COLOR.hazard, 4: COLOR.fix }[code];
          g.fillStyle(color, 1).fillRect(x, y, T, T);
        }
      }
    }

    // Jump and double-jump apex guides, computed from game.json.
    const floorTop = STAGE_Y + 19 * T;
    const h1 = P.jumpVelocity ** 2 / (2 * P.gravity);
    const h2 = P.doubleJumpVelocity ** 2 / (2 * P.gravity);
    this.dashed(g, floorTop - h1, STAGE_X + 22 * T, STAGE_X + 38 * T, COLOR.p1, 0.35);
    this.dashed(g, floorTop - h1 - h2, STAGE_X + 22 * T, STAGE_X + 38 * T, COLOR.p1, 0.2);

    // One static body per run; the blue platform only collides from above.
    this.platforms = DEMO.map(({ code, row, from, to }) => {
      const zone = this.add.zone(STAGE_X + from * T, STAGE_Y + row * T, (to - from + 1) * T, T).setOrigin(0);
      this.physics.add.existing(zone, true);
      if (code === 2) Object.assign(zone.body.checkCollision, { down: false, left: false, right: false });
      return zone;
    });
  }

  dashed(g, y, x0, x1, color, alpha) {
    g.lineStyle(1, color, alpha);
    for (let x = x0; x < x1; x += 10) g.lineBetween(x, y, Math.min(x + 5, x1), y);
  }

  spawnDemoFighter() {
    const { width, height } = GAME.fighter;
    const body = this.add.rectangle(STAGE_X + 30 * T, STAGE_Y + 19 * T - height / 2, width, height, COLOR.p1);
    const eye = this.add.rectangle(0, 0, 4, 4, COLOR.bg);
    this.physics.add.existing(body);
    this.physics.add.collider(body, this.platforms);
    this.fighter = { body, eye, dir: 1, jumps: 0, airJumps: 0, nextJumpAt: this.time.now + 600 };
  }

  update(time) {
    const f = this.fighter;
    const b = f.body.body;
    const left = STAGE_X + 23 * T;
    const right = STAGE_X + 37 * T;
    if (f.body.x < left) f.dir = 1;
    if (f.body.x > right) f.dir = -1;
    b.setVelocityX(f.dir * P.runSpeed);

    if (b.blocked.down) {
      f.airJumps = 0;
      if (time > f.nextJumpAt) {
        b.setVelocityY(-P.jumpVelocity);
        f.jumps++;
        f.nextJumpAt = time + 1300;
      }
    } else if (f.jumps % 2 === 0 && f.airJumps === 0 && b.velocity.y >= 0) {
      b.setVelocityY(-P.doubleJumpVelocity);
      f.airJumps = 1;
    }
    b.velocity.y = Math.min(b.velocity.y, P.maxFallSpeed);

    f.eye.setPosition(f.body.x + f.dir * 4, f.body.y - 9);
  }

  mountUi() {
    const server = this.registry.get('server') ?? { online: false };
    const chip = !server.online
      ? { state: 'off', text: 'api offline' }
      : server.inSync
        ? { state: 'ok', text: 'api online' }
        : { state: 'warn', text: 'config out of date' };
    const apexTiles = (P.jumpVelocity ** 2 / (2 * P.gravity) / T).toFixed(1);

    mount(this, `
      <div class="screen">
        <header class="bar">
          <div class="brand">sketch fighter</div>
          <div class="chip" data-state="${chip.state}"><i></i><span>${chip.text}</span></div>
        </header>

        <main class="home-main">
          <div class="kicker">( Draw it. Snap it. Fight on it. )</div>
          <h1 class="display home-title">Sketch<br/><span class="accent">Fighter</span></h1>
          <div class="home-actions">
            <button class="btn" disabled>Snap a stage <span class="arrow">&rarr;</span></button>
            <button class="btn ghost" disabled>Play a sample stage</button>
          </div>
        </main>

        <footer class="bar bottom">
          <span><span class="bracket">[</span> Phase 0 <span class="bracket">]</span> Skeleton</span>
          <span>g ${P.gravity} &middot; jump ${P.jumpVelocity} &middot; apex ${apexTiles} tiles</span>
          <span>game.json ${server.inSync ? 'in sync' : '&mdash;'}</span>
        </footer>

        <aside class="legend card" aria-label="How to draw">
          <div class="kicker">How to draw</div>
          <div class="legend-row"><span class="swatch solid"></span><span><b>Black</b> ground</span></div>
          <div class="legend-row"><span class="swatch pass"></span><span><b>Blue</b> pass-through</span></div>
          <div class="legend-row"><span class="swatch hazard"></span><span><b>Red</b> hazard</span></div>
        </aside>
      </div>
    `);
  }
}
