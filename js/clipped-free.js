/* ============================================
   clipped / free: a free day key, or one of the
   two daily watermark removals, after rewarded
   ads (Google Ad Manager's rewarded format for the
   web). The app opens this page with its computer
   id and a one-time nonce, and collects the result
   by itself; the code is also shown to paste.
   ============================================ */
(function () {
  'use strict';

  const API = '/api/clipped/';
  const $ = (sel) => document.querySelector(sel);
  const q = new URLSearchParams(location.search);
  const device = q.get('d') || '';
  const nonce = q.get('nonce') || '';
  const mode = q.get('mode') === 'wm' ? 'wm' : 'day';
  const status = (text) => { $('[data-status]').textContent = text; };
  const go = $('[data-go]');

  if (!/^[0-9a-f]{16}$/.test(device)) {
    $('[data-start]').hidden = false;
    $('[data-status]').hidden = true;
    return;
  }
  if (mode === 'wm') {
    $('[data-crumb]').textContent = 'Watermark';
    $('[data-title]').innerHTML = 'Lose the <span class="serif accent">watermark.</span>';
    $('[data-lead]').textContent = 'A few short ads and this Short re-renders clean. Two a day on the free plan.';
  }

  const dots = (done, total) => {
    $('[data-dots]').innerHTML = Array.from({ length: total }, (_, i) => '<i class="' + (i < done ? 'on' : '') + '"></i>').join('');
  };

  // ---- Google Publisher Tag, rewarded slots
  const loadGpt = () => new Promise((resolve, reject) => {
    window.googletag = window.googletag || { cmd: [] };
    if (document.querySelector('script[data-gpt]')) return resolve();
    const s = document.createElement('script');
    s.src = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
    s.async = true;
    s.dataset.gpt = '1';
    s.onload = resolve;
    s.onerror = () => reject(new Error('blocked'));
    document.head.appendChild(s);
  });

  // One rewarded ad. Resolves {granted} once it's closed, or {error} if none could show.
  const rewardedAd = (unit) => new Promise((resolve) => {
    const gt = window.googletag;
    gt.cmd.push(() => {
      const slot = gt.defineOutOfPageSlot(unit, gt.enums.OutOfPageFormat.REWARDED);
      if (!slot) return resolve({ error: 'unsupported' });
      slot.addService(gt.pubads());
      let granted = false;
      let settled = false;
      const finish = (r) => { if (settled) return; settled = true; gt.destroySlots([slot]); resolve(r); };
      const pub = gt.pubads();
      pub.addEventListener('rewardedSlotReady', (ev) => {
        if (ev.slot !== slot) return;
        go.hidden = false;
        go.disabled = false;
        go.onclick = () => { go.disabled = true; ev.makeRewardedVisible(); };
        status('Your ad is ready.');
      });
      pub.addEventListener('rewardedSlotGranted', (ev) => { if (ev.slot === slot) granted = true; });
      pub.addEventListener('rewardedSlotClosed', (ev) => { if (ev.slot === slot) finish({ granted }); });
      pub.addEventListener('slotRenderEnded', (ev) => { if (ev.slot === slot && ev.isEmpty) finish({ error: 'nofill' }); });
      gt.enableServices();
      gt.display(slot);
    });
  });

  const claim = async (session, watched) => {
    const res = await fetch(API + 'free-claim/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, watched, nonce }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Reload the page to try again.');
    return data;
  };

  const done = (result) => {
    go.hidden = true;
    $('[data-status]').hidden = true;
    $('[data-done]').hidden = false;
    $('[data-code]').textContent = result.value;
    if (result.again) $('[data-done] .pd-note').textContent = 'You already have today’s free day: here it is again. Paste it in the app if it hasn’t unlocked.';
    $('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(result.value); $('[data-copy]').textContent = 'Copied'; } catch (e) { /* select it */ }
    };
  };

  (async () => {
    let start;
    try {
      const params = new URLSearchParams({ device, mode });
      if (mode === 'wm') { params.set('key', q.get('k') || ''); params.set('n', q.get('n') || ''); }
      const res = await fetch(API + 'free-start/?' + params);
      start = await res.json();
      if (!res.ok) throw new Error(start.error || 'Free days are taking a break. Try again soon.');
    } catch (e) {
      status(e.message);
      return;
    }

    if (!start.ads_enabled) {
      // Ads aren't switched on yet: a short wait, then the free day.
      let left = start.min_seconds + 1;
      dots(0, 1);
      const tick = setInterval(async () => {
        left -= 1;
        status(left > 0 ? 'Free days are on us while ads are being set up. Unlocking in ' + left + '…' : 'Unlocking…');
        if (left > 0) return;
        clearInterval(tick);
        dots(1, 1);
        try { done(await claim(start.session, 0)); } catch (e) { status(e.message); }
      }, 1000);
      return;
    }

    const total = start.ads_required;
    let watched = 0;
    dots(0, total);
    try {
      await loadGpt();
    } catch (e) {
      status('Your browser or an ad blocker stopped the ads. Allow ads on evzero.org, then reload this page.');
      return;
    }
    while (watched < total) {
      status('Loading ad ' + (watched + 1) + ' of ' + total + '…');
      go.hidden = true;
      go.innerHTML = 'Watch ad ' + (watched + 1) + ' of ' + total + ' <span class="arrow">&rarr;</span>';
      const r = await rewardedAd(start.ad_unit);
      if (r.error) {
        status(r.error === 'nofill' ? 'No ad is available right now. Give it a minute, then reload.' : 'This browser can’t show these ads. Try another browser, or your phone (open the same link).');
        return;
      }
      if (!r.granted) { status('That ad closed early, so it didn’t count. Let’s try again.'); continue; }
      watched += 1;
      dots(watched, total);
    }
    status('Unlocking…');
    try { done(await claim(start.session, watched)); } catch (e) { status(e.message); }
  })();
})();
