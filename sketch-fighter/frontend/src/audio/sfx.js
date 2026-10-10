// Tiny synthesized sound effects (WebAudio, no files). Unlocked on the first
// tap or key press, as mobile browsers require.
let ctx = null;
let master = null;
let noise = null;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function initAudioUnlock() {
  const once = () => unlockAudio();
  window.addEventListener('pointerdown', once, { capture: true });
  window.addEventListener('keydown', once, { capture: true });
}

function tone(freq, to, dur, type = 'square', gain = 0.3) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

function hiss(dur, freq, gain = 0.4) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}

const SOUNDS = {
  jump: () => tone(320, 620, 0.09, 'triangle', 0.18),
  doublejump: () => tone(440, 880, 0.1, 'triangle', 0.18),
  land: () => hiss(0.05, 900, 0.12),
  swing: () => hiss(0.06, 2400, 0.1),
  swingStrong: () => { hiss(0.12, 1400, 0.16); tone(140, 90, 0.12, 'sine', 0.15); },
  hit: () => { hiss(0.07, 1800, 0.45); tone(260, 120, 0.07, 'square', 0.12); },
  hitStrong: () => { hiss(0.16, 900, 0.6); tone(160, 45, 0.22, 'sawtooth', 0.22); },
  hazard: () => { tone(900, 300, 0.12, 'sawtooth', 0.14); hiss(0.08, 3000, 0.2); },
  ko: () => { tone(700, 60, 0.6, 'sawtooth', 0.22); hiss(0.5, 600, 0.35); },
  tick: () => tone(1200, 1200, 0.04, 'sine', 0.12),
  go: () => { tone(520, 520, 0.08, 'square', 0.15); setTimeout(() => ctx && tone(780, 780, 0.16, 'square', 0.15), 90); },
  ui: () => tone(900, 1300, 0.04, 'sine', 0.1),
};

export function sfx(name) {
  if (!ctx || ctx.state !== 'running') return;
  SOUNDS[name]?.();
}

export function vibrate(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // iOS Safari has no vibration API.
  }
}
