// node --test api/_lib/__tests__/   (the leading underscore keeps this out of Vercel's routes)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Readable } = require('stream');

const { privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.CLIPPED_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = 'secret123';
process.env.RAZORPAY_PLAN_USD = 'plan_usd';
process.env.RAZORPAY_PLAN_INR = 'plan_inr';

const L = require('../clipped.js');

// ---- an in-memory Upstash
const store = new Map();
L._test.setKv(async ([cmd, key, value, ...opts]) => {
  const live = (k) => { const e = store.get(k); if (e && e.exp && e.exp < Date.now()) { store.delete(k); return null; } return e; };
  if (cmd === 'GET') { const e = live(key); return e ? e.v : null; }
  if (cmd === 'DEL') { store.delete(key); return 1; }
  if (cmd === 'SET') {
    if (opts.includes('NX') && live(key)) return null;
    const ex = opts.indexOf('EX');
    store.set(key, { v: value, exp: ex >= 0 ? Date.now() + Number(opts[ex + 1]) * 1000 : 0 });
    return 'OK';
  }
  throw new Error('unexpected ' + cmd);
});

// ---- a fake Razorpay
const subs = {};
L._test.setFetch(async (url, init) => {
  const path = url.replace('https://api.razorpay.com/v1', '');
  let body;
  if (init.method === 'POST' && path === '/subscriptions') {
    const id = 'sub_' + crypto.randomBytes(6).toString('hex');
    subs[id] = { id, status: 'created', plan_id: JSON.parse(init.body).plan_id, customer_id: 'cust_1', current_end: 0 };
    body = subs[id];
  } else if (init.method === 'POST' && /^\/subscriptions\/[^/]+\/cancel$/.test(path)) {
    const sub = subs[path.split('/')[2]];
    const atEnd = JSON.parse(init.body).cancel_at_cycle_end === 1;
    sub.cancel_calls = (sub.cancel_calls || 0) + 1;
    // Razorpay keeps a subscription cancelled at cycle end active until then.
    if (!atEnd) sub.status = 'cancelled';
    sub.cancel_at_cycle_end = atEnd;
    body = sub;
  } else if (path.startsWith('/subscriptions/')) {
    body = subs[path.split('/')[2]];
  } else if (path === '/customers/cust_1') {
    body = { id: 'cust_1', email: 'fan@example.com' };
  }
  return { ok: Boolean(body), json: async () => body || { error: { description: 'not found' } } };
});

let clock = 1_800_000_000_000;
Date.now = () => clock;
const advance = (s) => { clock += s * 1000; };

async function call(file, { method = 'GET', url = '/', body } = {}) {
  const fn = require(`../../clipped/${file}.js`);
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url, headers: { 'content-type': 'application/json' } });
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await fn(req, res);
  return { status: res.statusCode, body: res.body };
}

const DEV_A = 'aaaaaaaaaaaaaaaa';
const DEV_B = 'bbbbbbbbbbbbbbbb';

test('keys round-trip, are locked to a computer, and resist tampering', () => {
  const { key, id } = L.issueKey({ plan: 'day', device: DEV_A, expires: 123 });
  const k = L.parseKey(key.toLowerCase().replace(/-/g, ' '));
  assert.deepStrictEqual([k.plan, k.device, k.expires, k.id], ['day', DEV_A, 123, id]);
  const pro = L.parseKey(L.issueKey({ plan: 'pro' }).key);
  assert.strictEqual(pro.plan, 'pro');
  assert.strictEqual(pro.device, null);
  for (const pos of [10, 40, key.length - 1]) {
    const c = key[pos] === '0' ? '1' : '0';
    assert.throws(() => L.parseKey(key.slice(0, pos) + c + key.slice(pos + 1)));
  }
  const tok = L.signToken({ t: 'wm', n: 1 });
  assert.strictEqual(L.readToken(tok, 'wm').n, 1);
  // Change a character inside the signature (the last one holds only padding bits)
  const at = tok.indexOf('.') + 5;
  assert.throws(() => L.readToken(tok.slice(0, at) + (tok[at] === 'A' ? 'B' : 'A') + tok.slice(at + 1), 'wm'));
  assert.throws(() => L.readToken('x' + tok, 'wm'));
  assert.throws(() => L.readToken(tok, 'cert'));
});

test('a free day: ads first, one key per computer per day, handed to the waiting app', async () => {
  const start = await call('free-start', { url: `/api/clipped/free-start?device=${DEV_A}&mode=day` });
  assert.strictEqual(start.status, 200);
  const nonce = crypto.randomBytes(16).toString('hex');
  const early = await call('free-claim', { method: 'POST', body: { session: start.body.session, nonce } });
  assert.strictEqual(early.status, 425);
  advance(6);
  const got = await call('free-claim', { method: 'POST', body: { session: start.body.session, nonce } });
  assert.strictEqual(got.status, 200);
  const k = L.parseKey(got.body.value);
  assert.strictEqual(k.plan, 'day');
  assert.strictEqual(k.device, DEV_A);
  assert.strictEqual(k.expires - Math.floor(clock / 1000), L.DAY);
  const picked = await call('pickup', { url: `/api/clipped/pickup?nonce=${nonce}` });
  assert.strictEqual(picked.body.value, got.body.value);
  assert.deepStrictEqual((await call('pickup', { url: `/api/clipped/pickup?nonce=${nonce}` })).body, { pending: true });
  // A second claim the same day gets the same key back, not a second day
  const again = await call('free-claim', { method: 'POST', body: { session: (await call('free-start', { url: `/x?device=${DEV_A}` })).body.session } });
  assert.strictEqual(again.status, 425);
  const s2 = (await call('free-start', { url: `/x?device=${DEV_A}` })).body.session;
  advance(6);
  const second = await call('free-claim', { method: 'POST', body: { session: s2 } });
  assert.strictEqual(second.body.value, got.body.value);
  assert.strictEqual(second.body.again, true);
  // The key works only on its own computer
  assert.strictEqual((await call('activate', { method: 'POST', body: { key: k && got.body.value, device: DEV_A } })).status, 200);
  assert.strictEqual((await call('activate', { method: 'POST', body: { key: got.body.value, device: DEV_B } })).body.code, 'other_device');
});

test('watermark removals: two per day key, each once', async () => {
  const { id } = L.issueKey({ plan: 'day', device: DEV_A, expires: Math.floor(clock / 1000) + 9999 });
  const claim = async (n) => {
    const s = await call('free-start', { url: `/x?device=${DEV_A}&mode=wm&key=${id}&n=${n}` });
    advance(6);
    return call('free-claim', { method: 'POST', body: { session: s.body.session } });
  };
  const one = await claim(1);
  assert.strictEqual(L.readToken(one.body.value, 'wm').n, 1);
  assert.strictEqual((await claim(1)).body.code, 'used');
  assert.strictEqual((await claim(2)).status, 200);
  assert.strictEqual((await call('free-start', { url: `/x?device=${DEV_A}&mode=wm&key=${id}&n=3` })).status, 400);
});

test('Pro: subscribe, verify, one computer at a time, limited moves, ends with the subscription', async () => {
  const co = await call('checkout', { method: 'POST', body: { currency: 'INR' } });
  assert.strictEqual(co.status, 200);
  const subId = co.body.subscription_id;
  assert.strictEqual(subs[subId].plan_id, 'plan_inr');
  // Bad signature
  assert.strictEqual((await call('checkout-verify', { method: 'POST', body: { razorpay_payment_id: 'pay_1', razorpay_subscription_id: subId, razorpay_signature: 'nope' } })).status, 400);
  subs[subId].status = 'active';
  subs[subId].current_end = Math.floor(clock / 1000) + 30 * L.DAY;
  const sig = crypto.createHmac('sha256', 'secret123').update(`pay_1|${subId}`).digest('hex');
  const ok = await call('checkout-verify', { method: 'POST', body: { razorpay_payment_id: 'pay_1', razorpay_subscription_id: subId, razorpay_signature: sig } });
  assert.strictEqual(ok.status, 200);
  const key = ok.body.license_key;
  // The same purchase shows the same key again (and the email lookup finds it)
  assert.strictEqual((await call('checkout-verify', { method: 'POST', body: { razorpay_payment_id: 'pay_1', razorpay_subscription_id: subId, razorpay_signature: sig } })).body.license_key, key);
  assert.strictEqual((await call('key-lookup', { method: 'POST', body: { subscription_id: subId, email: 'FAN@example.com' } })).body.license_key, key);
  assert.strictEqual((await call('key-lookup', { method: 'POST', body: { subscription_id: subId, email: 'other@example.com' } })).status, 404);

  const a = await call('activate', { method: 'POST', body: { key, device: DEV_A } });
  assert.strictEqual(a.status, 200);
  const cert = L.readToken(a.body.cert, 'cert');
  assert.strictEqual(cert.d, DEV_A);
  assert.ok(cert.u - Math.floor(clock / 1000) <= L.CERT_DAYS * L.DAY);
  // A second computer is refused: no sharing
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: DEV_B } })).body.code, 'device_limit');
  // Moving is self-service but limited to 3 a month
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: DEV_B, force: true } })).status, 200);
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: DEV_A } })).body.code, 'device_limit');
  for (const d of ['cccccccccccccccc', 'dddddddddddddddd']) {
    assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: d, force: true } })).status, 200);
  }
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: 'eeeeeeeeeeeeeeee', force: true } })).body.code, 'too_many_moves');
  // Signing out frees the slot, but a new computer is still a move
  await call('deactivate', { method: 'POST', body: { key, device: 'dddddddddddddddd' } });
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: 'eeeeeeeeeeeeeeee' } })).body.code, 'too_many_moves');
  subs[subId].status = 'cancelled';
  advance(31 * L.DAY); // cancelled, but paid until the end of the month plus 3 days' grace: still works
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: 'dddddddddddddddd' } })).status, 200);
  await call('deactivate', { method: 'POST', body: { key, device: 'dddddddddddddddd' } });
  advance(3 * L.DAY); // past the grace: over
  const ended = await call('activate', { method: 'POST', body: { key, device: 'dddddddddddddddd' } });
  assert.strictEqual(ended.body.code, 'inactive');
});

test('Cancel Pro: needs the paying email, stops payments, keeps Pro to the end of the paid month', async () => {
  const co = await call('checkout', { method: 'POST', body: { currency: 'USD' } });
  const subId = co.body.subscription_id;
  subs[subId].status = 'active';
  subs[subId].current_end = Math.floor(clock / 1000) + 30 * L.DAY;
  const sig = crypto.createHmac('sha256', 'secret123').update(`pay_9|${subId}`).digest('hex');
  const key = (await call('checkout-verify', { method: 'POST', body: { razorpay_payment_id: 'pay_9', razorpay_subscription_id: subId, razorpay_signature: sig } })).body.license_key;
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: DEV_A } })).status, 200);

  // Someone who only knows the subscription id can't cancel it
  const wrong = await call('key-lookup', { method: 'POST', body: { subscription_id: subId, email: 'other@example.com', action: 'cancel' } });
  assert.strictEqual(wrong.status, 404);
  assert.strictEqual(subs[subId].cancel_calls, undefined);

  const done = await call('key-lookup', { method: 'POST', body: { subscription_id: subId, email: 'fan@example.com', action: 'cancel' } });
  assert.strictEqual(done.status, 200);
  assert.strictEqual(done.body.cancelled, true);
  assert.strictEqual(subs[subId].cancel_at_cycle_end, true);
  assert.strictEqual(done.body.paid_until, subs[subId].current_end);
  // Cancelling twice is harmless and doesn't call Razorpay again once it has ended
  subs[subId].status = 'cancelled';
  assert.strictEqual((await call('key-lookup', { method: 'POST', body: { subscription_id: subId, email: 'fan@example.com', action: 'cancel' } })).status, 200);
  assert.strictEqual(subs[subId].cancel_calls, 1);

  // Still Pro for the rest of the month, then over after the grace days
  advance(29 * L.DAY);
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: DEV_A } })).status, 200);
  advance(5 * L.DAY);
  assert.strictEqual((await call('activate', { method: 'POST', body: { key, device: DEV_A } })).body.code, 'inactive');
});

test('config says what is ready', async () => {
  const cfg = (await call('config')).body;
  assert.strictEqual(cfg.free.ready, true);
  assert.strictEqual(cfg.free.ads_enabled, false);
  assert.strictEqual(cfg.pro.ready, true);
  assert.deepStrictEqual(cfg.pro.currencies, { USD: true, INR: true });
});
