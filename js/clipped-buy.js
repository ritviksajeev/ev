/* ============================================
   clipped / buy: the savings slider and the
   checkout buttons. Checkout links are filled in
   once payments are set up (see CHECKOUT).
   ============================================ */
(function () {
  'use strict';

  // Hosted checkout pages, one per plan. Empty until payments go live.
  const CHECKOUT = { monthly: '', lifetime: '' };
  const MONTHLY = 2.99;
  const LIFETIME = 32;
  const money = (v) => '$' + v.toFixed(2);

  // ---- savings slider
  const range = document.getElementById('months');
  if (range) {
    const $ = (sel) => document.querySelector(sel);
    const update = () => {
      const m = Number(range.value);
      const monthly = MONTHLY * m;
      const max = Math.max(monthly, LIFETIME);
      $('[data-months]').textContent = m;
      $('[data-months-word]').textContent = m === 1 ? 'month' : 'months';
      $('[data-total-monthly]').textContent = money(monthly);
      $('[data-bar-monthly]').style.width = (monthly / max) * 100 + '%';
      $('[data-bar-lifetime]').style.width = (LIFETIME / max) * 100 + '%';
      range.style.setProperty('--fill', ((m - 1) / (Number(range.max) - 1)) * 100 + '%');
      const diff = monthly - LIFETIME;
      const result = $('[data-result]');
      if (diff > 0.005) {
        result.innerHTML = 'Lifetime saves you <b>' + money(diff) + '</b> (' + Math.round((diff / monthly) * 100) + '%).';
        result.classList.remove('neutral');
      } else {
        const left = Math.ceil(LIFETIME / MONTHLY) - m;
        result.innerHTML = 'Monthly is cheaper for now: lifetime pulls ahead in <b>' + left + ' more month' + (left === 1 ? '' : 's') + '</b>.';
        result.classList.add('neutral');
      }
    };
    range.addEventListener('input', update);
    update();
  }

  // ---- checkout
  const msg = document.querySelector('.buy-msg');
  document.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = CHECKOUT[btn.dataset.plan];
      if (url) { window.location.href = url; return; }
      if (!msg) return;
      msg.hidden = false;
      msg.innerHTML = 'Checkout opens very soon. Want a key today? Email <a href="mailto:r@evzero.org?subject=clipped%20' +
        btn.dataset.plan + '%20key">r@evzero.org</a> or ask in the <a href="https://discord.gg/hrN8ye6nrF" target="_blank" rel="noreferrer noopener">Discord</a>.';
      msg.classList.remove('pop');
      void msg.offsetWidth;
      msg.classList.add('pop');
    });
  });
})();
