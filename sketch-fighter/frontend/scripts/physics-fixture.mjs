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

// A test grid exercising every tile type and collision direction.
const cols = game.cols;
const rows = game.rows;
const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
const fill = (code, row, c0, c1) => { for (let c = c0; c <= c1; c++) tiles[row][c] = code; };
fill(1, 20, 5, 34);            // floor
fill(1, 21, 5, 34);
fill(2, 16, 10, 16);           // pass-through platform, 4 tiles up
for (let r = 17; r <= 19; r++) tiles[r][25] = 1; // wall
fill(1, 15, 19, 22);           // low ceiling over col 20-21
fill(3, 19, 30, 31);           // hazard on the floor
fill(4, 17, 3, 4);             // fix tile ledge off the left edge
const grid = { cols, rows, tiles };

// Each segment: [steps, dir, down, jumpOnFirstStep]
const SCENARIOS = [
  { name: 'stand', start: [8, 19], segs: [[30, 0, false, false]] },
  { name: 'jump_up', start: [8, 19], segs: [[1, 0, false, true], [140, 0, false, false]] },
  { name: 'run_into_wall', start: [20, 19], segs: [[90, 1, false, false]] },
  { name: 'double_jump_right', start: [6, 19], segs: [[1, 1, false, true], [40, 1, false, false], [1, 1, false, true], [160, 1, false, false]] },
  { name: 'walk_off_left_ledge', start: [6, 19], segs: [[200, -1, false, false]] },
  { name: 'jump_onto_pass', start: [13, 19], segs: [[1, 0, false, true], [120, 0, false, false]] },
  { name: 'drop_through_pass', start: [13, 15], segs: [[1, 0, true, false], [120, 0, false, false]] },
  { name: 'bonk_ceiling', start: [20, 19], segs: [[1, 0, false, true], [80, 0, false, false]] },
  { name: 'touch_hazard', start: [27, 19], segs: [[60, 1, false, false]] },
  { name: 'coyote_jump', start: [33, 19], segs: [[24, 1, false, false], [1, 1, false, true], [100, 1, false, false]] },
  { name: 'knockback', start: [15, 19], kick: { vx: -1300, vy: -900, hitstun: 0.4 }, segs: [[220, 1, false, false]] },
];

const scenarios = SCENARIOS.map(({ name, start, segs, kick }) => {
  const b = createBody(game, start[0], start[1]);
  if (kick) Object.assign(b, { vx: kick.vx, vy: kick.vy, hitstun: kick.hitstun, onGround: false });
  const inputs = [];
  const frames = [];
  for (const [steps, dir, down, jump] of segs) {
    for (let i = 0; i < steps; i++) {
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
