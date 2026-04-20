// Runs on YouTube / Netflix / Twitch. Finds the <video>, forwards local events
// to the background service worker, and applies remote events to the player.

(function () {
  'use strict';

  const host = location.hostname;
  const site = host.includes('youtube.com') ? 'youtube'
             : host.includes('netflix.com') ? 'netflix'
             : host.includes('twitch.tv')   ? 'twitch'
             : null;
  if (!site) return;

  let video = null;
  let suppressUntil = 0;
  let lastSeekTime = -1;
  const SUPPRESS_MS = 600;

  function findVideo() {
    // Pick the largest visible <video>; works across all three sites.
    const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 || v.src);
    if (vids.length === 0) return null;
    return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }

  function attach(v) {
    if (video === v) return;
    if (video) detach(video);
    video = v;

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeek);
    v.addEventListener('ratechange', onRate);

    console.log('[watchparty] attached to video on', site);
  }

  function detach(v) {
    v.removeEventListener('play', onPlay);
    v.removeEventListener('pause', onPause);
    v.removeEventListener('seeked', onSeek);
    v.removeEventListener('ratechange', onRate);
  }

  function suppressed() {
    return Date.now() < suppressUntil;
  }

  function onPlay() {
    if (suppressed()) return;
    send({ type: 'play', time: video.currentTime });
  }
  function onPause() {
    if (suppressed()) return;
    send({ type: 'pause', time: video.currentTime });
  }
  function onSeek() {
    if (suppressed()) return;
    if (Math.abs(video.currentTime - lastSeekTime) < 0.3) return;
    lastSeekTime = video.currentTime;
    send({ type: 'seek', time: video.currentTime });
  }
  function onRate() {
    if (suppressed()) return;
    send({ type: 'rate', rate: video.playbackRate });
  }

  function send(event) {
    chrome.runtime.sendMessage({ type: 'local-event', event }).catch(() => {});
  }

  function apply(event) {
    if (!video) return;
    suppressUntil = Date.now() + SUPPRESS_MS;
    switch (event.type) {
      case 'play':
        if (typeof event.time === 'number' && Math.abs(video.currentTime - event.time) > 1) {
          video.currentTime = event.time;
        }
        video.play().catch(() => {});
        break;
      case 'pause':
        video.pause();
        if (typeof event.time === 'number' && Math.abs(video.currentTime - event.time) > 1) {
          video.currentTime = event.time;
        }
        break;
      case 'seek':
        if (typeof event.time === 'number') {
          lastSeekTime = event.time;
          video.currentTime = event.time;
        }
        break;
      case 'rate':
        if (typeof event.rate === 'number') video.playbackRate = event.rate;
        break;
    }
  }

  // Observe DOM for video appearing / swapping (SPAs reuse pages).
  const observer = new MutationObserver(() => {
    const v = findVideo();
    if (v && v !== video) attach(v);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial check (may fire before player mounts).
  const v = findVideo();
  if (v) attach(v);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'remote-event') apply(msg.event);
  });
})();
