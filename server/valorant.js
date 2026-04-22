/* ============================================
   Valorant API proxy — hides HENRIK_API_KEY server-side.
   Handler returns true if it served the request, false otherwise
   (so server.js can fall through to its own routes / 404).
   ============================================ */

const HENRIK_BASE = 'https://api.henrikdev.xyz';
const CACHE_TTL_MS = 60_000;         // 1 min — plenty for v1
const MATCHES_CACHE_TTL_MS = 30_000; // matches refresh a bit quicker
const MAX_MATCH_SIZE = 20;
const VALID_REGIONS = new Set(['eu', 'na', 'latam', 'br', 'ap', 'kr']);
const VALID_PLATFORMS = new Set(['pc', 'console']);

/** @type {Map<string, { body: string, status: number, contentType: string, expiresAt: number }>} */
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { cache.delete(key); return null; }
  return hit;
}
function cacheSet(key, body, status, contentType, ttl) {
  cache.set(key, { body, status, contentType, expiresAt: Date.now() + ttl });
}

// Periodic sweep so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expiresAt < now) cache.delete(k);
}, 5 * 60_000);

function jsonResponse(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function safe(s, max = 64) {
  return String(s || '').trim().slice(0, max);
}

async function fetchHenrik(path, ttl) {
  const url = `${HENRIK_BASE}${path}`;
  const cached = cacheGet(url);
  if (cached) return { ...cached, cached: true };

  const headers = { 'Accept': 'application/json' };
  const key = process.env.HENRIK_API_KEY;
  if (key) headers['Authorization'] = key;

  let upstream;
  try {
    upstream = await fetch(url, { headers });
  } catch (err) {
    return {
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'upstream unreachable', detail: String(err && err.message || err) }),
      cached: false,
    };
  }

  const body = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  // Only cache successful responses — don't trap 404/429 etc.
  if (upstream.ok) cacheSet(url, body, upstream.status, contentType, ttl);
  return { status: upstream.status, contentType, body, cached: false };
}

function requireKey(res) {
  if (!process.env.HENRIK_API_KEY) {
    jsonResponse(res, 503, {
      error: 'tracker not configured',
      detail: 'HENRIK_API_KEY is not set on the server. Ask the admin to drop the key in the Railway environment.',
    });
    return false;
  }
  return true;
}

function passThrough(res, upstream) {
  res.writeHead(upstream.status, {
    'Content-Type': upstream.contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'X-Cache': upstream.cached ? 'HIT' : 'MISS',
  });
  res.end(upstream.body);
}

function validRiot(name, tag) {
  return name.length >= 3 && name.length <= 16 && tag.length >= 3 && tag.length <= 5;
}

// ---- handlers ---------------------------------------------------------

async function handleAccount(url, res) {
  const name = safe(url.searchParams.get('name'), 24);
  const tag = safe(url.searchParams.get('tag'), 6);
  if (!validRiot(name, tag)) return jsonResponse(res, 400, { error: 'bad riot id' });
  if (!requireKey(res)) return;

  const enc = (s) => encodeURIComponent(s);
  const upstream = await fetchHenrik(
    `/valorant/v2/account/${enc(name)}/${enc(tag)}`,
    CACHE_TTL_MS,
  );
  passThrough(res, upstream);
}

async function handleMmr(url, res) {
  const region = safe(url.searchParams.get('region'), 6).toLowerCase();
  const platform = safe(url.searchParams.get('platform'), 8).toLowerCase() || 'pc';
  const name = safe(url.searchParams.get('name'), 24);
  const tag = safe(url.searchParams.get('tag'), 6);
  if (!VALID_REGIONS.has(region)) return jsonResponse(res, 400, { error: 'bad region' });
  if (!VALID_PLATFORMS.has(platform)) return jsonResponse(res, 400, { error: 'bad platform' });
  if (!validRiot(name, tag)) return jsonResponse(res, 400, { error: 'bad riot id' });
  if (!requireKey(res)) return;

  const enc = (s) => encodeURIComponent(s);
  const upstream = await fetchHenrik(
    `/valorant/v3/mmr/${region}/${platform}/${enc(name)}/${enc(tag)}`,
    CACHE_TTL_MS,
  );
  passThrough(res, upstream);
}

async function handleMatches(url, res) {
  const region = safe(url.searchParams.get('region'), 6).toLowerCase();
  const platform = safe(url.searchParams.get('platform'), 8).toLowerCase() || 'pc';
  const name = safe(url.searchParams.get('name'), 24);
  const tag = safe(url.searchParams.get('tag'), 6);
  const sizeRaw = parseInt(url.searchParams.get('size') || '20', 10);
  const size = Math.min(Math.max(Number.isFinite(sizeRaw) ? sizeRaw : 20, 1), MAX_MATCH_SIZE);
  const mode = safe(url.searchParams.get('mode'), 16).toLowerCase(); // optional

  if (!VALID_REGIONS.has(region)) return jsonResponse(res, 400, { error: 'bad region' });
  if (!VALID_PLATFORMS.has(platform)) return jsonResponse(res, 400, { error: 'bad platform' });
  if (!validRiot(name, tag)) return jsonResponse(res, 400, { error: 'bad riot id' });
  if (!requireKey(res)) return;

  const enc = (s) => encodeURIComponent(s);
  const qs = new URLSearchParams({ size: String(size) });
  if (mode) qs.set('mode', mode);
  const upstream = await fetchHenrik(
    `/valorant/v4/matches/${region}/${platform}/${enc(name)}/${enc(tag)}?${qs}`,
    MATCHES_CACHE_TTL_MS,
  );
  passThrough(res, upstream);
}

// ---- router -----------------------------------------------------------

export async function handleValorant(req, res) {
  if (!req.url || !req.url.startsWith('/val/')) return false;

  // CORS preflight — harmless even if frontend is same-origin in future.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    jsonResponse(res, 405, { error: 'method not allowed' });
    return true;
  }

  const url = new URL(req.url, 'http://x');
  const route = url.pathname;

  try {
    if (route === '/val/account')  { await handleAccount(url, res); return true; }
    if (route === '/val/mmr')      { await handleMmr(url, res);     return true; }
    if (route === '/val/matches')  { await handleMatches(url, res); return true; }
    if (route === '/val/health')   {
      jsonResponse(res, 200, { ok: true, hasKey: !!process.env.HENRIK_API_KEY, cacheSize: cache.size });
      return true;
    }
  } catch (err) {
    console.error('[val]', route, err);
    jsonResponse(res, 500, { error: 'proxy error', detail: String(err && err.message || err) });
    return true;
  }

  jsonResponse(res, 404, { error: 'unknown val route' });
  return true;
}
