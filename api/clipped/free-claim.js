// POST /api/clipped/free-claim {session, watched, nonce?}
// After the ads: a free day key (locked to that computer, 24 hours) or a watermark
// removal (2 per day key). If the app is waiting (nonce), it's handed over directly.
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('POST', async (req) => {
  const body = await L.readJson(req);
  const s = L.readToken(body.session, 'sess');
  const t = L.now();
  const adsRequired = Math.max(1, Math.min(10, Number(process.env.CLIPPED_ADS_REQUIRED || 3)));
  const adsEnabled = process.env.CLIPPED_ADS_ENABLED === '1' && Boolean(process.env.CLIPPED_ADS_UNIT);
  const minSeconds = adsEnabled ? adsRequired * 10 : 5;
  if (t - s.s < minSeconds) throw new L.ApiError(425, 'too_soon', 'Watch the ads first.');
  if (t - s.s > 1800) throw new L.ApiError(410, 'expired', 'This page sat open too long. Reload it and start again.');
  if (adsEnabled && Number(body.watched || 0) < adsRequired) throw new L.ApiError(400, 'ads', `Watch all ${adsRequired} ads to unlock.`);

  let result;
  if (s.m === 'day') {
    const held = L.hasKv() ? await L.kvGetJson(`free:${s.d}`) : null;
    if (held && held.expires > t + 3600) {
      result = { kind: 'day', value: held.key, expires: held.expires, again: true }; // one free day at a time
    } else {
      const expires = t + L.DAY;
      const { key } = L.issueKey({ plan: 'day', device: s.d, expires });
      if (L.hasKv()) await L.kvSetJson(`free:${s.d}`, { key, expires }, L.DAY);
      result = { kind: 'day', value: key, expires };
    }
  } else {
    // The server is the one that counts: the slot the app asked for, else the other one
    // (an app reinstalled mid-day doesn't know which it already spent).
    let n = s.n;
    if (L.hasKv()) {
      const order = [s.n, ...Array.from({ length: L.WATERMARK_REMOVALS }, (_, i) => i + 1).filter((x) => x !== s.n)];
      n = null;
      for (const slot of order) {
        if (await L.kv('SET', `wm:${s.k}:${slot}`, '1', 'NX', 'EX', 2 * L.DAY) !== null) { n = slot; break; }
      }
      if (n === null) throw new L.ApiError(409, 'used', `You've used both free watermark removals for this free day. Pro has no watermark at all.`);
    }
    result = { kind: 'wm', value: L.signToken({ t: 'wm', v: 1, k: s.k, n, d: s.d, x: t + 2 * L.DAY }), n };
  }
  const nonce = String(body.nonce || '');
  if (/^[0-9a-f]{32}$/.test(nonce) && L.hasKv()) await L.kvSetJson(`pickup:${nonce}`, result, 900);
  return result;
});
