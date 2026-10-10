import { BUTTONS, ButtonSource } from './input.js';

// Standard mapping: A jump, X quick, B strong (Y also jumps), stick or D-pad.
// Reads the first connected pad, whatever slot the browser put it in.
export class GamepadSource extends ButtonSource {
  read() {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (pad) {
      const btn = (i) => !!pad.buttons[i]?.pressed;
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      const now = {
        left: x < -0.4 || btn(14),
        right: x > 0.4 || btn(15),
        down: y > 0.6 || btn(13),
        jump: btn(0) || btn(3) || btn(12),
        quick: btn(2),
        strong: btn(1),
      };
      for (const b of BUTTONS) (now[b] ? this.press(b) : this.release(b));
    }
    return super.read();
  }
}
