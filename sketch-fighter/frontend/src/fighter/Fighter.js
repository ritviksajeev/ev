import { GAME } from '../config.js';
import { COLOR } from '../theme.js';
import { STAGE_X, STAGE_Y } from '../view.js';
import { createBody, stepBody } from '../sim/physics.js';

const C = GAME.combat;
const P = GAME.physics;

// One fighter: a physics body (sim/physics.js) plus attacks, damage and drawing.
// Positions are stage-local; drawing adds the stage offset.
export class Fighter {
  constructor(scene, { id, name, color, spawn, facing }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.body = createBody(GAME, spawn.col, spawn.row);
    this.facing = facing;
    this.damage = 0;
    this.attack = null;
    this.ko = false;
    this.hazardCooldown = 0;
    this.flash = 0;
    this.squash = 1;
    this.events = [];
    this.g = scene.add.graphics().setDepth(10);
  }

  get x() { return STAGE_X + this.body.x; }
  get y() { return STAGE_Y + this.body.y; }

  // One physics step. cmd: { dir, down, jump, quick, strong, face? } from a
  // Controller or the CPU (face turns without moving).
  step(cmd, grid, dt) {
    if (this.ko) return;
    const b = this.body;
    this.hazardCooldown = Math.max(0, this.hazardCooldown - dt);
    this.flash = Math.max(0, this.flash - dt);

    if (this.attack) {
      this.attack.t += dt * 1000;
      if (this.attack.t >= this.attack.total) this.attack = null;
    }
    const free = b.hitstun <= 0 && !this.attack;
    if (free && (cmd.quick || cmd.strong)) this.startAttack(cmd.strong ? 'strong' : 'quick');
    if (free && (cmd.dir || cmd.face)) this.facing = cmd.dir || cmd.face;

    // Ground attacks plant your feet; in the air you keep control.
    const rooted = this.attack && b.onGround;
    const wasGround = b.onGround;
    const vy0 = b.vy;
    stepBody(b, { dir: rooted ? 0 : cmd.dir, down: cmd.down, jump: rooted ? false : cmd.jump }, grid, GAME, P, dt);

    if (!wasGround && b.onGround && vy0 > 200) this.emit('land');
    if (b.vy < -P.doubleJumpVelocity + 20 && vy0 > b.vy + 100) this.emit(wasGround ? 'jump' : 'doublejump');
    if (b.hazard && this.hazardCooldown <= 0) this.hitByHazard(b.hazard);
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  startAttack(type) {
    const a = C.attacks[type];
    this.attack = { type, t: 0, total: a.startupMs + a.activeMs + a.recoveryMs, hit: new Set() };
    this.emit('attack', { attack: type });
  }

  // The live hitbox in stage-local coordinates, or null outside the active window.
  hitbox() {
    if (!this.attack) return null;
    const a = C.attacks[this.attack.type];
    const t = this.attack.t;
    if (t < a.startupMs || t >= a.startupMs + a.activeMs) return null;
    const hb = a.hitbox;
    return {
      x: this.body.x + this.facing * hb.offsetX - hb.width / 2,
      y: this.body.y + hb.offsetY - hb.height / 2,
      w: hb.width,
      h: hb.height,
    };
  }

  hurtbox() {
    const b = this.body;
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }

  // Launch speed = base + growth x damage after the hit, away from the attacker.
  takeHit(attacker, type) {
    const a = C.attacks[type];
    const b = this.body;
    this.damage += a.damage;
    const speed = Math.min(a.baseKnockback + a.growth * this.damage, P.maxLaunchSpeed);
    const away = Math.sign(b.x - attacker.body.x) || attacker.facing;
    const angle = (a.angleDeg * Math.PI) / 180;
    b.vx = Math.cos(angle) * speed * away;
    b.vy = -Math.sin(angle) * speed;
    b.hitstun = Math.min(speed * C.hitstunMsPerSpeed, C.maxHitstunMs) / 1000;
    b.onGround = false;
    b.airJumps = 1;
    this.attack = null;
    this.facing = -away;
    this.flash = 0.12;
    return speed;
  }

  hitByHazard([col]) {
    const h = C.hazard;
    const b = this.body;
    const hazardX = (col + 0.5) * GAME.tileSize;
    this.damage += h.damage;
    b.vx = (Math.sign(b.x - hazardX) || -this.facing) * h.knockback * 0.45;
    b.vy = -h.knockback;
    b.hitstun = 0.18;
    b.onGround = false;
    b.airJumps = 1;
    this.attack = null;
    this.hazardCooldown = h.cooldownMs / 1000;
    this.flash = 0.12;
    this.emit('hazard');
  }

  draw() {
    const g = this.g;
    g.clear();
    if (this.ko) return;
    const b = this.body;
    this.squash += (1 - this.squash) * 0.25;
    const sy = this.squash;
    const sx = 1 / sy;
    const w = b.w * sx;
    const h = b.h * sy;
    const left = this.x - w / 2;
    const top = this.y + b.h / 2 - h;

    // Attack: charge glint during startup, a swipe while active.
    if (this.attack) {
      const a = C.attacks[this.attack.type];
      const t = this.attack.t;
      const hb = this.hitbox();
      if (t < a.startupMs) {
        const k = t / a.startupMs;
        g.fillStyle(this.attack.type === 'strong' ? this.color : COLOR.line, 0.25 + 0.5 * k);
        g.fillCircle(this.x + this.facing * 12, this.y - 4, 2 + 4 * k);
      } else if (hb) {
        const strong = this.attack.type === 'strong';
        g.fillStyle(strong ? this.color : COLOR.line, strong ? 0.85 : 0.75);
        g.fillRoundedRect(STAGE_X + hb.x, STAGE_Y + hb.y + hb.h * 0.25, hb.w, hb.h * 0.5, hb.h * 0.25);
        g.lineStyle(2, COLOR.line, 0.5);
        g.strokeRoundedRect(STAGE_X + hb.x, STAGE_Y + hb.y, hb.w, hb.h, 6);
      }
    }

    const stunned = b.hitstun > 0;
    g.fillStyle(this.flash > 0 ? COLOR.line : this.color, 1);
    g.fillRoundedRect(left, top, w, h, 5);
    // Visor shows which way the fighter faces.
    g.fillStyle(COLOR.bg, stunned ? 0.5 : 1);
    g.fillRect(this.x + this.facing * 2 - 5, top + 7 * sy, 10, 4);
    if (stunned) {
      g.lineStyle(1.5, COLOR.line, 0.6);
      g.strokeRoundedRect(left - 2, top - 2, w + 4, h + 4, 6);
    }
  }

  destroy() {
    this.g.destroy();
  }
}

export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
