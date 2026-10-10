import Phaser from 'phaser';
import { mount, esc } from '../ui/overlay.js';
import { sfx } from '../audio/sfx.js';

// Shown over the paused Fight scene.
export class Result extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(r) {
    const color = r.winner ? `#${r.winner.color.toString(16).padStart(6, '0')}` : 'var(--white)';
    const title = r.winner ? `${esc(r.winner.name)} <span style="color:${color}">wins</span>` : 'Draw';
    const sub = r.reason === 'ko' ? 'Knocked out of the arena' : 'Time ran out: lower damage wins';
    const el = mount(this, `
      <div class="overlay">
        <div class="panel">
          <div class="kicker">( ${r.reason === 'ko' ? 'K.O.' : 'Time'} )</div>
          <h2 class="display result-title">${title}</h2>
          <p class="result-sub">${sub}</p>
          <div class="result-stats">
            ${r.fighters.map((f) => `<span>${esc(f.name)}<b>${f.damage}%</b></span>`).join('')}
          </div>
          <div class="row">
            <button class="btn" data-act="rematch">Rematch <span class="arrow">&rarr;</span></button>
            <button class="btn ghost" data-act="new">New stage</button>
          </div>
        </div>
      </div>`);

    const go = (act) => {
      sfx('ui');
      if (act === 'rematch') this.scene.start('Fight', { stage: r.stage, mode: r.mode });
      else {
        this.scene.stop('Fight');
        this.scene.start('Home');
      }
    };
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => go(b.dataset.act)));
    const onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') go('rematch');
      if (e.code === 'Escape') go('new');
    };
    // Let the KO key press finish before listening, so it can't skip this screen.
    this.time.delayedCall(400, () => window.addEventListener('keydown', onKey));
    this.events.once('shutdown', () => window.removeEventListener('keydown', onKey));
  }
}
