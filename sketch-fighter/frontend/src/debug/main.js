// /debug: tune shared/vision.json against a real photo at the venue.
// Every slider change re-runs the scan on the server with the edited values
// (POST /api/scan?debug=1 with a "vision" override) and shows each stage of
// the pipeline. Save writes the file on the server (X-Debug-Token) and also
// downloads it, since a Cloud Run disk doesn't survive a redeploy.
import '@fontsource/inter/400.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/jetbrains-mono/500.css';
import './debug.css';
import { apiUrl } from '../api.js';
import { reencode } from '../capture/reencode.js';

const root = document.getElementById('debug');
let vision = null;
let photo = null;
let seq = 0;
let timer = 0;

root.innerHTML = `
  <div class="dbg">
    <aside class="dbg-side">
      <h1>calibration</h1>
      <p class="kicker" style="margin-top:6px">shared/vision.json</p>
      <div class="group">
        <label class="btn" for="photo">Choose photo</label>
        <input id="photo" type="file" accept="image/*" hidden />
        <div class="status" id="status">Load a photo of a drawn card.</div>
      </div>
      <div id="controls"></div>
      <div class="group">
        <span class="kicker">Save</span>
        <input id="token" type="password" placeholder="DEBUG_TOKEN (if the server has one)" />
        <div class="row">
          <button class="btn" id="save" disabled>Save to server</button>
          <button class="btn ghost" id="download" disabled>Download</button>
          <button class="btn ghost" id="reset" disabled>Reload</button>
        </div>
      </div>
    </aside>
    <main class="dbg-main">
      <div class="imgs">
        <figure><img id="img-warped" alt="" /><figcaption>Warped card</figcaption></figure>
        <figure><img id="img-grid" alt="" /><figcaption>Grid</figcaption></figure>
        <figure><img id="img-solid" alt="" /><figcaption>Mask: black / solid</figcaption></figure>
        <figure><img id="img-pass" alt="" /><figcaption>Mask: blue / pass-through</figcaption></figure>
        <figure><img id="img-hazard" alt="" /><figcaption>Mask: red / hazard</figcaption></figure>
      </div>
      <div>
        <p class="kicker">Timings (ms)</p>
        <table id="timings"></table>
      </div>
    </main>
  </div>`;

const $ = (sel) => root.querySelector(sel);
const status = (text, err = false) => {
  $('#status').textContent = text;
  $('#status').classList.toggle('err', err);
};

$('#photo').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  status('Preparing photo...');
  photo = (await reencode(file)).blob;
  scan();
});

$('#token').value = localStorage.getItem('sketch-debug-token') ?? '';
$('#token').addEventListener('change', (e) => localStorage.setItem('sketch-debug-token', e.target.value));
$('#download').addEventListener('click', download);
$('#save').addEventListener('click', save);
$('#reset').addEventListener('click', load);

load();

async function load() {
  try {
    const res = await fetch(apiUrl('/api/debug/vision'));
    if (!res.ok) throw new Error(`GET /api/debug/vision ${res.status}`);
    vision = await res.json();
    renderControls();
    ['#save', '#download', '#reset'].forEach((s) => ($(s).disabled = false));
    if (photo) scan();
  } catch (err) {
    status(`Could not load vision.json: ${err.message}`, true);
  }
}

// One control per numeric/boolean leaf, with ranges guessed from the key name.
function renderControls() {
  const box = $('#controls');
  box.innerHTML = '';
  const walk = (obj, path, group) => {
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('_') || (path.length === 0 && key === 'warp')) continue;
      const p = [...path, key];
      if (val && typeof val === 'object') {
        const g = document.createElement('div');
        g.className = 'group';
        g.innerHTML = `<span class="kicker">${p.join(' / ')}</span>`;
        (group ?? box).appendChild(g);
        walk(val, p, Array.isArray(val) ? group ?? box : g);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        (group ?? box).appendChild(control(p, val));
      }
    }
  };
  walk(vision, [], null);
}

function control(path, val) {
  const key = path[path.length - 1];
  const el = document.createElement('label');
  if (typeof val === 'boolean') {
    el.className = 'ctl check';
    el.innerHTML = `<input type="checkbox" ${val ? 'checked' : ''} /><span>${key}</span>`;
    el.querySelector('input').addEventListener('change', (e) => set(path, e.target.checked));
    return el;
  }
  const [min, max, step] = rangeFor(key, val);
  el.className = 'ctl';
  el.innerHTML = `<span>${key}</span><output>${val}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" />`;
  el.querySelector('input').addEventListener('input', (e) => {
    let v = Number(e.target.value);
    if (/kernel/i.test(key) && v % 2 === 0) v += 1; // blur kernels must be odd
    el.querySelector('output').textContent = v;
    set(path, v);
  });
  return el;
}

function rangeFor(key, val) {
  if (/^h(min|max)$/i.test(key)) return [0, 179, 1];
  if (/^[sv](min|max)$/i.test(key)) return [0, 255, 1];
  if (/coverage|fraction/i.test(key)) return [0, 1, 0.01];
  if (/epsilon/i.test(key)) return [0.005, 0.1, 0.005];
  if (/kernel/i.test(key)) return [3, 301, 2];
  if (/px$/i.test(key)) return [0, 15, 1];
  if (/clip/i.test(key)) return [0, 8, 0.1];
  if (/canny|contrast/i.test(key)) return [0, 255, 1];
  if (/blur|grid/i.test(key)) return [1, 31, 1];
  return [0, Math.max(10, val * 4), Number.isInteger(val) ? 1 : 0.01];
}

function set(path, v) {
  let o = vision;
  for (const k of path.slice(0, -1)) o = o[k];
  o[path[path.length - 1]] = v;
  clearTimeout(timer);
  timer = setTimeout(scan, 220);
}

async function scan() {
  if (!photo || !vision) return;
  const mine = ++seq;
  status('Scanning...');
  const form = new FormData();
  form.append('image', photo, 'card.jpg');
  form.append('vision', JSON.stringify(vision));
  try {
    const res = await fetch(apiUrl('/api/scan?debug=1'), { method: 'POST', body: form });
    const body = await res.json();
    if (mine !== seq) return; // a newer scan is on its way
    if (!res.ok) throw new Error(body.error || res.status);
    const d = body.debug ?? {};
    $('#img-warped').src = d.warped ?? '';
    $('#img-grid').src = d.grid ?? '';
    for (const k of ['solid', 'pass', 'hazard']) $(`#img-${k}`).src = d.masks?.[k] ?? '';
    $('#timings').innerHTML = Object.entries(body.timings ?? {})
      .map(([k, v]) => `<tr><td>${k}</td><td>${Number(v).toFixed(1)}</td></tr>`).join('');
    status(`${body.cardDetected ? 'Card found' : 'No card found: whole photo used'} · ${body.fixes?.length ?? 0} fixes`);
  } catch (err) {
    if (mine === seq) status(`Scan failed: ${err.message}`, true);
  }
}

async function save() {
  status('Saving...');
  try {
    const res = await fetch(apiUrl('/api/debug/vision'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Token': $('#token').value },
      body: JSON.stringify(vision, null, 2),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    status('Saved to the server. Downloading a copy for the repo too.');
    download();
  } catch (err) {
    status(`Save failed: ${err.message}. Use Download and commit the file instead.`, true);
  }
}

function download() {
  const blob = new Blob([`${JSON.stringify(vision, null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vision.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
