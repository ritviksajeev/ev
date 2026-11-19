// GET /api/clipped/free-start?device=&mode=day|wm&key=&n=
// Starts a free unlock: a signed, timestamped session the claim must come back with.
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('GET', async (req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const device = q.get('device') || '';
  const mode = q.get('mode') === 'wm' ? 'wm' : 'day';
  if (!L.validDevice(device)) throw new L.ApiError(400, 'bad_device', 'Open this page from the clipped app.');
  const session = { t: 'sess', d: device, m: mode, s: L.now() };
  if (mode === 'wm') {
    const key = q.get('key') || '';
    const n = Number(q.get('n'));
    if (!/^[0-9a-f]{20}$/.test(key) || ![1, 2].includes(n)) throw new L.ApiError(400, 'bad_request', 'Open this page from the clipped app.');
    session.k = key;
    session.n = n;
  }
  const adsRequired = Math.max(1, Math.min(10, Number(process.env.CLIPPED_ADS_REQUIRED || 3)));
  const adsEnabled = process.env.CLIPPED_ADS_ENABLED === '1' && Boolean(process.env.CLIPPED_ADS_UNIT);
  return {
    session: L.signToken(session), mode,
    ads_enabled: adsEnabled, ads_required: adsRequired, ad_unit: adsEnabled ? process.env.CLIPPED_ADS_UNIT : '',
    min_seconds: adsEnabled ? adsRequired * 10 : 5,
  };
});
