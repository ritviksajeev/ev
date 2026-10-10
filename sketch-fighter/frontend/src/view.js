import { GAME } from './config.js';

// The game world is always 1280 x 720 logical pixels. The canvas backing store
// is larger on high-DPI screens so tiles and text stay sharp, and every
// scene's camera zooms by the same factor to show exactly the logical area.
export const VIEW_W = GAME.canvas.width;
export const VIEW_H = GAME.canvas.height;
export const RENDER_SCALE = renderScale();

function renderScale() {
  const dpr = window.devicePixelRatio || 1;
  const long = Math.max(window.screen.width, window.screen.height);
  const short = Math.min(window.screen.width, window.screen.height);
  const fit = Math.min(long / VIEW_W, short / VIEW_H);
  return Math.min(2, Math.max(1, Math.ceil(dpr * fit * 4) / 4));
}

export function fitCamera(scene) {
  const cam = scene.cameras.main;
  cam.setZoom(RENDER_SCALE);
  cam.centerOn(VIEW_W / 2, VIEW_H / 2);
  return cam;
}

// Top-left corner of the stage grid inside the canvas.
export const STAGE_X = (VIEW_W - GAME.cols * GAME.tileSize) / 2;
export const STAGE_Y = (VIEW_H - GAME.rows * GAME.tileSize) / 2;
