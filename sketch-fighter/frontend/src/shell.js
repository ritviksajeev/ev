// The app is always laid out as a landscape box. When the screen is portrait
// (phone held upright, or rotation lock on) the box is rotated 90 degrees so
// the game still plays sideways. Everything that reads pointer positions goes
// through toLocal(), and UI CSS uses container units (cqw/cqh) of #app rather
// than vw/vh, so nothing else needs to know about the rotation.

import { VIEW_H, VIEW_W } from './view.js';

const app = document.getElementById('app');
const listeners = new Set();

export const shell = {
  rotated: false,
  vw: 0, // screen (viewport) size
  vh: 0,
  w: 0, // landscape app size
  h: 0,
  canvas: { x: 0, y: 0, w: 0, h: 0, scale: 1 },
};

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function layout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rotated = vh > vw;
  const w = rotated ? vh : vw;
  const h = rotated ? vw : vh;
  const scale = Math.min(w / VIEW_W, h / VIEW_H);
  const cw = VIEW_W * scale;
  const ch = VIEW_H * scale;

  Object.assign(shell, { rotated, vw, vh, w, h, canvas: { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch, scale } });

  app.classList.toggle('is-rotated', rotated);
  app.style.width = `${w}px`;
  app.style.height = `${h}px`;
  app.style.transform = rotated ? `translateX(${vw}px) rotate(90deg)` : 'none';
  const s = app.style;
  s.setProperty('--cx', `${shell.canvas.x}px`);
  s.setProperty('--cy', `${shell.canvas.y}px`);
  s.setProperty('--cw', `${cw}px`);
  s.setProperty('--ch', `${ch}px`);
  s.setProperty('--s', scale);
  listeners.forEach((fn) => fn(shell));
}

export const onLayout = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Screen (client) coordinates -> coordinates inside the landscape #app box.
export function toLocal(clientX, clientY) {
  return shell.rotated ? { x: clientY, y: shell.vw - clientX } : { x: clientX, y: clientY };
}

let pending = 0;
function scheduleLayout() {
  cancelAnimationFrame(pending);
  // iOS reports the new size a frame or two after the rotation event.
  pending = requestAnimationFrame(() => requestAnimationFrame(layout));
}

export function initShell() {
  layout();
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('orientationchange', scheduleLayout);
  window.visualViewport?.addEventListener('resize', scheduleLayout);

  // iOS ignores user-scalable=no for pinch; cancel its gesture events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  // No double-tap zoom, long-press callouts or rubber-band scrolling.
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Android: go fullscreen and lock landscape on the first tap. iPhone Safari
  // has neither API, which is what the rotated layout is for.
  const firstTap = () => {
    const el = document.documentElement;
    if (IS_TOUCH && document.fullscreenEnabled && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => {});
    }
  };
  window.addEventListener('pointerdown', firstTap, { once: true, capture: true });
}
