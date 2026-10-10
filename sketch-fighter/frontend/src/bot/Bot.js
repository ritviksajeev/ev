import { GAME } from '../config.js';

const T = GAME.tileSize;

// Easy CPU. Produces the same command a Controller does, once per physics step,
// by steering toward the opponent.
export class Bot {
  constructor(self, opponent, stage) {
    this.self = self;
    this.opp = opponent;
    this.stage = stage;
    this.react = 0; // seconds until the next decision about attacking
    this.wantAttack = null;
    this.prevJump = false;
    this.crossing = 0; // direction while jumping a gap
    this.ledgeWait = null; // seconds left before jumping a gap
    this.groundCols = groundColumns(stage);
  }

  command(dt) {
    const me = this.self.body;
    const op = this.opp.body;
    const cmd = { dir: 0, down: false, jump: false, quick: false, strong: false };
    if (this.self.ko || me.hitstun > 0) {
      this.prevJump = false;
      return cmd;
    }

    const dx = op.x - me.x;
    const dy = op.y - me.y;
    let wantJump = false;
    if (me.onGround) this.crossing = 0;

    // Airborne with nothing to land on below: head for the nearest ground and
    // spend the double jump once falling.
    if (!me.onGround && !this.crossing && !groundBelow(this.stage, me)) {
      cmd.dir = Math.sign(this.nearestGroundX(me.x) - me.x);
      wantJump = me.vy > 60 && me.airJumps > 0;
    } else if (this.crossing) {
      // Mid-jump over a gap: keep going, double-jump near the top, swing if close.
      cmd.dir = this.crossing;
      wantJump = me.vy > -60 && me.airJumps > 0;
      this.maybeAttack(cmd, dx, dy, dt);
    } else {
      this.maybeAttack(cmd, dx, dy, dt);
      // Leave a little gap so it doesn't feel relentless.
      if (Math.abs(dx) > 26) cmd.dir = Math.sign(dx);
      else cmd.face = Math.sign(dx);
      // Opponent standing above: jump up; below on a pass-through: drop.
      // (Following an airborne opponent just makes both hop forever.)
      if (dy < -2 * T && Math.abs(dx) < 4 * T && me.onGround && op.onGround) wantJump = true;
      else if (dy > 2 * T && Math.abs(dx) < 3 * T) cmd.down = true;

      // At a ledge: wait a moment (the opponent may come over), then jump
      // the gap if the opponent is standing on the other side.
      if (me.onGround && cmd.dir && !groundAhead(this.stage, me, cmd.dir)) {
        const across = Math.sign(dx) === cmd.dir && dy < 2 * T && op.onGround;
        if (across && this.ledgeWait === null) this.ledgeWait = 0.3 + Math.random();
        if (across && (this.ledgeWait -= dt) <= 0) {
          wantJump = true;
          this.crossing = cmd.dir;
          this.ledgeWait = null;
        } else {
          cmd.dir = 0;
        }
      } else {
        this.ledgeWait = null;
      }
    }

    // Presses are rising edges, as from a real button.
    cmd.jump = wantJump && !this.prevJump;
    this.prevJump = wantJump;
    return cmd;
  }

  nearestGroundX(x) {
    let best = x;
    let bestD = Infinity;
    for (const c of this.groundCols) {
      const cx = (c + 0.5) * T;
      if (Math.abs(cx - x) < bestD) {
        bestD = Math.abs(cx - x);
        best = cx;
      }
    }
    return best;
  }

  // Attack when in range, after a human-ish reaction delay.
  maybeAttack(cmd, dx, dy, dt) {
    this.react -= dt;
    const inRange = Math.abs(dx) < 34 && Math.abs(dy) < 30;
    if (inRange && !this.self.attack) {
      if (this.wantAttack === null) {
        this.wantAttack = Math.random() < 0.3 ? 'strong' : 'quick';
        this.react = 0.28 + Math.random() * 0.32;
      } else if (this.react <= 0) {
        cmd[this.wantAttack] = true;
        this.wantAttack = null;
        this.react = 0.35 + Math.random() * 0.4;
      }
    } else if (!inRange) {
      this.wantAttack = null;
    }
  }
}

const isGround = (code) => code === 1 || code === 2 || code === 4;

function groundColumns(stage) {
  const cols = [];
  for (let c = 0; c < stage.cols; c++) {
    if (stage.tiles.some((row) => isGround(row[c]))) cols.push(c);
  }
  return cols;
}

// Any ground under the body's columns, from its feet to the bottom of the grid.
function groundBelow(stage, body) {
  const c0 = Math.floor((body.x - body.w / 2) / T);
  const c1 = Math.floor((body.x + body.w / 2) / T);
  const r0 = Math.max(0, Math.floor((body.y + body.h / 2) / T));
  for (let r = r0; r < stage.rows; r++) {
    for (let c = c0; c <= c1; c++) if (isGround(stage.tiles[r]?.[c])) return true;
  }
  return false;
}

function groundAhead(stage, body, dir) {
  const col = Math.floor((body.x + dir * (body.w / 2 + 6)) / T);
  const row = Math.round((body.y + body.h / 2) / T);
  for (let r = row; r < Math.min(stage.rows, row + 3); r++) {
    if (isGround(stage.tiles[r]?.[col])) return true;
  }
  return false;
}
