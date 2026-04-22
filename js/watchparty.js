/* ============================================
   Watchparty page — room create/join + live socket
   ============================================ */

(function () {
  'use strict';

  const SERVER = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? { http: 'http://localhost:8787', ws: 'ws://localhost:8787' }
    : { http: 'https://ev-production.up.railway.app', ws: 'wss://ev-production.up.railway.app' };

  const $ = (id) => document.getElementById(id);
  const btnCreate = $('btn-create');
  const btnJoin = $('btn-join');
  const btnCopy = $('btn-copy');
  const inputRoom = $('input-room');
  const inputName = $('input-name');
  const statusEl = $('room-status');
  const statusDot = statusEl.querySelector('.status-dot');
  const statusText = statusEl.querySelector('.status-text');
  const peerChips = $('peer-chips');
  const linkWrap = $('room-link');
  const shareUrl = $('share-url');
  const playerPanel = $('player-panel');

  let ws = null;
  let currentRoom = null;

  const storedName = localStorage.getItem('evz-watch-name');
  if (storedName) inputName.value = storedName;
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) inputRoom.value = urlRoom;
  inputName.addEventListener('change', () => {
    localStorage.setItem('evz-watch-name', inputName.value.trim());
  });

  function setStatus(kind, text) {
    statusDot.className = 'status-dot ' + kind;
    statusText.textContent = text;
  }

  function lobbyLabel() {
    const n = peers.size + 1; // +1 for self (server's peer list excludes us)
    return n === 1 ? 'just you' : `${n} in lobby`;
  }
  function refreshConnected() {
    if (currentRoom && ws && ws.readyState === WebSocket.OPEN) {
      setStatus('connected', `Room ${currentRoom} · ${lobbyLabel()}`);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const peers = new Set();
  function renderPeers() {
    peerChips.innerHTML = [...peers]
      .map((n) => `<span class="peer-chip" title="${escapeHtml(n)}">${escapeHtml(n)}</span>`)
      .join('');
    refreshConnected();
  }

  function connect(roomId) {
    if (ws) try { ws.close(); } catch {}
    peers.clear();
    renderPeers();

    const name = (inputName.value.trim() || 'anon').slice(0, 24);
    setStatus('connecting', `Connecting…`);

    const url = `${SERVER.ws}/?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      currentRoom = roomId;
      refreshConnected();
      const share = `${location.origin}${location.pathname}?room=${roomId}`;
      shareUrl.textContent = share;
      linkWrap.classList.remove('hidden');
      if (playerPanel) playerPanel.classList.remove('hidden');
      history.replaceState(null, '', `?room=${roomId}`);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'welcome':
          (msg.peers || []).forEach((n) => peers.add(n));
          renderPeers();
          // catch-up for late joiners
          if (msg.load && window.__webplayer) {
            window.__webplayer.applyLoad(msg.load);
            if (msg.playback && msg.playback.type) {
              setTimeout(() => window.__webplayer.applyRemote(msg.playback), 1500);
            }
          }
          break;
        case 'peer-join':
          peers.add(msg.name);
          renderPeers();
          break;
        case 'peer-leave':
          peers.delete(msg.name);
          renderPeers();
          break;
        case 'load':
          if (window.__webplayer) window.__webplayer.applyLoad({ kind: msg.kind, id: msg.id });
          break;
        case 'play':
        case 'pause':
        case 'seek':
        case 'rate':
          if (window.__webplayer) window.__webplayer.applyRemote(msg);
          break;
      }
    });

    ws.addEventListener('close', (e) => {
      currentRoom = null;
      if (e.code === 4004) setStatus('error', 'Room not found');
      else if (e.code === 4001) setStatus('error', 'Room full');
      else setStatus('idle', 'Disconnected');
      peers.clear();
      renderPeers();
      if (playerPanel) playerPanel.classList.add('hidden');
      if (window.__webplayer) window.__webplayer.reset();
    });

    ws.addEventListener('error', () => {
      setStatus('error', 'Connection error');
    });
  }

  async function createRoom() {
    setStatus('connecting', 'Creating room…');
    btnCreate.disabled = true;
    try {
      const res = await fetch(`${SERVER.http}/room`, { method: 'POST' });
      if (!res.ok) throw new Error('server ' + res.status);
      const { roomId } = await res.json();
      inputRoom.value = roomId;
      connect(roomId);
    } catch {
      setStatus('error', 'Could not reach server');
    } finally {
      btnCreate.disabled = false;
    }
  }

  btnCreate.addEventListener('click', createRoom);
  btnJoin.addEventListener('click', () => {
    const id = inputRoom.value.trim();
    if (!id) return;
    connect(id);
  });
  inputRoom.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });

  btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.textContent);
      btnCopy.textContent = 'Copied';
      setTimeout(() => { btnCopy.textContent = 'Copy'; }, 1200);
    } catch {}
  });

  if (urlRoom) setTimeout(() => connect(urlRoom), 200);

  // install instructions toggle
  const btnHow = $('btn-how');
  const howEl = $('install-how');
  if (btnHow && howEl) {
    btnHow.addEventListener('click', () => {
      const nowHidden = howEl.classList.toggle('hidden');
      btnHow.textContent = nowHidden ? 'Install steps' : 'Hide steps';
    });
  }

  // Exposed for player-web.js to push video events to the server
  window.__watchparty = {
    sendEvent(ev) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
    },
    sendLoad(parsed) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'load', kind: parsed.kind, id: parsed.id }));
      }
    },
  };
})();
