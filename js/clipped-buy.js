/* ============================================
   clipped / buy: Pro checkout with Razorpay (USD
   for everyone, INR for India), the key shown
   afterwards, and "find my key".
   ============================================ */
(function () {
  'use strict';

  // The licence server can live on any host; clipped/api.json (same origin) says where.
  const API = fetch('/clipped/api.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j) => (/^https:\/\//.test(j.api || '') || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.api || '') ? j.api.replace(/\/+$/, '') + '/' : null))
    .catch(() => null);
  const PRICES = { USD: '$2.99', INR: '₹249' }; // must match the Razorpay plans' amounts
  const $ = (sel) => document.querySelector(sel);
  const msg = $('.buy-msg');
  let config = null;

  const say = (html) => {
    if (!msg) return;
    msg.hidden = false;
    msg.innerHTML = html;
    msg.classList.remove('pop');
    void msg.offsetWidth;
    msg.classList.add('pop');
  };
  const post = async (path, body) => {
    const api = await API;
    if (!api) throw new Error('Accounts are being set up. Try again soon, or email r@evzero.org.');
    const res = await fetch(api + path + '/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again in a minute.');
    return data;
  };

  // ---- the key, once there is one
  const showKey = (key) => {
    const box = $('[data-key-box]');
    if (!box || !key) return;
    $('[data-key-text]').textContent = key;
    box.hidden = false;
    try { localStorage.setItem('clipped-pro-key', key); } catch (e) { /* private mode */ }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const copy = $('[data-copy-key]');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('[data-key-text]').textContent); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select and copy it'; }
    setTimeout(() => { copy.textContent = 'Copy key'; }, 2400);
  });
  try {
    const saved = localStorage.getItem('clipped-pro-key');
    if (saved) { $('[data-key-text]').textContent = saved; $('[data-key-box]').hidden = false; }
  } catch (e) { /* storage blocked */ }

  // ---- currency
  let currency = 'USD';
  try { if (/Kolkata|Calcutta/.test(Intl.DateTimeFormat().resolvedOptions().timeZone)) currency = 'INR'; } catch (e) { /* old browser */ }
  const setCurrency = (c) => {
    currency = c;
    document.querySelectorAll('[data-currency]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.currency === c)));
    const price = $('[data-price]');
    if (price) price.textContent = PRICES[c];
  };
  document.querySelectorAll('[data-currency]').forEach((b) => b.addEventListener('click', () => setCurrency(b.dataset.currency)));
  setCurrency(currency);

  API.then((api) => (api ? fetch(api + 'config/').then((r) => r.json()) : Promise.reject())).then((c) => {
    config = c;
    const cur = (c.pro && c.pro.currencies) || {};
    if (cur.USD && !cur.INR) setCurrency('USD');
    if (cur.INR && !cur.USD) setCurrency('INR');
    if (!(cur.USD && cur.INR)) document.querySelectorAll('.currency').forEach((el) => { el.hidden = true; });
  }).catch(() => {});

  // ---- Razorpay checkout
  const loadRazorpay = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load Razorpay. Check your connection or ad blocker."));
    document.head.appendChild(s);
  });

  const subscribe = $('[data-subscribe]');
  if (subscribe) subscribe.addEventListener('click', async () => {
    if (!config || !config.pro || !config.pro.ready) {
      say('Pro checkout opens very soon. Want it today? Email <a href="mailto:r@evzero.org?subject=clipped%20Pro">r@evzero.org</a>, or start with a <a href="#free-how">free day</a>.');
      return;
    }
    subscribe.disabled = true;
    try {
      const [order] = await Promise.all([post('checkout', { currency }), loadRazorpay()]);
      const rzp = new window.Razorpay({
        key: order.razorpay_key_id,
        subscription_id: order.subscription_id,
        name: 'clipped',
        description: 'Pro · monthly',
        theme: { color: '#8a78f0' },
        handler: async (resp) => {
          say('Payment received. Making your key…');
          try {
            showKey((await post('checkout-verify', resp)).license_key);
            say('You&rsquo;re Pro. Your key is below.');
          } catch (e) {
            say(e.message + ' Your payment is safe: use &ldquo;Find my key&rdquo; below in a minute.');
          }
        },
        modal: { ondismiss: () => { subscribe.disabled = false; } },
      });
      rzp.on('payment.failed', (r) => say('The payment didn&rsquo;t go through: ' + ((r.error && r.error.description) || 'try another card or UPI') + '.'));
      rzp.open();
    } catch (e) {
      say(e.message);
    } finally {
      subscribe.disabled = false;
    }
  });

  // ---- your subscription: find my key, or cancel
  const lookup = $('[data-lookup]');
  const day = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (lookup) lookup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('[data-lookup-msg]');
    const action = (e.submitter && e.submitter.value) || 'find';
    const data = { ...Object.fromEntries(new FormData(lookup)), action };
    if (action === 'cancel' && !window.confirm('Cancel Pro? No more payments will be taken, and Pro keeps working until the end of the month you’ve paid for.')) return;
    out.textContent = action === 'cancel' ? 'Cancelling…' : 'Looking…';
    lookup.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const r = await post('key-lookup', data);
      if (action === 'cancel') {
        out.textContent = 'Cancelled. No more payments will be taken' + (r.paid_until > Date.now() / 1000 ? '; Pro keeps working until ' + day(r.paid_until) + '.' : '.');
      } else {
        showKey(r.license_key);
        out.textContent = 'Found it. It’s at the top of the page.';
      }
    } catch (err) {
      out.textContent = err.message;
    } finally {
      lookup.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });
})();
