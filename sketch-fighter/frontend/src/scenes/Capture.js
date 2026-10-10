import Phaser from 'phaser';
import { HAS_API, scanPhoto } from '../api.js';
import { reencode } from '../capture/reencode.js';
import { mount, esc } from '../ui/overlay.js';
import { pickSample } from '../stage/stages.js';
import { sfx } from '../audio/sfx.js';

// Photo -> re-encode -> upload with progress -> Reveal.
export class Capture extends Phaser.Scene {
  constructor() {
    super('Capture');
  }

  create({ file }) {
    this.photo = null;
    this.keepPhoto = false;
    this.el = mount(this, `
      <div class="overlay capture">
        <div class="panel">
          <div class="capture-photo"><img alt="" /><i class="scanline"></i></div>
          <div class="kicker capture-status">( Preparing photo )</div>
          <div class="progress"><i></i></div>
          <div class="row capture-actions"></div>
        </div>
      </div>`);
    this.img = this.el.querySelector('img');
    this.status = this.el.querySelector('.capture-status');
    this.bar = this.el.querySelector('.progress i');
    this.actions = this.el.querySelector('.capture-actions');
    this.events.once('shutdown', () => this.photo && !this.keepPhoto && URL.revokeObjectURL(this.photo.url));
    this.run(file);
  }

  async run(file) {
    const started = performance.now();
    try {
      this.photo = await reencode(file);
      this.img.src = this.photo.url;
      this.el.querySelector('.capture-photo').classList.add('on');
      if (!HAS_API) {
        this.fail('This web preview has no scanner yet. Try a sample stage, or run the game server.', false);
        return;
      }
      this.setStatus('Uploading', 0);
      const stage = await scanPhoto(this.photo.blob, (p) => this.setStatus(p < 1 ? 'Uploading' : 'Building your stage', p));
      this.keepPhoto = true;
      this.scene.start('Reveal', { stage, photoUrl: this.photo.url, clientMs: performance.now() - started });
    } catch (err) {
      this.fail(err.message || 'Something went wrong');
    }
  }

  setStatus(text, p) {
    this.status.textContent = `( ${text} )`;
    this.bar.style.width = `${Math.round(p * 100)}%`;
    this.el.querySelector('.capture').classList.toggle('busy', text.startsWith('Building'));
  }

  fail(message, retry = true) {
    this.status.innerHTML = `<span class="muted">${esc(message)}</span>`;
    this.el.querySelector('.progress').style.display = 'none';
    this.actions.innerHTML = `
      ${retry ? '<label class="btn hit" for="retake">Retake <span class="arrow">&rarr;</span></label><input id="retake" class="file-input" type="file" accept="image/*" capture="environment" />' : ''}
      <button class="btn ${retry ? 'ghost' : ''}" data-act="sample">Play a sample stage</button>
      <button class="btn ghost" data-act="home">Back</button>`;
    this.actions.querySelector('#retake')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) this.scene.restart({ file: f });
    });
    this.actions.querySelector('[data-act="sample"]').addEventListener('click', () => {
      sfx('ui');
      this.scene.start('Fight', { stage: pickSample() });
    });
    this.actions.querySelector('[data-act="home"]').addEventListener('click', () => this.scene.start('Home'));
  }
}
