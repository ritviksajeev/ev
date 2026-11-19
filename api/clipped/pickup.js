// GET /api/clipped/pickup?nonce= — the app collects what the free page unlocked for it.
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('GET', async (req) => {
  const nonce = new URL(req.url, 'http://x').searchParams.get('nonce') || '';
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new L.ApiError(400, 'bad_request', 'Bad nonce.');
  if (!L.hasKv()) return { pending: true };
  const value = await L.kvGetJson(`pickup:${nonce}`);
  if (!value) return { pending: true };
  await L.kv('DEL', `pickup:${nonce}`);
  return value;
});
