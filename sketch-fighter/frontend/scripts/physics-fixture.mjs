// Records reference trajectories from src/sim/physics.js into
// shared/fixtures/physics.json. backend/tests/test_physics.py replays the same
// inputs through backend/physics.py and must match to 1e-9.
//   node frontend/scripts/physics-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBody, stepBody } from '../src/sim/physics.js';

const shared = (p) => fileURLToPath(new URL(`../../shared/${p}`, import.meta.url));
const game = JSON.parse(readFileSync(shared('game.json'), 'utf8'));
const dt = 1 / game.physics.fps;
const T = game.tileSize;

// The layout is described in 24 px units so it means the same thing at any
// tile size; u(n) is the tile index n units in.
const u = (n) => Math.round((n * 24) / T);
const span = (n) => Math.max(1, u(n)); // a thickness of n units, at least one tile
const steps = (s) => Math.round(s * game.physics.fps); // seconds -> physics steps

const cols = game.cols;
const rows = game.rows;
const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
const fill = (code, r0, r1, c0, c1) => {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles[r][c] = code;
};
const floorTop = u(20);
fill(1, floorTop, floorTop + span(2) - 1, u(5), u(35) - 1); // floor
fill(2, u(16), u(16), u(10), u(17) - 1); // pass-through platform, 4 units up
fill(1, u(17), floorTop - 1, u(25), u(26) - 1); // wall
fill(1, u(15), u(16) - 1, u(19), u(23) - 1); // low ceiling over the wall's left
fill(3, floorTop - span(1), floorTop - 1, u(30), u(32) - 1); // hazard on the floor
fill(4, u(17), u(18) - 1, u(3), u(5) - 1); // fix-tile ledge off the left edge
// Up high, away from the other scenarios: a platform with a one-tile
// staircase going up to the right and back down (a drawn slope).
const upper = u(6);
fill(1, upper, upper + span(2) - 1, u(5), u(35) - 1);
const stairs = u(10);
for (let i = 0; i < 4; i++) fill(1, upper - 1 - i, upper - 1 - i, stairs + 2 * i, stairs + 2 * i + 1);
for (let i = 0; i < 3; i++) fill(1, upper - 3 + i, upper - 3 + i, stairs + 8 + 2 * i, stairs + 9 + 2 * i);
// A pass-through tile at foot level on the floor, to walk up onto.
fill(2, floorTop - 1, floorTop - 1, u(14), u(14) + 1);
const grid = { cols, rows, tiles };

// Start tiles in units (feet on the floor = row floorTop - 1). Segments: [seconds, dir, down, jump on first step].
const feet = floorTop - 1;
const SCENARIOS = [
  { name: 'stand', start: [u(8), feet], segs: [[0.25, 0, false, false]] },
  { name: 'jump_up', start: [u(8), feet], segs: [[0, 0, false, true], [1.2, 0, false, false]] },
  { name: 'run_into_wall', start: [u(20), feet], segs: [[0.75, 1, false, false]] },
  { name: 'double_jump_right', start: [u(17), feet], segs: [[0, 1, false, true], [0.33, 1, false, false], [0, 1, false, true], [1.33, 1, false, false]] },
  { name: 'walk_off_left_ledge', start: [u(6), feet], segs: [[1.7, -1, false, false]] },
  { name: 'jump_onto_pass', start: [u(13), feet], segs: [[0, 0, false, true], [1.0, 0, false, false]] },
  { name: 'drop_through_pass', start: [u(13), u(16) - 1], segs: [[0, 0, true, false], [1.0, 0, false, false]] },
  { name: 'bonk_ceiling', start: [u(20), feet], segs: [[0, 0, false, true], [0.67, 0, false, false]] },
  { name: 'touch_hazard', start: [u(27), feet], segs: [[0.5, 1, false, false]] },
  { name: 'coyote_jump', start: [u(33), feet], segs: [[0.2, 1, false, false], [0, 1, false, true], [0.83, 1, false, false]] },
  { name: 'knockback', start: [u(15), feet], kick: { vx: -1300, vy: -900, hitstun: 0.4 }, segs: [[1.8, 1, false, false]] },
  { name: 'walk_up_and_down_stairs', start: [stairs - 2, upper - 1], segs: [[1.6, 1, false, false]] },
  { name: 'walk_down_stairs_left', start: [stairs + 16, upper - 1], segs: [[1.0, -1, false, false]] },
  { name: 'walk_onto_pass_step', start: [u(12), feet], segs: [[0.6, 1, false, false]] },
];

const scenarios = SCENARIOS.map(({ name, start, segs, kick }) => {
  const b = createBody(game, start[0], start[1]);
  if (kick) Object.assign(b, { vx: kick.vx, vy: kick.vy, hitstun: kick.hitstun, onGround: false });
  const inputs = [];
  const frames = [];
  for (const [seconds, dir, down, jump] of segs) {
    const n = Math.max(1, steps(seconds));
    for (let i = 0; i < n; i++) {
      const input = { dir, down, jump: jump && i === 0 };
      stepBody(b, input, grid, game, game.physics, dt);
      inputs.push([input.dir, input.down ? 1 : 0, input.jump ? 1 : 0]);
      frames.push([b.x, b.y, b.vx, b.vy, b.onGround ? 1 : 0, b.airJumps, b.hazard]);
    }
  }
  return { name, start, kick: kick ?? null, inputs, frames };
});

writeFileSync(shared('fixtures/physics.json'), JSON.stringify({ grid, scenarios }) + '\n');
console.log(`wrote ${scenarios.length} scenarios`);
