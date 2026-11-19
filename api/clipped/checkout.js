// POST /api/clipped/checkout {currency: "USD"|"INR"} — starts a Razorpay subscription for Pro.
'use strict';
const L = require('../_lib/clipped.js');

module.exports = L.handler('POST', async (req) => {
  const body = await L.readJson(req);
  const currency = body.currency === 'INR' ? 'INR' : 'USD';
  const plan = currency === 'INR' ? process.env.RAZORPAY_PLAN_INR : process.env.RAZORPAY_PLAN_USD;
  if (!plan) throw L.notConfigured(`Pro in ${currency}`);
  const { id } = L.razorpay();
  if (!L.hasKv()) throw L.notConfigured('Storage');
  const sub = await L.rzp('POST', '/subscriptions', {
    plan_id: plan, total_count: 120, quantity: 1, customer_notify: 1, notes: { product: 'clipped pro' },
  });
  await L.kvSetJson(`sub:${sub.id}`, { id: sub.id, status: sub.status, plan, currency, created: L.now(), updated: L.now(), paid_until: 0 });
  return { subscription_id: sub.id, razorpay_key_id: id, currency };
});
