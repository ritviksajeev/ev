// POST /api/clipped/activate {key, device, force?}
// Checks a key for this computer and returns a signed certificate the app trusts
// offline for up to a week. Pro keys are locked to one computer at a time; moving
// is self-service but limited, which is what stops one key being shared around.
'use strict';
const L = require('../_lib/clipped.js');

async function freshSubscription(subId) {
  let sub = await L.kvGetJson(`sub:${subId}`);
  const stale = !sub || L.now() - (sub.updated || 0) > 6 * 3600 || (sub.paid_until || 0) < L.now();
  if (stale) {
    try { sub = await L.saveSubscription(await L.rzp('GET', `/subscriptions/${subId}`)); } catch (err) { if (!sub) throw err; }
  }
  return sub;
}

module.exports = L.handler('POST', async (req) => {
  const body = await L.readJson(req);
  const device = String(body.device || '');
  if (!L.validDevice(device)) throw new L.ApiError(400, 'bad_device', 'This copy of clipped sent no computer id.');
  const k = L.parseKey(body.key);
  const t = L.now();

  if (k.plan === 'day') {
    if (k.device !== device) throw new L.ApiError(403, 'other_device', 'That free key belongs to another computer. Get your own free day at evzero.org/clipped/free.');
    if (k.expires < t) throw new L.ApiError(403, 'expired', 'That free day is over. Get a new one at evzero.org/clipped/free.');
    return { plan: 'day', valid_until: k.expires, cert: L.signToken({ t: 'cert', v: 1, k: k.id, d: device, p: 'day', u: k.expires, i: t }) };
  }
  if (k.plan === 'lifetime' || k.plan === 'monthly') {
    const until = k.expires || t + 30 * L.DAY;
    return { plan: k.plan, valid_until: until, cert: L.signToken({ t: 'cert', v: 1, k: k.id, d: device, p: k.plan, u: until, i: t }) };
  }

  // Pro: a live subscription, one computer at a time.
  const rec = await L.kvGetJson(`key:${k.id}`);
  if (!rec || rec.revoked) throw new L.ApiError(403, 'unknown_key', "That key isn't active. If you just paid, wait a minute and try again.");
  const sub = await freshSubscription(rec.sub);
  const paidUntil = (sub && sub.paid_until) || 0;
  if (!sub || (!L.ACTIVE.has(sub.status) && paidUntil + L.GRACE < t)) {
    throw new L.ApiError(402, 'inactive', 'Your Pro subscription has ended. Renew at evzero.org/clipped/buy.');
  }
  rec.devices = rec.devices || [];
  rec.moves = (rec.moves || []).filter((m) => t - m < 30 * L.DAY);
  if (!rec.devices.includes(device)) {
    const moving = (rec.history || []).length > 0;
    if (rec.devices.length >= L.PRO_DEVICES && !body.force) {
      throw new L.ApiError(409, 'device_limit', 'This key is in use on another computer. Sign out of clipped there (Settings → Licence), or move it here.');
    }
    if (moving && rec.moves.length >= L.MOVES_PER_30_DAYS) {
      throw new L.ApiError(429, 'too_many_moves', `This key has moved computers ${L.MOVES_PER_30_DAYS} times in 30 days. Email r@evzero.org if you need a hand.`);
    }
    if (rec.devices.length >= L.PRO_DEVICES) rec.devices = rec.devices.slice(rec.devices.length - L.PRO_DEVICES + 1);
    rec.devices.push(device);
    if (moving) rec.moves.push(t);
    rec.history = [...new Set([...(rec.history || []), device])].slice(-20);
  }
  rec.seen = { ...(rec.seen || {}), [device]: t };
  await L.kvSetJson(`key:${k.id}`, rec);
  const until = Math.min(Math.max(paidUntil, t) + L.GRACE, t + L.CERT_DAYS * L.DAY);
  return {
    plan: 'pro', valid_until: until, moves_left: L.MOVES_PER_30_DAYS - rec.moves.length,
    cert: L.signToken({ t: 'cert', v: 1, k: k.id, d: device, p: 'pro', u: until, i: t }),
  };
});
