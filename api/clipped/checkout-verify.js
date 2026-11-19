// POST /api/clipped/checkout-verify {razorpay_payment_id, razorpay_subscription_id, razorpay_signature}
// Razorpay Checkout's success callback, checked with the API secret, then the Pro key.
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('POST', async (req) => {
  const b = await L.readJson(req);
  const paymentId = String(b.razorpay_payment_id || '');
  const subId = String(b.razorpay_subscription_id || '');
  const { secret } = L.razorpay();
  if (!paymentId || !subId || !L.safeEqual(L.hmac(secret, `${paymentId}|${subId}`), b.razorpay_signature || '')) {
    throw new L.ApiError(400, 'bad_signature', "That payment couldn't be verified.");
  }
  const sub = await L.saveSubscription(await L.rzp('GET', `/subscriptions/${subId}`));
  if (!L.ACTIVE.has(sub.status)) throw new L.ApiError(402, 'pending', 'Payment received; the subscription is still starting. Refresh in a minute.');
  return { license_key: await L.proKeyFor(subId) };
});
