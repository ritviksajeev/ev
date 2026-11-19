// POST /api/clipped/key-lookup {subscription_id, email, action?}
//   action "find" (default): "I closed the tab before saving my key".
//   action "cancel": stop future payments; Pro keeps working to the end of the paid month.
// The subscription id is in Razorpay's receipt email; the email must match the one used to pay.
// Both actions live in one function to stay well inside Vercel's per-deployment function limit.
'use strict';
const L = require('../_lib/clipped.js');

const ENDED = new Set(['cancelled', 'completed', 'expired', 'halted']);

module.exports = L.handler('POST', async (req) => {
  const b = await L.readJson(req);
  const subId = String(b.subscription_id || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const action = b.action === 'cancel' ? 'cancel' : 'find';
  if (!/^sub_[A-Za-z0-9]{6,40}$/.test(subId) || !email.includes('@')) throw new L.ApiError(400, 'bad_request', 'Enter the subscription id (sub_…) and your email.');
  L.razorpay(); // payments not set up yet: say so, rather than "couldn't match"
  let entity = await L.rzp('GET', `/subscriptions/${subId}`).catch(() => null);
  const customer = entity && entity.customer_id ? await L.rzp('GET', `/customers/${entity.customer_id}`).catch(() => null) : null;
  if (!entity || !customer || String(customer.email || '').toLowerCase() !== email) {
    throw new L.ApiError(404, 'not_found', "We couldn't match that subscription and email.");
  }

  if (action === 'cancel') {
    if (!ENDED.has(entity.status)) {
      // An active subscription stops at the end of the month already paid for; one that was
      // never charged (authenticated) or is waiting on a retry stops now.
      const atCycleEnd = entity.status === 'active' ? 1 : 0;
      entity = await L.rzp('POST', `/subscriptions/${subId}/cancel`, { cancel_at_cycle_end: atCycleEnd });
    }
    const sub = await L.saveSubscription(entity);
    return { cancelled: true, paid_until: sub.paid_until || 0 };
  }

  const sub = await L.saveSubscription(entity);
  if (!L.ACTIVE.has(sub.status) && (sub.paid_until || 0) < L.now()) throw new L.ApiError(402, 'inactive', 'That subscription has ended.');
  return { license_key: await L.proKeyFor(subId) };
});
