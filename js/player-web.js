/* ============================================
   Watchparty web-player — YouTube + Twitch
   Mirrors the extension's protocol: sends {type:'play'|'pause'|'seek',time}
   via window.__watchparty.sendEvent(), receives via applyRemote().
   ============================================ */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const urlInput = $('input-url');
  const btnLoad = $('btn-load');
  const hostEl = $('player-host');
  const errEl = $('player-err');

  let currentPlayer = null;
  let suppressUntil = 0;
  const SUPPRESS_MS = 700;

  /* ---------- URL parsing ---------- */
  function parseUrl(raw) {
    const s = (raw || '').trim();
    if (!s) return null;
    let u;
    try { u = new URL(s); } catch { return null; }

    const host = u.hostname.replace(/^www\./, '');

    // YouTube
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        if (id) return { kind: 'youtube', id };
      }
      if (u.pathname.startsWith('/live/') || u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        if (id) return { kind: 'youtube', id };
      }
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return { kind: 'youtube', id };
    }

    // Twitch
    if (host === 'twitch.tv') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'videos' && parts[1]) return { kind: 'twitch-vod', id: parts[1] };
      if (parts[0]) return { kind: 'twitch-live', id: parts[0] };
    }

    return null;
  }

  /* ---------- SDK loaders (lazy) ---------- */
  let ytReady = null;
  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch {} resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
    return ytReady;
  }
  let twitchReady = null;
  function loadTwitch() {
    if (twitchReady) return twitchReady;
    twitchReady = new Promise((resolve, reject) => {
      if (window.Twitch && window.Twitch.Embed) return resolve();
      const s = document.createElement('script');
      s.src = 'https://embed.twitch.tv/embed/v1.js';
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return twitchReady;
  }

  /* ---------- Mount helpers ---------- */
  function resetMount() {
    hostEl.innerHTML = '<div id="player-mount"></div>';
  }

  /* ---------- YouTube wrapper ---------- */
  class YouTubePlayer {
    constructor(videoId) {
      this.lastT = 0;
      this.ready = false;
      this.player = new YT.Player('player-mount', {
        videoId,
        playerVars: {
          enablejsapi: 1, rel: 0, modestbranding: 1,
          playsinline: 1, origin: location.origin,
        },
        events: {
          onReady: () => { this.ready = true; this._startPoll(); },
          onStateChange: (e) => this._onState(e),
        },
      });
    }
    _onState(e) {
      if (Date.now() < suppressUntil) return;
      if (!this.player.getCurrentTime) return;
      const t = this.player.getCurrentTime() || 0;
      if (e.data === YT.PlayerState.PLAYING) emit({ type: 'play', time: t });
      else if (e.data === YT.PlayerState.PAUSED) emit({ type: 'pause', time: t });
    }
    _startPoll() {
      this.pollId = setInterval(() => {
        if (!this.ready || !this.player.getCurrentTime) return;
        const t = this.player.getCurrentTime() || 0;
        if (Date.now() < suppressUntil) { this.lastT = t; return; }
        // detect seek: jump > 1.5s away from expected forward drift
        if (Math.abs(t - (this.lastT + 0.5)) > 1.5) emit({ type: 'seek', time: t });
        this.lastT = t;
      }, 500);
    }
    play() { try { this.player.playVideo(); } catch {} }
    pause() { try { this.player.pauseVideo(); } catch {} }
    seek(t) { try { this.player.seekTo(t, true); this.lastT = t; } catch {} }
    getTime() { try { return this.player.getCurrentTime() || 0; } catch { return 0; } }
    destroy() {
      clearInterval(this.pollId);
      try { this.player.destroy(); } catch {}
    }
  }

  /* ---------- Twitch wrapper ---------- */
  class TwitchPlayer {
    constructor(kind, id) {
      this.isLive = kind === 'twitch-live';
      this.lastT = 0;
      const opts = {
        width: '100%', height: '100%',
        parent: [location.hostname],
        autoplay: false,
        layout: 'video',
        muted: false,
      };
      if (this.isLive) opts.channel = id;
      else opts.video = id;
      this.embed = new Twitch.Embed('player-mount', opts);
      this.embed.addEventListener(Twitch.Embed.VIDEO_READY, () => {
        this.player = this.embed.getPlayer();
        if (!this.isLive) this._startPoll();
      });
      this.embed.addEventListener(Twitch.Embed.VIDEO_PLAY, () => {
        if (Date.now() < suppressUntil) return;
        const t = this.player?.getCurrentTime?.() || 0;
        emit({ type: 'play', time: t });
      });
      this.embed.addEventListener(Twitch.Embed.VIDEO_PAUSE, () => {
        if (Date.now() < suppressUntil) return;
        const t = this.player?.getCurrentTime?.() || 0;
        emit({ type: 'pause', time: t });
      });
    }
    _startPoll() {
      this.pollId = setInterval(() => {
        const t = this.player?.getCurrentTime?.();
        if (typeof t !== 'number') return;
        if (Date.now() < suppressUntil) { this.lastT = t; return; }
        if (Math.abs(t - (this.lastT + 0.5)) > 1.5) emit({ type: 'seek', time: t });
        this.lastT = t;
      }, 500);
    }
    play() { try { this.player?.play(); } catch {} }
    pause() { try { this.player?.pause(); } catch {} }
    seek(t) { if (this.isLive) return; try { this.player?.seek(t); this.lastT = t; } catch {} }
    getTime() { try { return this.player?.getCurrentTime() || 0; } catch { return 0; } }
    destroy() {
      clearInterval(this.pollId);
      this.embed = null; this.player = null;
    }
  }

  /* ---------- Load / apply ---------- */
  async function loadParsed(parsed) {
    if (currentPlayer) { currentPlayer.destroy(); currentPlayer = null; }
    resetMount();
    hostEl.classList.remove('hidden');
    errEl.classList.add('hidden');
    try {
      if (parsed.kind === 'youtube') {
        await loadYT();
        currentPlayer = new YouTubePlayer(parsed.id);
      } else if (parsed.kind === 'twitch-live' || parsed.kind === 'twitch-vod') {
        await loadTwitch();
        currentPlayer = new TwitchPlayer(parsed.kind, parsed.id);
      } else {
        showError('Unsupported link');
      }
    } catch {
      showError('Failed to load player');
    }
  }

  function applyRemote(ev) {
    if (!currentPlayer) return;
    suppressUntil = Date.now() + SUPPRESS_MS;
    const hasT = typeof ev.time === 'number';
    if (ev.type === 'play') {
      if (hasT && Math.abs(currentPlayer.getTime() - ev.time) > 1) currentPlayer.seek(ev.time);
      currentPlayer.play();
    } else if (ev.type === 'pause') {
      if (hasT && Math.abs(currentPlayer.getTime() - ev.time) > 1) currentPlayer.seek(ev.time);
      currentPlayer.pause();
    } else if (ev.type === 'seek' && hasT) {
      currentPlayer.seek(ev.time);
    }
  }

  function emit(ev) {
    if (window.__watchparty && typeof window.__watchparty.sendEvent === 'function') {
      window.__watchparty.sendEvent(ev);
    }
  }

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }

  /* ---------- UI wiring ---------- */
  btnLoad.addEventListener('click', () => {
    const parsed = parseUrl(urlInput.value);
    if (!parsed) { showError('Paste a YouTube or Twitch URL'); return; }
    loadParsed(parsed);
    if (window.__watchparty && typeof window.__watchparty.sendLoad === 'function') {
      window.__watchparty.sendLoad(parsed);
    }
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btnLoad.click(); }
  });

  /* ---------- Exposed for watchparty.js ---------- */
  window.__webplayer = {
    applyLoad: (p) => { if (p && p.kind && p.id) loadParsed(p); },
    applyRemote,
    reset: () => {
      if (currentPlayer) { currentPlayer.destroy(); currentPlayer = null; }
      hostEl.classList.add('hidden');
      resetMount();
    },
  };
})();
