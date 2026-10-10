import { GAME } from '../config.js';

// Sample stages built by the real pipeline from samples/*.jpg
// (backend/tools/build_sample_stages.py). A flat floor stands in if that file
// is missing or was built for a different grid size.
const built = Object.values(import.meta.glob('@shared/stages/*.json', { eager: true, import: 'default' }))
  .flat()
  .filter((s) => s.cols === GAME.cols && s.rows === GAME.rows);

export const SAMPLE_STAGES = built.length ? built : [flat()];

export const pickSample = (exceptId) => {
  const pool = SAMPLE_STAGES.filter((s) => s.id !== exceptId);
  const list = pool.length ? pool : SAMPLE_STAGES;
  return list[Math.floor(Math.random() * list.length)];
};

// The grid view the physics module reads.
export const gridOf = (stage) => ({ cols: stage.cols, rows: stage.rows, tiles: stage.tiles });

// A plain floor across the middle of the grid, mirrored spawns.
function flat() {
  const { cols, rows } = GAME;
  const tiles = Array.from({ length: rows }, () => Array(cols).fill(0));
  const floor = Math.round(rows * 0.75);
  const c0 = Math.round(cols * 0.2);
  const c1 = cols - 1 - c0;
  for (let c = c0; c <= c1; c++) tiles[floor][c] = 1;
  const inset = Math.round(cols * 0.1);
  return {
    version: 1,
    id: 'sample-flat',
    source: 'sample',
    cols,
    rows,
    tileSize: GAME.tileSize,
    tiles,
    spawns: [{ col: c0 + inset, row: floor - 1 }, { col: c1 - inset, row: floor - 1 }],
    fixes: [],
    navGraph: { nodes: [], edges: [], moves: [] },
    cardDetected: true,
    photoUrl: null,
    timings: {},
    extras: { stageName: 'Margin Notes', announcerLine: 'Pencils down. Fists up.', accentColor: '#a78bfa', source: 'fallback' },
  };
}
