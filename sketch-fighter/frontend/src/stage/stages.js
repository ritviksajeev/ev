import { GAME } from '../config.js';

// Sample stages built by the real pipeline from samples/*.jpg
// (backend/tools/build_sample_stages.py). Until that file exists the two
// hand-made stages below stand in for it.
const built = Object.values(import.meta.glob('@shared/stages/*.json', { eager: true, import: 'default' })).flat();

export const SAMPLE_STAGES = built.length ? built : [handmade('sample-a', classic()), handmade('sample-b', towers())];

export const pickSample = (exceptId) => {
  const pool = SAMPLE_STAGES.filter((s) => s.id !== exceptId);
  const list = pool.length ? pool : SAMPLE_STAGES;
  return list[Math.floor(Math.random() * list.length)];
};

// The grid view the physics module reads.
export const gridOf = (stage) => ({ cols: stage.cols, rows: stage.rows, tiles: stage.tiles });

function blank() {
  return Array.from({ length: GAME.rows }, () => Array(GAME.cols).fill(0));
}

function put(t, code, row, c0, c1) {
  for (let c = c0; c <= c1; c++) t[row][c] = code;
}

function classic() {
  const t = blank();
  put(t, 1, 18, 8, 31);
  put(t, 1, 19, 9, 30);
  put(t, 2, 14, 11, 15);
  put(t, 2, 14, 24, 28);
  put(t, 2, 10, 17, 22);
  return { tiles: t, spawns: [{ col: 12, row: 17 }, { col: 27, row: 17 }], name: 'Margin Notes' };
}

function towers() {
  const t = blank();
  put(t, 1, 16, 5, 14);
  put(t, 1, 17, 5, 14);
  put(t, 1, 16, 25, 34);
  put(t, 1, 17, 25, 34);
  put(t, 2, 12, 15, 24);
  put(t, 3, 22, 13, 26);
  put(t, 4, 9, 8, 10);
  put(t, 4, 9, 29, 31);
  return { tiles: t, spawns: [{ col: 9, row: 15 }, { col: 30, row: 15 }], name: 'Two Desks' };
}

function handmade(id, { tiles, spawns, name }) {
  return {
    version: 1,
    id,
    source: 'sample',
    cols: GAME.cols,
    rows: GAME.rows,
    tileSize: GAME.tileSize,
    tiles,
    spawns,
    fixes: [],
    navGraph: { nodes: [], edges: [], moves: [] },
    cardDetected: true,
    photoUrl: null,
    timings: {},
    extras: { stageName: name, announcerLine: 'Pencils down. Fists up.', accentColor: '#a78bfa', source: 'fallback' },
  };
}
