// Every input device feeds the same six buttons, so fighter code never knows
// whether it is driven by a thumb, a keyboard, a gamepad or the CPU.
export const BUTTONS = ['left', 'right', 'down', 'jump', 'quick', 'strong'];

export const emptyButtons = () => ({ left: false, right: false, down: false, jump: false, quick: false, strong: false });

// A source reports buttons that are held, plus buttons pressed since the last
// read (latched), so a tap shorter than one frame still registers.
export class ButtonSource {
  constructor() {
    this.held = emptyButtons();
    this.latched = emptyButtons();
  }

  press(b) {
    if (!this.held[b]) this.latched[b] = true;
    this.held[b] = true;
  }

  release(b) {
    this.held[b] = false;
  }

  releaseAll() {
    for (const b of BUTTONS) this.held[b] = false;
  }

  read() {
    const out = {};
    for (const b of BUTTONS) {
      out[b] = this.held[b] || this.latched[b];
      this.latched[b] = false;
    }
    return out;
  }

  destroy() {}
}

// Merges several sources into one controller and turns presses into
// per-physics-step commands. Presses stay pending until a step consumes them.
export class Controller {
  constructor(sources = []) {
    this.sources = sources;
    this.prev = emptyButtons();
    this.cur = emptyButtons();
    this.pending = { jump: false, quick: false, strong: false };
  }

  add(source) {
    this.sources.push(source);
  }

  // Once per rendered frame.
  poll() {
    const cur = emptyButtons();
    for (const s of this.sources) {
      const r = s.read();
      for (const b of BUTTONS) cur[b] = cur[b] || r[b];
    }
    this.prev = this.cur;
    this.cur = cur;
    for (const b of ['jump', 'quick', 'strong']) {
      if (cur[b] && !this.prev[b]) this.pending[b] = true;
    }
  }

  // Once per physics step: held direction + any pending presses, consumed.
  command() {
    const c = this.cur;
    const cmd = {
      dir: (c.right ? 1 : 0) - (c.left ? 1 : 0),
      down: c.down,
      jump: this.pending.jump,
      quick: this.pending.quick,
      strong: this.pending.strong,
    };
    this.pending.jump = this.pending.quick = this.pending.strong = false;
    return cmd;
  }

  anyPressed() {
    return BUTTONS.some((b) => this.cur[b] && !this.prev[b]);
  }

  destroy() {
    this.sources.forEach((s) => s.destroy());
  }
}
