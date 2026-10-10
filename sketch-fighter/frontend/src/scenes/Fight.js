import Phaser from 'phaser';
import { GAME } from '../config.js';
import { COLOR } from '../theme.js';
import { fitCamera, RENDER_SCALE, VIEW_H, VIEW_W } from '../view.js';
import { IS_TOUCH } from '../shell.js';
import { drawPaper, drawTiles } from '../stage/StageView.js';
import { gridOf, pickSample } from '../stage/stages.js';
import { Fighter, overlaps } from '../fighter/Fighter.js';
import { Controller } from '../controls/input.js';
import { KEYS, KeyboardSource } from '../controls/keyboard.js';
import { GamepadSource } from '../controls/gamepad.js';
import { TouchSource } from '../controls/touch.js';
import { Bot } from '../bot/Bot.js';
import { Hud } from '../hud/Hud.js';
import { sfx, vibrate } from '../audio/sfx.js';

const STEP_MS = 1000 / GAME.physics.fps;
const DT = 1 / GAME.physics.fps;
const MAX_STEPS = 8;
const BZ = GAME.blastZone;
const IDLE = { dir: 0, down: false, jump: false, quick: false, strong: false };
const MAX_ZOOM = IS_TOUCH ? 1.45 : 1.25;

// The match. mode: 'cpu' (you vs the CPU) or 'demo' (CPU vs CPU, attract mode).
export class Fight extends Phaser.Scene {
  constructor() {
    super('Fight');
  }

  init(data) {
    this.mode = data?.mode ?? 'cpu';
    this.stage = data?.stage ?? this.nextDemoStage();
  }

  // Attract mode cycles through recently scanned stages when there are any.
  nextDemoStage(exceptId) {
    const gallery = (this.registry.get('gallery') ?? []).filter((s) => s.id !== exceptId);
    return gallery.length ? gallery[Math.floor(Math.random() * gallery.length)] : pickSample(exceptId);
  }

  create() {
    this.cam = fitCamera(this);
    this.view = { x: VIEW_W / 2, y: VIEW_H / 2, zoom: 1 };
    drawPaper(this);
    drawTiles(this, this.stage.tiles);
    this.grid = gridOf(this.stage);

    const [s1, s2] = this.stage.spawns;
    const face = s1.col <= s2.col ? 1 : -1;
    const demo = this.mode === 'demo';
    this.fighters = [
      new Fighter(this, { id: 'p1', name: demo ? 'CPU 1' : 'P1', color: COLOR.p1, spawn: s1, facing: face }),
      new Fighter(this, { id: 'p2', name: demo ? 'CPU 2' : 'CPU', color: COLOR.p2, spawn: s2, facing: -face }),
    ];
    this.drivers = this.makeDrivers();
    this.fx = this.add.graphics().setDepth(20);
    this.particles = [];

    this.hud = new Hud(this, this.fighters, { onExit: () => this.exit(), hint: this.hint() });
    this.phase = 'intro';
    this.clock = GAME.match.durationSec;
    this.acc = 0;
    this.hitstop = 0;

    this.onKey = (e) => {
      if (e.code === 'Escape') this.exit();
      else if (demo) this.exit();
    };
    window.addEventListener('keydown', this.onKey);
    if (demo) {
      this.onTap = () => this.exit();
      window.addEventListener('pointerdown', this.onTap);
    }
    this.events.once('shutdown', () => this.cleanup());
    // Keep a phone from dimming mid-match (where supported).
    navigator.wakeLock?.request('screen').then((lock) => { this.wakeLock = lock; }).catch(() => {});

    this.hud.showBanner('Ready', 0);
    this.time.delayedCall(demo ? 400 : 900, () => {
      this.hud.showBanner('<span class="accent">Fight</span>', 600);
      sfx('go');
      this.phase = 'fight';
    });
  }

  makeDrivers() {
    const [p1, p2] = this.fighters;
    if (this.mode === 'demo') {
      return [new Bot(p1, p2, this.stage), new Bot(p2, p1, this.stage)].map(botDriver);
    }
    const sources = [new KeyboardSource(KEYS), new GamepadSource(0)];
    if (IS_TOUCH) sources.push(new TouchSource(document.getElementById('touch')));
    return [padDriver(new Controller(sources)), botDriver(new Bot(p2, p1, this.stage))];
  }

  hint() {
    if (IS_TOUCH || this.mode === 'demo') return '';
    return 'A D move &middot; W jump<br/>J quick &middot; K strong &middot; S drop';
  }

  update(_time, delta) {
    delta = Math.min(delta, 100);
    this.drivers.forEach((d) => d.poll());

    if (this.hitstop > 0) {
      this.hitstop -= delta;
    } else {
      this.acc += delta;
      let n = 0;
      while (this.acc >= STEP_MS && n < MAX_STEPS && this.hitstop <= 0) {
        this.simStep();
        this.acc -= STEP_MS;
        n++;
      }
      if (n === MAX_STEPS) this.acc = 0;
      if (this.phase === 'fight') {
        this.clock -= delta / 1000;
        if (this.clock <= 0) this.endMatch('time');
      }
    }

    this.fighters.forEach((f) => f.draw());
    this.updateCamera();
    this.drawFx(delta / 1000);
    this.hud.update(this.fighters, this.clock);
  }

  simStep() {
    const live = this.phase === 'fight' || this.phase === 'ko';
    this.fighters.forEach((f, i) => f.step(live ? this.drivers[i].command(DT) : IDLE, this.grid, DT));

    // Attacks: one hit per attack per target.
    for (const a of this.fighters) {
      const hb = a.hitbox();
      if (!hb) continue;
      for (const t of this.fighters) {
        if (t === a || t.ko || a.attack.hit.has(t.id) || !overlaps(hb, t.hurtbox())) continue;
        a.attack.hit.add(t.id);
        this.onHit(a, t, a.attack.type);
      }
    }

    for (const f of this.fighters) {
      for (const e of f.events) this.onFighterEvent(f, e);
      f.events.length = 0;
      if (!f.ko && outOfBounds(f)) this.knockOut(f);
    }
  }

  onHit(attacker, target, type) {
    const strong = type === 'strong';
    target.takeHit(attacker, type);
    this.hitstop = GAME.combat.hitPauseMs;
    sfx(strong ? 'hitStrong' : 'hit');
    if (strong) this.cam.shake(110, 0.006);
    this.burst((attacker.x + target.x) / 2, target.y - 4, strong ? 14 : 8, strong ? attacker.color : COLOR.line, strong ? 260 : 170);
    if (IS_TOUCH && this.mode === 'cpu') vibrate(strong ? 35 : 15);
  }

  onFighterEvent(f, e) {
    switch (e.type) {
      case 'jump':
        f.squash = 1.18;
        this.dust(f, 4);
        sfx('jump');
        break;
      case 'doublejump':
        f.squash = 1.12;
        this.burst(f.x, f.y + f.body.h / 2, 5, f.color, 90);
        sfx('doublejump');
        break;
      case 'land':
        f.squash = 0.8;
        this.dust(f, 5);
        sfx('land');
        break;
      case 'attack':
        sfx(e.attack === 'strong' ? 'swingStrong' : 'swing');
        break;
      case 'hazard':
        this.burst(f.x, f.y + f.body.h / 2, 10, COLOR.hazard, 200);
        sfx('hazard');
        if (IS_TOUCH && f.id === 'p1') vibrate(25);
        break;
      default:
    }
  }

  knockOut(f) {
    f.ko = true;
    const x = Phaser.Math.Clamp(f.x, 12, VIEW_W - 12);
    const y = Phaser.Math.Clamp(f.y, 12, VIEW_H - 12);
    this.burst(x, y, 26, f.color, 520, 0.9);
    this.ring = { x, y, color: f.color, t: 0 };
    this.cam.shake(260, 0.012);
    sfx('ko');
    if (this.phase === 'fight') {
      this.phase = 'ko';
      this.hud.showBanner('<span class="accent">K.O.</span>', 1100);
      this.time.delayedCall(1300, () => this.endMatch('ko'));
    }
  }

  endMatch(reason) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    const [a, b] = this.fighters;
    let winner = null;
    if (reason === 'ko') winner = a.ko && !b.ko ? b : b.ko && !a.ko ? a : null;
    else winner = a.damage < b.damage ? a : b.damage < a.damage ? b : null;
    if (reason === 'time') this.hud.showBanner('Time', 1000);

    const result = {
      reason,
      winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null,
      fighters: this.fighters.map((f) => ({ id: f.id, name: f.name, damage: Math.round(f.damage), ko: f.ko })),
      stage: this.stage,
      mode: this.mode,
    };
    this.time.delayedCall(reason === 'time' ? 1100 : 300, () => {
      if (this.mode === 'demo') {
        this.scene.restart({ stage: this.nextDemoStage(this.stage.id), mode: 'demo' });
      } else {
        this.scene.launch('Result', result);
        this.scene.pause();
      }
    });
  }

  // Frame both fighters, zooming in when they are close.
  updateCamera() {
    const live = this.fighters.filter((f) => !f.ko && f.x > 0 && f.x < VIEW_W && f.y > 0 && f.y < VIEW_H);
    let zoom = 1;
    let cx = VIEW_W / 2;
    let cy = VIEW_H / 2;
    if (live.length && this.phase !== 'intro') {
      const xs = live.map((f) => f.x);
      const ys = live.map((f) => f.y);
      const minX = Math.min(...xs) - 240;
      const maxX = Math.max(...xs) + 240;
      const minY = Math.min(...ys) - 170;
      const maxY = Math.max(...ys) + 130;
      zoom = Phaser.Math.Clamp(Math.min(VIEW_W / (maxX - minX), VIEW_H / (maxY - minY)), 1, MAX_ZOOM);
      const hw = VIEW_W / (2 * zoom);
      const hh = VIEW_H / (2 * zoom);
      cx = Phaser.Math.Clamp((minX + maxX) / 2, hw, VIEW_W - hw);
      cy = Phaser.Math.Clamp((minY + maxY) / 2, hh, VIEW_H - hh);
    }
    const v = this.view;
    v.zoom += (zoom - v.zoom) * 0.05;
    v.x += (cx - v.x) * 0.08;
    v.y += (cy - v.y) * 0.08;
    this.cam.setZoom(RENDER_SCALE * v.zoom);
    this.cam.centerOn(v.x, v.y);
  }

  dust(f, n) {
    this.burst(f.x, f.y + f.body.h / 2, n, COLOR.line, 70, 0.35, true);
  }

  burst(x, y, n, color, speed, life = 0.45, flat = false) {
    for (let i = 0; i < n; i++) {
      const a = flat ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * (flat ? 0.4 : 1), life, max: life, color, size: 2 + Math.random() * 3 });
    }
  }

  drawFx(dt) {
    const g = this.fx;
    g.clear();
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      g.fillStyle(p.color, p.life / p.max);
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    if (this.ring) {
      const r = this.ring;
      r.t += dt;
      const k = r.t / 0.6;
      if (k >= 1) this.ring = null;
      else {
        g.lineStyle(4 * (1 - k), r.color, 1 - k);
        g.strokeCircle(r.x, r.y, 20 + 140 * k);
      }
    }
    // Off-screen indicators: a bubble at the edge of the view.
    const view = this.cam.worldView;
    const z = this.view.zoom;
    for (const f of this.fighters) {
      if (f.ko || view.contains(f.x, f.y)) continue;
      const m = 26 / z;
      const x = Phaser.Math.Clamp(f.x, view.x + m, view.right - m);
      const y = Phaser.Math.Clamp(f.y, view.y + m, view.bottom - m);
      const ang = Math.atan2(f.y - y, f.x - x);
      g.fillStyle(COLOR.bg, 0.85).fillCircle(x, y, 15 / z);
      g.lineStyle(2 / z, f.color, 1).strokeCircle(x, y, 15 / z);
      g.fillStyle(f.color, 1).fillRect(x - 3 / z, y - 6 / z, 6 / z, 12 / z);
      const tip = 22 / z;
      g.fillTriangle(
        x + Math.cos(ang) * tip, y + Math.sin(ang) * tip,
        x + Math.cos(ang + 0.5) * (tip - 7 / z), y + Math.sin(ang + 0.5) * (tip - 7 / z),
        x + Math.cos(ang - 0.5) * (tip - 7 / z), y + Math.sin(ang - 0.5) * (tip - 7 / z),
      );
    }
  }

  exit() {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.stop('Result');
    this.scene.start('Home');
  }

  cleanup() {
    this.wakeLock?.release().catch(() => {});
    window.removeEventListener('keydown', this.onKey);
    if (this.onTap) window.removeEventListener('pointerdown', this.onTap);
    this.drivers.forEach((d) => d.destroy());
    this.fighters.forEach((f) => f.destroy());
  }
}

function outOfBounds(f) {
  return f.x < -BZ.left || f.x > VIEW_W + BZ.right || f.y < -BZ.top || f.y > VIEW_H + BZ.bottom;
}

function padDriver(ctrl) {
  return { poll: () => ctrl.poll(), command: () => ctrl.command(), destroy: () => ctrl.destroy() };
}

function botDriver(bot) {
  return { poll() {}, command: (dt) => bot.command(dt), destroy() {} };
}
