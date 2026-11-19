// POST /api/clipped/deactivate {key, device} — "sign out of this computer": frees the Pro slot.
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('POST', async (req) => {
  const body = await L.readJson(req);
  const k = L.parseKey(body.key);
  if (k.plan !== 'pro') return { ok: true };
  const rec = await L.kvGetJson(`key:${k.id}`);
  if (rec) {
    rec.devices = (rec.devices || []).filter((d) => d !== String(body.device || ''));
    await L.kvSetJson(`key:${k.id}`, rec);
  }
  return { ok: true };
});
