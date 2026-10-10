import { GAME } from '../config.js';
import { NavGraph } from './nav.js';

const T = GAME.tileSize;
// Recipe times -> physics steps, rounded exactly as backend/stage_analysis.py does.
const stepOf = (ms) => Math.floor((ms * GAME.physics.fps) / 1000 + 0.5);
// Close enough to a node centre to start a move: just over half a run step.
const ALIGN_PX = (GAME.physics.runSpeed / GAME.physics.fps) * 0.55;

// Easy CPU. Produces the same command a Controller does, once per physics step.
// With a nav graph it paths across the stage and replays the analyzer's
// verified moves; without one it steers straight at the opponent.
export class Bot {
  constructor(self, opponent, stage) {
    this.self = self;
    this.opp = opponent;
    this.stage = stage;
    this.nav = NavGraph.from(stage);
    this.groundCols = groundColumns(stage);
    this.react = 0; // seconds until the next decision about attacking
    this.wantAttack = null;
    this.prevJump = false;
    this.plan = null; // nav edge being executed
    this.hesitate = null; // seconds left before starting a jump or drop
    this.crossing = 0; // direction while jumping a gap (no nav graph)
    this.ledgeWait = null; // seconds left before jumping a gap (no nav graph)
  }

  command(dt) {
    const me = this.self.body;
    const op = this.opp.body;
    const cmd = { dir: 0, down: false, jump: false, quick: false, strong: false };
    if (this.self.ko || me.hitstun > 0) {
      this.prevJump = false;
      this.plan = null;
      this.crossing = 0;
      return cmd;
    }

    const dx = op.x - me.x;
    const dy = op.y - me.y;
    let wantJump = false;
    if (me.onGround) this.crossing = 0;
    this.maybeAttack(cmd, dx, dy, dt);

    if (this.plan) {
      wantJump = this.followPlan(cmd);
    } else if (!me.onGround && !this.crossing && !groundBelow(this.stage, me)) {
      // Airborne with nothing below: head for the nearest ground and spend
      // the double jump once falling.
      cmd.dir = Math.sign(this.nearestGroundX(me.x) - me.x);
      wantJump = me.vy > 60 && me.airJumps > 0;
    } else if (this.crossing) {
      cmd.dir = this.crossing;
      wantJump = me.vy > -60 && me.airJumps > 0;
    } else if (this.nav && me.onGround && !(Math.abs(dx) < 3 * T && Math.abs(dy) < 1.5 * T)) {
      wantJump = this.navigate(cmd, dt);
    } else {
      wantJump = this.approach(cmd, dx, dy, dt);
    }

    // Presses are rising edges, as from a real button.
    cmd.jump = wantJump && !this.prevJump;
    this.prevJump = wantJump;
    return cmd;
  }

  // Walk along the cheapest path toward the opponent's nearest node; for any
  // other edge, line up on the node centre and start its move.
  navigate(cmd, dt) {
    const me = this.self.body;
    const op = this.opp.body;
    const from = this.nav.nodeUnder(me);
    const to = this.nav.nearest(op.x, op.y + op.h / 2 - 1);
    const path = from === null || to === null ? null : this.nav.path(from, to);
    if (!path?.length) return this.approach(cmd, op.x - me.x, op.y - me.y, 0);

    const edge = path[0];
    if (edge.type === 'walk' || !edge.move) {
      cmd.dir = Math.sign(this.nav.x(edge.to) - me.x);
      return false;
    }
    const cx = this.nav.x(from);
    if (Math.abs(me.x - cx) > ALIGN_PX) {
      cmd.dir = Math.sign(cx - me.x);
      return false;
    }
    // Hesitate a moment, and don't leap at a moving target: two CPUs on a
    // mirrored stage would otherwise jump in lockstep and swap sides forever.
    if (this.hesitate === null) this.hesitate = 0.12 + Math.random() * 0.5;
    if ((this.hesitate -= dt) > 0 || !op.onGround || this.self.attack) return false;
    this.hesitate = null;
    this.plan = { edge, move: edge.move, step: 0, airborne: false };
    return this.followPlan(cmd);
  }

  // Replay the move exactly as the analyzer verified it: jump (or press down)
  // on step 0, the second jump on its step, no direction before holdFromMs, then
  // steer onto the target node's centre and stop within 3 px.
  followPlan(cmd) {
    const p = this.plan;
    const m = p.move;
    const me = this.self.body;
    const s = p.step++;
    let wantJump = false;

    if (s === 0 && (m.type === 'jump' || m.type === 'double_jump')) wantJump = true;
    if (s === 0 && m.type === 'drop') cmd.down = true;
    if (m.type === 'double_jump' && m.doubleJumpAtMs != null && s === stepOf(m.doubleJumpAtMs)) wantJump = true;
    if (s >= stepOf(m.holdFromMs)) {
      const dx = this.nav.x(p.edge.to) - me.x;
      cmd.dir = Math.abs(dx) > 3 ? Math.sign(dx) : 0;
    }
    // Done once it has left the ground and landed again (a walk-off can take a
    // while to reach the edge); give up if it never gets airborne.
    if (!me.onGround) p.airborne = true;
    const fps = GAME.physics.fps;
    if ((p.airborne && me.onGround) || (!p.airborne && s > fps) || s > 3 * fps) this.plan = null;
    return wantJump;
  }

  // Straight-line approach (close range, or no nav graph).
  approach(cmd, dx, dy, dt) {
    const me = this.self.body;
    const op = this.opp.body;
    let wantJump = false;
    // Leave a little gap so it doesn't feel relentless.
    if (Math.abs(dx) > 26) cmd.dir = Math.sign(dx);
    else cmd.face = Math.sign(dx);

    // Opponent standing above: jump up; below on a pass-through: drop.
    // (Following an airborne opponent just makes both hop forever.)
    if (dy < -2 * T && Math.abs(dx) < 4 * T && me.onGround && op.onGround) wantJump = true;
    else if (dy > 2 * T && Math.abs(dx) < 3 * T) cmd.down = true;

    // At a ledge: wait a moment (the opponent may come over), then jump the
    // gap if the opponent is standing on the other side.
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
    return wantJump;
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
        if (Math.abs(dx) > 1) cmd.face = Math.sign(dx);
        this.wantAttack = null;
        this.react = 0.35 + Math.random() * 0.4;
      }
    } else if (!inRange) {
      this.wantAttack = null;
    }
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
