import { ButtonSource } from './input.js';
import { toLocal } from '../shell.js';

const STICK_RADIUS = 52;
const DEAD_X = 0.32;
const DOWN_Y = 0.55;

// Floating joystick on the left 40% of the screen plus Jump / Quick / Strong
// buttons on the right. Pointer events, so several thumbs work at once.
export class TouchSource extends ButtonSource {
  constructor(root) {
    super();
    this.root = root;
    root.innerHTML = `
      <div class="tc-stick-zone"></div>
      <div class="tc-stick-hint">move</div>
      <div class="tc-stick"><div class="tc-knob"></div></div>
      <button class="tc-btn tc-strong" data-b="strong">Strong</button>
      <button class="tc-btn tc-quick" data-b="quick">Quick</button>
      <button class="tc-btn tc-jump" data-b="jump">Jump</button>`;
    this.zone = root.querySelector('.tc-stick-zone');
    this.stick = root.querySelector('.tc-stick');
    this.knob = root.querySelector('.tc-knob');
    this.hint = root.querySelector('.tc-stick-hint');
    this.stickId = null;
    this.origin = null;
    this.cleanups = [];

    this.listen(this.zone, 'pointerdown', (e) => this.stickStart(e));
    this.listen(this.zone, 'pointermove', (e) => this.stickMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.listen(this.zone, type, (e) => this.stickEnd(e));
    }

    for (const el of root.querySelectorAll('.tc-btn')) {
      const b = el.dataset.b;
      const ids = new Set();
      this.listen(el, 'pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        ids.add(e.pointerId);
        el.classList.add('down');
        this.press(b);
      });
      const up = (e) => {
        ids.delete(e.pointerId);
        if (ids.size) return;
        el.classList.remove('down');
        this.release(b);
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(el, type, up);
    }
  }

  listen(el, type, fn) {
    el.addEventListener(type, fn, { passive: false });
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }

  stickStart(e) {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.zone.setPointerCapture?.(e.pointerId);
    this.stickId = e.pointerId;
    this.origin = toLocal(e.clientX, e.clientY);
    this.stick.style.left = `${this.origin.x}px`;
    this.stick.style.top = `${this.origin.y}px`;
    this.stick.classList.add('on');
    this.hint.style.opacity = '0';
    this.setAxis(0, 0);
  }

  stickMove(e) {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    const p = toLocal(e.clientX, e.clientY);
    let dx = p.x - this.origin.x;
    let dy = p.y - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // Drag the base along so reversing direction is instant.
      const k = (len - STICK_RADIUS) / len;
      this.origin.x += dx * k;
      this.origin.y += dy * k;
      dx -= dx * k;
      dy -= dy * k;
      this.stick.style.left = `${this.origin.x}px`;
      this.stick.style.top = `${this.origin.y}px`;
    }
    this.setAxis(dx / STICK_RADIUS, dy / STICK_RADIUS);
  }

  stickEnd(e) {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.stick.classList.remove('on');
    this.setAxis(0, 0);
  }

  setAxis(ax, ay) {
    this.knob.style.transform = `translate(${ax * STICK_RADIUS}px, ${ay * STICK_RADIUS}px)`;
    (ax < -DEAD_X ? this.press('left') : this.release('left'));
    (ax > DEAD_X ? this.press('right') : this.release('right'));
    (ay > DOWN_Y && ay > Math.abs(ax) * 0.7 ? this.press('down') : this.release('down'));
  }

  destroy() {
    this.cleanups.forEach((fn) => fn());
    this.root.innerHTML = '';
  }
}
