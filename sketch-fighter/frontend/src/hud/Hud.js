import { esc } from '../ui/overlay.js';

// Damage cards, timer and banners. HTML in #hud, which is sized to the canvas.
export class Hud {
  constructor(scene, fighters, { onExit, hint }) {
    this.root = document.getElementById('hud');
    this.root.innerHTML = `
      <div class="hud">
        <button class="hud-exit" aria-label="Back to home">&#x2715;</button>
        <div class="hud-timer"></div>
        ${hint ? `<div class="hud-hint">${hint}</div>` : ''}
        <div class="hud-cards">
          ${fighters.map((f) => `
            <div class="dmg" data-id="${f.id}" style="--c:${css(f.color)}">
              <span class="dmg-name">${esc(f.name)}</span>
              <span class="dmg-val">0<small>%</small></span>
            </div>`).join('')}
        </div>
        <div class="hud-banner"></div>
      </div>`;
    this.timer = this.root.querySelector('.hud-timer');
    this.banner = this.root.querySelector('.hud-banner');
    this.cards = new Map(fighters.map((f) => [f.id, this.root.querySelector(`.dmg[data-id="${f.id}"]`)]));
    this.shown = new Map();
    this.root.querySelector('.hud-exit').addEventListener('click', onExit);
    scene.events.once('shutdown', () => { this.root.innerHTML = ''; });
  }

  update(fighters, secondsLeft) {
    const s = Math.max(0, Math.ceil(secondsLeft));
    if (this.timer.textContent !== String(s)) {
      this.timer.textContent = s;
      this.timer.classList.toggle('low', s <= 5);
    }
    for (const f of fighters) {
      const card = this.cards.get(f.id);
      const dmg = Math.round(f.damage);
      if (this.shown.get(f.id) !== dmg) {
        const val = card.querySelector('.dmg-val');
        val.innerHTML = `${dmg}<small>%</small>`;
        // White -> amber -> red as damage climbs.
        const k = Math.min(1, dmg / 120);
        val.style.setProperty('--tint', `hsl(${50 - 50 * k} ${k * 100}% ${100 - 38 * k}%)`);
        if (this.shown.has(f.id)) {
          val.classList.remove('bump');
          void val.offsetWidth;
          val.classList.add('bump');
          setTimeout(() => val.classList.remove('bump'), 120);
        }
        this.shown.set(f.id, dmg);
      }
      card.classList.toggle('out', f.ko);
    }
  }

  showBanner(html, ms) {
    this.banner.innerHTML = html;
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (ms) this.bannerTimer = setTimeout(() => this.banner.classList.remove('show'), ms);
  }
}

const css = (n) => `#${n.toString(16).padStart(6, '0')}`;
