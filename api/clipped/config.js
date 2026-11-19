// GET /api/clipped/config — what the buy and free pages need to know (nothing secret).
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('GET', async () => {
  let signing = true;
  try { L.issueKey({ plan: 'day', device: '0000000000000000', expires: 1 }); } catch { signing = false; }
  const adsRequired = Math.max(1, Math.min(10, Number(process.env.CLIPPED_ADS_REQUIRED || 3)));
  const adsEnabled = process.env.CLIPPED_ADS_ENABLED === '1' && Boolean(process.env.CLIPPED_ADS_UNIT);
  const pay = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && L.hasKv());
  return {
    free: { ready: signing, ads_enabled: adsEnabled, ads_required: adsRequired, ad_unit: adsEnabled ? process.env.CLIPPED_ADS_UNIT : '' },
    pro: {
      ready: signing && pay && Boolean(process.env.RAZORPAY_PLAN_USD || process.env.RAZORPAY_PLAN_INR),
      razorpay_key_id: process.env.RAZORPAY_KEY_ID || '',
      currencies: { USD: Boolean(process.env.RAZORPAY_PLAN_USD), INR: Boolean(process.env.RAZORPAY_PLAN_INR) },
    },
  };
});
