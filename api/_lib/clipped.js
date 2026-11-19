/* ============================================
   clipped licence server: shared code.

   Holds the one secret that can make clipped keys (CLIPPED_SIGNING_KEY, an
   Ed25519 private key), keeps track of Pro subscriptions and the computer each
   one is active on, and hands out free day keys after the ads.

   Runs on Cloudflare Workers (workers/clipped-api, the live setup), as Vercel
   functions (api/clipped/*.js), or as one Node 20+ process with
   `node api/_lib/serve.js` (Railway, Render, a VPS...).
   The app and the pages find it through the site's clipped/api.json, so it
   can live on any host and move without an app update.

   Environment:
     CLIPPED_SIGNING_KEY       Ed25519 private key, PEM (the .pem evzero keeps)
     KV_REST_API_URL / KV_REST_API_TOKEN
                               Upstash Redis (Vercel Marketplace → Upstash);
                               UPSTASH_REDIS_REST_URL / _TOKEN also work
     RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET     Razorpay API keys
     RAZORPAY_PLAN_USD / RAZORPAY_PLAN_INR     plan ids (plan_...) per currency
     CLIPPED_ADS_REQUIRED      ads per free unlock (default 3)
     CLIPPED_ADS_ENABLED       "1" once rewarded ads are live (Google Ad Manager)
     CLIPPED_ADS_UNIT          the rewarded ad unit path, e.g. /1234567/clipped_rewarded
     CLIPPED_ALLOWED_ORIGINS   extra browser origins allowed to call the API (CORS)
     PORT                      for serve.js (default 8787)

   Formats must match clipped/licensing.py byte for byte:
     licence keys  CLIP-XXXXX-...  Crockford base32 of payload || Ed25519 signature
       v1 payload (20 B)  version=1, plan, issued u32, expires u32, id 10 B
       v2 payload (28 B)  version=2, plan, issued u32, expires u32, id 10 B, device 8 B
     tokens        base64url(JSON) "." base64url(Ed25519 signature of the first part)
   ============================================ */
'use strict';

const crypto = require('crypto');

const PLANS = { monthly: 1, lifetime: 2, pro: 3, day: 4 };
const PLAN_NAMES = Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [v, k]));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DAY = 24 * 3600;
const PRO_DEVICES = 1; // computers a Pro key can be active on at once
const MOVES_PER_30_DAYS = 3; // self-service "sign out here, sign in there"
const CERT_DAYS = 7; // how long the app may run offline on one check
const GRACE = 3 * DAY; // a renewal that's a little late doesn't lock anyone out
const WATERMARK_REMOVALS = 2; // per free day key

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const notConfigured = (what) => new ApiError(503, 'not_configured', `${what} isn't set up yet. Try again soon.`);

const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- encoding

function b32encode(buf) {
  let bits = BigInt('0x' + (buf.toString('hex') || '0'));
  const n = Math.ceil((buf.length * 8) / 5);
  bits <<= BigInt(n * 5 - buf.length * 8);
  let out = '';
  for (let i = n - 1; i >= 0; i--) out += ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
  return out;
}

function b32decode(text, length) {
  const map = { I: 1, L: 1, O: 0 };
  let bits = 0n;
  for (const ch of text) {
    const v = ch in map ? map[ch] : ALPHABET.indexOf(ch);
    if (v < 0) throw new ApiError(400, 'invalid_key', "That key has characters a clipped key never uses.");
    bits = (bits << 5n) | BigInt(v);
  }
  const extra = text.length * 5 - length * 8;
  if (extra < 0 || extra >= 5) throw new ApiError(400, 'invalid_key', 'That key is the wrong length. Paste the whole key.');
  if (bits & ((1n << BigInt(extra)) - 1n)) throw new ApiError(400, 'invalid_key', "That isn't a valid clipped key.");
  return Buffer.from((bits >> BigInt(extra)).toString(16).padStart(length * 2, '0'), 'hex');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------------------------------------------------------------- signing

// The .pem however it was pasted: as is, with "\\n" for line breaks, squashed onto one line
// (dashboards' secret fields often do that), or just the base64 between the two markers.
function normalizePem(raw) {
  const text = String(raw || '').replace(/\\n/g, '\n').trim();
  if (!text) return '';
  const m = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  const body = (m ? m[1] : text).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new ApiError(503, 'not_configured', "The signing key setting isn't a valid key.");
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}
let cachedKey = null;
let cachedPublic = null;
function privateKey() {
  if (cachedKey) return cachedKey;
  const pem = normalizePem(process.env.CLIPPED_SIGNING_KEY);
  if (!pem) throw notConfigured('Key signing');
  cachedKey = crypto.createPrivateKey(pem);
  return cachedKey;
}
function publicKey() {
  if (!cachedPublic) cachedPublic = crypto.createPublicKey(privateKey());
  return cachedPublic;
}
const sign = (data) => crypto.sign(null, Buffer.from(data), privateKey());
const verify = (data, sig) => crypto.verify(null, Buffer.from(data), publicKey(), sig);

// Licence keys, the strings people paste. A day key (v2) is locked to one computer.
function issueKey({ plan, expires = 0, device = null, id = crypto.randomBytes(10), issued = now() }) {
  const code = PLANS[plan];
  if (!code) throw new Error(`unknown plan ${plan}`);
  let payload;
  if (device) {
    payload = Buffer.alloc(28);
    payload.writeUInt8(2, 0);
    payload.writeUInt8(code, 1);
    payload.writeUInt32BE(issued, 2);
    payload.writeUInt32BE(expires, 6);
    id.copy(payload, 10);
    Buffer.from(device, 'hex').copy(payload, 20);
  } else {
    payload = Buffer.alloc(20);
    payload.writeUInt8(1, 0);
    payload.writeUInt8(code, 1);
    payload.writeUInt32BE(issued, 2);
    payload.writeUInt32BE(expires, 6);
    id.copy(payload, 10);
  }
  const body = b32encode(Buffer.concat([payload, sign(payload)]));
  return { key: 'CLIP-' + body.match(/.{1,5}/g).join('-'), id: id.toString('hex') };
}

function parseKey(key) {
  let text = String(key || '').toUpperCase().replace(/[\s\-_]/g, '');
  if (text.startsWith('CLIP')) text = text.slice(4);
  if (!text) throw new ApiError(400, 'invalid_key', 'Paste your licence key.');
  for (const size of [20, 28]) {
    const length = size + 64;
    const n = Math.ceil((length * 8) / 5);
    if (text.length !== n) continue;
    const raw = b32decode(text, length);
    const payload = raw.subarray(0, size);
    if (!verify(payload, raw.subarray(size))) break;
    const version = payload.readUInt8(0);
    if ((size === 20 && version !== 1) || (size === 28 && version !== 2)) break;
    return {
      plan: PLAN_NAMES[payload.readUInt8(1)],
      issued: payload.readUInt32BE(2),
      expires: payload.readUInt32BE(6),
      id: payload.subarray(10, 20).toString('hex'),
      device: size === 28 ? payload.subarray(20, 28).toString('hex') : null,
    };
  }
  throw new ApiError(400, 'invalid_key', "That isn't a valid clipped key. Check you pasted all of it.");
}

// Signed JSON tokens: activation certificates, free-ad sessions, watermark removals.
function signToken(data) {
  const body = b64url(JSON.stringify(data));
  return body + '.' + b64url(sign(body));
}
function readToken(token, type) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !verify(body, Buffer.from(sig, 'base64url'))) throw new ApiError(400, 'invalid_token', 'That code is invalid or was changed.');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (type && data.t !== type) throw new ApiError(400, 'invalid_token', 'That code is for something else.');
  return data;
}

const validDevice = (d) => typeof d === 'string' && /^[0-9a-f]{16}$/.test(d);

// ---------------------------------------------------------------- storage (Upstash Redis over REST)

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
let kvOverride = null; // tests plug in an in-memory store
async function kv(...command) {
  if (kvOverride) return kvOverride(command);
  const cfg = kvConfig();
  if (!cfg) throw notConfigured('Storage');
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command.map(String)),
    });
  } catch (err) {
    console.error('storage unreachable', err && err.message);
    throw new ApiError(502, 'storage', 'Storage is having a moment. Try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new ApiError(502, 'storage', 'Storage is having a moment. Try again.');
  return data.result;
}
const kvGetJson = async (key) => { const v = await kv('GET', key); return v ? JSON.parse(v) : null; };
const kvSetJson = (key, value, ttl) => (ttl ? kv('SET', key, JSON.stringify(value), 'EX', ttl) : kv('SET', key, JSON.stringify(value)));
const hasKv = () => Boolean(kvOverride || kvConfig());

// ---------------------------------------------------------------- Razorpay

function razorpay() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw notConfigured('Payments');
  return { id, secret, auth: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') };
}
let fetchOverride = null;
async function rzp(method, path, body) {
  const { auth } = razorpay();
  let res;
  try {
    res = await (fetchOverride || fetch)(`https://api.razorpay.com/v1${path}`, {
      method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error('razorpay unreachable', err && err.message);
    throw new ApiError(502, 'payments', "Couldn't reach Razorpay. Your payment is safe; try again in a minute.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, 'payments', (data.error && data.error.description) || 'Razorpay refused the request.');
  return data;
}
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const ACTIVE = new Set(['authenticated', 'active']);

// A subscription the server knows about: status and how long it's paid for.
async function saveSubscription(entity) {
  const prev = (await kvGetJson(`sub:${entity.id}`)) || {};
  const rec = {
    ...prev, id: entity.id, status: entity.status, plan: entity.plan_id,
    paid_until: Math.max(prev.paid_until || 0, entity.current_end || 0, entity.status === 'authenticated' ? now() + 2 * DAY : 0),
    updated: now(),
  };
  await kvSetJson(`sub:${entity.id}`, rec);
  return rec;
}

// The Pro key for a subscription, made once and kept (so it can be shown again).
async function proKeyFor(subId) {
  const sub = await kvGetJson(`sub:${subId}`);
  if (!sub) throw new ApiError(404, 'unknown', "That subscription isn't known yet.");
  if (sub.key) return sub.key;
  const { key, id } = issueKey({ plan: 'pro' });
  sub.key = key;
  sub.key_id = id;
  await kvSetJson(`sub:${subId}`, sub);
  await kvSetJson(`key:${id}`, { sub: subId, devices: [], moves: [], created: now() });
  return key;
}

// ---------------------------------------------------------------- HTTP helpers

const MAX_BODY = 16 * 1024; // every request here is a few hundred bytes
async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ApiError(413, 'too_big', 'That request is too big.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, 'bad_json', 'Send JSON.'); }
}
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
// The pages on evzero.org call this API from the browser, and it may live on another
// host (see clipped/api.json in the site), so those origins get CORS. The app isn't a
// browser and doesn't need it. Add more with CLIPPED_ALLOWED_ORIGINS (comma-separated).
function allowedOrigins() {
  const extra = (process.env.CLIPPED_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return new Set(['https://evzero.org', 'https://www.evzero.org', ...extra]);
}
function cors(req, res) {
  const origin = req.headers && req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

// Wrap a handler: one method, errors as {error, code}, never a stack trace.
function handler(method, fn) {
  return async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (req.method !== method) return send(res, 405, { error: `Use ${method}.`, code: 'method' });
    try {
      send(res, 200, await fn(req, res));
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { error: err.message, code: err.code });
      console.error(err);
      send(res, 500, { error: 'Something went wrong on our side.', code: 'server' });
    }
  };
}

module.exports = {
  ApiError, notConfigured, now, DAY, PRO_DEVICES, MOVES_PER_30_DAYS, CERT_DAYS, GRACE, WATERMARK_REMOVALS, ACTIVE,
  b32encode, b32decode, issueKey, parseKey, signToken, readToken, validDevice,
  kv, kvGetJson, kvSetJson, hasKv, razorpay, rzp, hmac, safeEqual, saveSubscription, proKeyFor,
  readRaw, readJson, send, handler, normalizePem,
  _test: {
    setKv: (fn) => { kvOverride = fn; },
    setFetch: (fn) => { fetchOverride = fn; },
    resetKey: () => { cachedKey = null; cachedPublic = null; },
  },
};
