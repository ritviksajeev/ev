import { GAME } from '../config.js';
import { COLOR } from '../theme.js';
import { STAGE_X, STAGE_Y } from '../view.js';

const T = GAME.tileSize;
const PAPER = 24; // px between the faint paper lines

// Draws the faint paper grid and the stage's tiles. Runs of equal tiles on a
// row are merged into one rectangle so there are no seams between tiles.
export function drawPaper(scene) {
  const g = scene.add.graphics();
  const w = GAME.cols * T;
  const h = GAME.rows * T;
  g.lineStyle(1, COLOR.line, 0.03);
  for (let x = PAPER; x < w; x += PAPER) g.lineBetween(STAGE_X + x, STAGE_Y, STAGE_X + x, STAGE_Y + h);
  for (let y = PAPER; y < h; y += PAPER) g.lineBetween(STAGE_X, STAGE_Y + y, STAGE_X + w, STAGE_Y + y);
  g.lineStyle(1, COLOR.line, 0.07);
  g.strokeRect(STAGE_X, STAGE_Y, w, h);
  g.lineStyle(1, COLOR.line, 0.35);
  for (const [x, y] of [[STAGE_X, STAGE_Y], [STAGE_X + w, STAGE_Y], [STAGE_X, STAGE_Y + h], [STAGE_X + w, STAGE_Y + h]]) {
    g.lineBetween(x - 6, y, x + 6, y);
    g.lineBetween(x, y - 6, x, y + 6);
  }
  return g;
}

export function drawTiles(scene, tiles, { alpha = 1 } = {}) {
  const g = scene.add.graphics();
  g.setAlpha(alpha);
  tiles.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const code = row[c];
      let end = c;
      while (end + 1 < row.length && row[end + 1] === code) end++;
      if (code) drawRun(g, code, STAGE_X + c * T, STAGE_Y + r * T, (end - c + 1) * T);
      c = end + 1;
    }
  });
  return g;
}

// One run of equal tiles on a row, drawn at (x, y) in canvas pixels.
export function drawRun(g, code, x, y, w) {
  if (code === 2) {
    g.fillStyle(COLOR.pass, 0.1).fillRect(x, y, w, T);
    g.fillStyle(COLOR.pass, 1).fillRect(x, y, w, Math.min(5, T / 2));
    return;
  }
  if (code === 3) {
    // Spikes 12 px wide whatever the tile size.
    const spike = Math.min(12, T);
    g.fillStyle(COLOR.hazard, 0.22).fillRect(x, y, w, T);
    g.fillStyle(COLOR.hazard, 1);
    for (let sx = x; sx + spike <= x + w + 0.5; sx += spike) g.fillTriangle(sx, y + T, sx + spike / 2, y + T / 4, sx + spike, y + T);
    return;
  }
  g.fillStyle(code === 4 ? COLOR.fix : COLOR.solid, 1).fillRect(x, y, w, T);
}
