import Phaser from 'phaser';
import { apiUrl, HAS_API, recentStages } from '../api.js';
import { GAME_HASH } from '../config.js';

// Waits for the UI fonts and pings the server, then hands off to Home.
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    Promise.all([loadFonts(), checkServer()]).then(([, server]) => {
      this.registry.set('server', server);
      if (server.online) {
        recentStages().then((list) => this.registry.set('gallery', list.filter((s) => s?.tiles))).catch(() => {});
      }
      this.scene.start('Home');
    });
  }
}

function loadFonts() {
  const faces = ['600 16px Unbounded', '400 16px Inter', '500 16px Inter', '500 16px "JetBrains Mono"'];
  const all = Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {});
  return Promise.race([all, wait(1500)]);
}

async function checkServer() {
  if (!HAS_API) return { online: false, static: true, inSync: null, gemini: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(apiUrl('/api/health'), { signal: ctrl.signal });
    const body = await res.json();
    const inSync = body.configHash === GAME_HASH;
    if (!inSync) {
      console.warn(`shared/game.json differs between server (${body.configHash}) and this build (${GAME_HASH}). Rebuild the frontend.`);
    }
    return { online: true, inSync, gemini: !!body.gemini };
  } catch {
    return { online: false, inSync: null, gemini: false };
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
