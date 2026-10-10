import Phaser from 'phaser';
import { GAME } from '../config.js';
import { COLOR } from '../theme.js';
import { enrichStage, HAS_API } from '../api.js';
import { mount, esc } from '../ui/overlay.js';
import { fitCamera, STAGE_X, STAGE_Y } from '../view.js';
import { drawPaper, drawTile } from '../stage/StageView.js';
import { fallbackExtras } from '../stage/names.js';
import { sfx } from '../audio/sfx.js';

const T = GAME.tileSize;

// Photo -> scan sweep -> tiles assemble -> fixes pulse -> name -> FIGHT.
// Never waits on Gemini: the name fades in whenever it arrives.
export class Reveal extends Phaser.Scene {
  constructor() {
    super('Reveal');
  }

  create({ stage, photoUrl, clientMs }) {
    this.stage = stage;
    fitCamera(this);
    drawPaper(this);

    this.layer = document.getElementById('hud');
    this.layer.innerHTML = photoUrl
      ? `<div class="reveal-photo"><img src="${photoUrl}" alt="" /><i class="scanline run"></i></div>`
      : '';
    this.events.once('shutdown', () => {
      this.layer.innerHTML = '';
      if (photoUrl?.startsWith('blob:')) URL.revokeObjectURL(photoUrl);
    });

    const server = stage.timings?.total;
    const timing = [
      server != null ? `scan ${Math.round(server)} ms` : null,
      clientMs != null ? `photo to stage ${(clientMs / 1000).toFixed(1)} s` : null,
    ].filter(Boolean).join(' &middot; ');

    this.ui = mount(this, `
      <div class="screen reveal">
        <header class="bar">
          <div class="brand">sketch fighter</div>
          <span>${timing}</span>
        </header>
        <div class="reveal-name">
          <div class="kicker reveal-kicker">( Naming your stage )</div>
          <h2 class="display reveal-title"></h2>
          <p class="reveal-line"></p>
        </div>
        <footer class="reveal-foot">
          <ul class="reveal-fixes"></ul>
          <div class="row reveal-actions"></div>
        </footer>
      </div>`);

    const sweep = photoUrl ? 900 : 0;
    this.time.delayedCall(sweep, () => this.assemble());
    this.time.delayedCall(sweep + 1100, () => this.showFixes());
    this.time.delayedCall(sweep + 1300, () => this.showActions());

    if (stage.extras) this.showName(stage.extras);
    else if (HAS_API) {
      enrichStage(stage.id).then((x) => this.showName(x)).catch(() => this.showName(fallbackExtras(stage.id)));
    } else this.showName(fallbackExtras(stage.id));

    this.onKey = (e) => (e.code === 'Enter' || e.code === 'Space') && this.fight();
    window.addEventListener('keydown', this.onKey);
    this.events.once('shutdown', () => window.removeEventListener('keydown', this.onKey));
  }

  assemble() {
    this.layer.querySelector('.reveal-photo')?.classList.add('dim');
    const fixed = new Set(this.stage.fixes.filter((f) => f.op === 'add').flatMap((f) => f.cells.map(([c, r]) => `${c},${r}`)));
    this.stage.tiles.forEach((row, r) => row.forEach((code, c) => {
      if (!code) return;
      const g = this.add.graphics({ x: STAGE_X + c * T + T / 2, y: STAGE_Y + r * T + T / 2 });
      drawTile(g, code, -T / 2, -T / 2);
      g.setScale(0.3).setAlpha(0);
      this.tweens.add({
        targets: g,
        scale: 1,
        alpha: 1,
        delay: (r + c) * 14 + (fixed.has(`${c},${r}`) ? 500 : 0),
        duration: 260,
        ease: 'Back.Out',
      });
    }));
    sfx('swing');
  }

  showFixes() {
    const list = this.ui.querySelector('.reveal-fixes');
    const g = this.add.graphics().setDepth(5);
    this.stage.fixes.forEach((fix, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<i class="${fix.op}"></i>${esc(fix.message)}`;
      li.style.animationDelay = `${i * 160}ms`;
      list.appendChild(li);
      for (const [c, r] of fix.cells) {
        const x = STAGE_X + c * T;
        const y = STAGE_Y + r * T;
        if (fix.op === 'add') g.lineStyle(2, COLOR.fix, 1).strokeRect(x - 2, y - 2, T + 4, T + 4);
        else g.lineStyle(1, COLOR.hazard, 0.9).strokeRect(x + 2, y + 2, T - 4, T - 4);
      }
    });
    if (this.stage.fixes.length) {
      this.tweens.add({ targets: g, alpha: 0.15, duration: 420, yoyo: true, repeat: 4, onComplete: () => g.setAlpha(0.6) });
      sfx('doublejump');
    }
  }

  showActions() {
    const actions = this.ui.querySelector('.reveal-actions');
    const retake = !this.stage.cardDetected;
    actions.innerHTML = `
      ${retake ? '<span class="muted reveal-note">Couldn\'t find the card edges, so the whole photo was used.</span>' : ''}
      <button class="btn" data-act="fight">Fight <span class="arrow">&rarr;</span></button>
      ${retake ? '<label class="btn ghost hit" for="retake">Retake</label><input id="retake" type="file" accept="image/*" capture="environment" hidden />' : ''}`;
    actions.querySelector('[data-act="fight"]').addEventListener('click', () => this.fight());
    actions.querySelector('#retake')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) this.scene.start('Capture', { file: f });
    });
  }

  showName(extras) {
    if (!this.scene.isActive() || !extras) return;
    this.stage.extras = extras;
    const name = this.ui.querySelector('.reveal-title');
    name.textContent = extras.stageName;
    if (/^#[0-9a-f]{6}$/i.test(extras.accentColor)) name.style.color = extras.accentColor;
    this.ui.querySelector('.reveal-line').textContent = extras.announcerLine;
    this.ui.querySelector('.reveal-kicker').textContent = '( Stage )';
    this.ui.querySelector('.reveal-name').classList.add('on');
  }

  fight() {
    if (this.leaving) return;
    this.leaving = true;
    sfx('ui');
    this.scene.start('Fight', { stage: this.stage, mode: this.registry.get('mode') ?? 'cpu' });
  }
}
