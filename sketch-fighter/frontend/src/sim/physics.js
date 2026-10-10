// Fighter movement and tile collision, one fixed step at a time.
//
// This is the single definition of how a fighter moves. backend/physics.py is
// a line-for-line port used by the stage analyzer; keep the two in step (the
// parity fixture in shared/fixtures/physics.json, written by
// frontend/scripts/physics-fixture.mjs, is checked by backend tests).
//
// Coordinates are stage-local pixels: (0, 0) is the top-left corner of tile
// (col 0, row 0). A body's (x, y) is the centre of its hitbox. Outside the
// grid everything is empty, so fighters can fall off any edge.

export const EMPTY = 0;
export const SOLID = 1;
export const PASS = 2;
export const HAZARD = 3;
export const FIX = 4;

const EPS = 1e-6;

export const blocks = (code) => code === SOLID || code === HAZARD || code === FIX;

export function tileAt(grid, col, row) {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return EMPTY;
  return grid.tiles[row][col];
}

// A body standing with its feet on the top edge of row `row + 1`, centred on `col`.
export function createBody(game, col, row) {
  const T = game.tileSize;
  const { width: w, height: h } = game.fighter;
  return {
    x: col * T + T / 2,
    y: (row + 1) * T - h / 2,
    vx: 0,
    vy: 0,
    w,
    h,
    onGround: true,
    airJumps: 1,
    coyote: 0,
    jumpBuffer: 0,
    dropTimer: 0,
    hitstun: 0,
    hazard: null, // [col, row] of a hazard tile touched this step
  };
}

// input: { dir: -1 | 0 | 1, down: bool, jump: bool (pressed this step) }
// phys: game.physics (the analyzer passes a copy scaled by validatorPessimism)
export function stepBody(b, input, grid, game, phys, dt) {
  b.hazard = null;
  b.coyote = b.onGround ? phys.coyoteMs / 1000 : Math.max(0, b.coyote - dt);
  b.jumpBuffer = input.jump ? phys.jumpBufferMs / 1000 : Math.max(0, b.jumpBuffer - dt);
  b.dropTimer = input.down ? phys.dropThroughMs / 1000 : Math.max(0, b.dropTimer - dt);

  if (b.hitstun > 0) {
    b.hitstun = Math.max(0, b.hitstun - dt);
    decayX(b, phys, dt, 0);
  } else if (Math.abs(b.vx) > phys.runSpeed) {
    decayX(b, phys, dt, phys.runSpeed);
  } else {
    b.vx = input.dir * phys.runSpeed;
  }

  if (b.hitstun <= 0 && b.jumpBuffer > 0) {
    if (b.onGround || b.coyote > 0) {
      b.vy = -phys.jumpVelocity;
      b.onGround = false;
      b.coyote = 0;
      b.jumpBuffer = 0;
    } else if (b.airJumps > 0) {
      b.vy = -phys.doubleJumpVelocity;
      b.airJumps -= 1;
      b.jumpBuffer = 0;
    }
  }

  integrate(b, grid, game, phys, dt);
}

// Knockback speed bleeds off toward `floor` (0 in hitstun, runSpeed after).
function decayX(b, phys, dt, floor) {
  const speed = Math.abs(b.vx);
  if (speed <= floor) return;
  const next = Math.max(floor, speed - phys.knockbackDecay * dt);
  b.vx = Math.sign(b.vx) * next;
}

// Semi-implicit Euler like Phaser Arcade: velocity first, then position.
// X is moved and resolved before Y. Per step a body moves less than one tile
// (maxLaunchSpeed / fps < tileSize), so at most one tile boundary is crossed.
export function integrate(b, grid, game, phys, dt) {
  const T = game.tileSize;
  b.vy = Math.min(b.vy + phys.gravity * dt, phys.maxFallSpeed);

  b.x += b.vx * dt;
  resolveX(b, grid, T);

  const prevTop = b.y - b.h / 2;
  const prevBottom = b.y + b.h / 2;
  b.y += b.vy * dt;
  resolveY(b, grid, T, prevTop, prevBottom);
}

function resolveX(b, grid, T) {
  if (b.vx === 0) return;
  const r0 = Math.floor((b.y - b.h / 2) / T);
  const r1 = Math.floor((b.y + b.h / 2 - EPS) / T);
  if (b.vx > 0) {
    const c = Math.floor((b.x + b.w / 2 - EPS) / T);
    for (let r = r0; r <= r1; r++) {
      const t = tileAt(grid, c, r);
      if (blocks(t)) {
        b.x = c * T - b.w / 2;
        b.vx = 0;
        if (t === HAZARD) b.hazard = [c, r];
        return;
      }
    }
  } else {
    const c = Math.floor((b.x - b.w / 2) / T);
    for (let r = r0; r <= r1; r++) {
      const t = tileAt(grid, c, r);
      if (blocks(t)) {
        b.x = (c + 1) * T + b.w / 2;
        b.vx = 0;
        if (t === HAZARD) b.hazard = [c, r];
        return;
      }
    }
  }
}

function resolveY(b, grid, T, prevTop, prevBottom) {
  b.onGround = false;
  const c0 = Math.floor((b.x - b.w / 2) / T);
  const c1 = Math.floor((b.x + b.w / 2 - EPS) / T);
  if (b.vy > 0) {
    const r = Math.floor((b.y + b.h / 2 - EPS) / T);
    if (prevBottom > r * T + EPS) return; // already below that row's top
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(grid, c, r);
      if (blocks(t) || (t === PASS && b.dropTimer <= 0)) {
        b.y = r * T - b.h / 2;
        b.vy = 0;
        b.onGround = true;
        b.airJumps = 1;
        if (t === HAZARD) b.hazard = [c, r];
        return;
      }
    }
  } else if (b.vy < 0) {
    const r = Math.floor((b.y - b.h / 2) / T);
    if (prevTop < (r + 1) * T - EPS) return; // already inside that row
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(grid, c, r);
      if (blocks(t)) {
        b.y = (r + 1) * T + b.h / 2;
        b.vy = 0;
        if (t === HAZARD) b.hazard = [c, r];
        return;
      }
    }
  }
}

// True when the body stands only on pass-through tiles (it can drop through).
export function onPassOnly(b, grid, T) {
  if (!b.onGround) return false;
  const r = Math.round((b.y + b.h / 2) / T);
  const c0 = Math.floor((b.x - b.w / 2) / T);
  const c1 = Math.floor((b.x + b.w / 2 - EPS) / T);
  let any = false;
  for (let c = c0; c <= c1; c++) {
    const t = tileAt(grid, c, r);
    if (blocks(t)) return false;
    if (t === PASS) any = true;
  }
  return any;
}
