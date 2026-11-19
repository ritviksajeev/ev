// node --test api/_lib/__tests__/*.test.js   The standalone server (serve.js) over real HTTP,
// with a stand-in for Upstash's REST API, so the storage client is exercised too.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');

const { privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.CLIPPED_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
delete process.env.RAZORPAY_KEY_ID;
delete process.env.CLIPPED_ADS_ENABLED;

// ---- a tiny Upstash REST stand-in: POST ["CMD", ...args] with a bearer token
const store = new Map();
const upstash = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer t0ken') { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
    const [cmd, key, value, ...opts] = JSON.parse(body);
    const live = (k) => { const e = store.get(k); if (e && e.exp && e.exp < Date.now()) { store.delete(k); return null; } return e; };
    let result = null;
    if (cmd === 'GET') { const e = live(key); result = e ? e.v : null; }
    else if (cmd === 'DEL') { result = store.delete(key) ? 1 : 0; }
    else if (cmd === 'SET') {
      if (opts.includes('NX') && live(key)) result = null;
      else {
        const ex = opts.indexOf('EX');
        store.set(key, { v: value, exp: ex >= 0 ? Date.now() + Number(opts[ex + 1]) * 1000 : 0 });
        result = 'OK';
      }
    } else { res.statusCode = 400; return res.end(JSON.stringify({ error: 'unknown command' })); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result }));
  });
});

// CLIPPED_API_URL=https://… runs the same checks against a running server instead (the
// Worker under `wrangler dev`, or a real deployment that has storage but no payments).
const EXTERNAL = (process.env.CLIPPED_API_URL || '').replace(/\/+$/, '');
let base;
let server;
test.before(async () => {
  if (EXTERNAL) { base = EXTERNAL; return; }
  await new Promise((r) => upstash.listen(0, '127.0.0.1', r));
  process.env.KV_REST_API_URL = `http://127.0.0.1:${upstash.address().port}`;
  process.env.KV_REST_API_TOKEN = 't0ken';
  ({ server } = require('../serve.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { if (server) server.close(); if (upstash.listening) upstash.close(); });

const get = (p, headers) => fetch(base + p, { headers });
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('health, routes with and without /api and the trailing slash, 404s', async () => {
  assert.deepStrictEqual(await (await get('/health')).json(), { ok: true });
  for (const p of ['/clipped/config', '/clipped/config/', '/api/clipped/config/']) {
    const cfg = await (await get(p)).json();
    assert.strictEqual(cfg.free.ready, true, p);
    assert.strictEqual(cfg.pro.ready, false, p);
  }
  assert.strictEqual((await get('/clipped/nope/')).status, 404);
  assert.strictEqual((await get('/etc/passwd')).status, 404);
});

test('CORS: evzero.org may call it from the browser, other sites may not', async () => {
  const ok = await fetch(base + '/clipped/free-claim/', { method: 'OPTIONS', headers: { Origin: 'https://evzero.org', 'Access-Control-Request-Method': 'POST' } });
  assert.strictEqual(ok.status, 204);
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://evzero.org');
  assert.match(ok.headers.get('access-control-allow-methods'), /POST/);
  const evil = await fetch(base + '/clipped/config/', { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(evil.status, 200);
  assert.strictEqual(evil.headers.get('access-control-allow-origin'), null);
});

test('oversized bodies are refused', async () => {
  const r = await post('/clipped/activate/', JSON.stringify({ key: 'x'.repeat(20000) }));
  assert.strictEqual(r.status, 413);
});

test('a free day end to end through Upstash: start, wait, claim, pick up once, activate', async () => {
  const device = crypto.randomBytes(8).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const start = await (await get(`/clipped/free-start/?device=${device}&mode=day`, { Origin: 'https://evzero.org' })).json();
  assert.strictEqual(start.ads_enabled, false);
  // Claiming straight away is refused: the wait (or the ads) comes first
  const early = await post('/clipped/free-claim/', { session: start.session, watched: 0, nonce });
  assert.strictEqual(early.status, 425);
  await new Promise((r) => setTimeout(r, (start.min_seconds + 0.2) * 1000));
  const claim = await post('/clipped/free-claim/', { session: start.session, watched: 0, nonce }, { Origin: 'https://evzero.org' });
  assert.strictEqual(claim.status, 200);
  assert.strictEqual(claim.headers.get('access-control-allow-origin'), 'https://evzero.org');
  const { value: key } = await claim.json();
  assert.match(key, /^CLIP-/);
  // The app picks it up once
  assert.strictEqual((await (await get(`/clipped/pickup/?nonce=${nonce}`)).json()).value, key);
  assert.strictEqual((await (await get(`/clipped/pickup/?nonce=${nonce}`)).json()).pending, true);
  // It's this computer's key and nobody else's
  const mine = await (await post('/clipped/activate/', { key, device })).json();
  assert.strictEqual(mine.plan, 'day');
  const other = await post('/clipped/activate/', { key, device: 'f'.repeat(16) });
  assert.strictEqual((await other.json()).code, 'other_device');
  // Held in storage: one live free day per computer
  if (!EXTERNAL) assert.ok([...store.keys()].some((k) => k === `free:${device}`));
});
