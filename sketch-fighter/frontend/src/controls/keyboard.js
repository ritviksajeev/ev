import { ButtonSource } from './input.js';

export const P1_KEYS = {
  KeyA: 'left', KeyD: 'right', KeyS: 'down', KeyW: 'jump', Space: 'jump', KeyJ: 'quick', KeyK: 'strong',
};
export const P2_KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'jump',
  Numpad1: 'quick', Period: 'quick', Numpad2: 'strong', Slash: 'strong',
};

// Keys by physical position (KeyboardEvent.code), so layouts like AZERTY work.
export class KeyboardSource extends ButtonSource {
  constructor(map) {
    super();
    this.map = map;
    this.onDown = (e) => {
      const b = this.map[e.code];
      if (!b) return;
      e.preventDefault();
      if (!e.repeat) this.press(b);
    };
    this.onUp = (e) => {
      const b = this.map[e.code];
      if (b) this.release(b);
    };
    this.onBlur = () => this.releaseAll();
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  destroy() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
