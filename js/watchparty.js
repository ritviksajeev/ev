/* ============================================
   Watchparty page — room create/join + live socket
   ============================================ */

(function () {
  'use strict';

  // Swap the prod URL for your Railway domain after deploy (https → wss).
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
  const linkWrap = $('room-link');
  const shareUrl = $('share-url');
  const peerList = $('peer-list');
  const eventLog = $('event-log');

  let ws = null;
  let currentRoom = null;

  // restore name from storage, hydrate room from URL (?room=abc)
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

  function renderPeers(names) {
    peerList.innerHTML = '';
    if (names.length === 0) {
      peerList.innerHTML = '<li class="peer-empty">Just you in here.</li>';
      return;
    }
    for (const n of names) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="peer-dot"></span>${escapeHtml(n)}`;
      peerList.appendChild(li);
    }
  }

  function logEvent(type, detail) {
    const first = eventLog.querySelector('.log-empty');
    if (first) first.remove();
    const li = document.createElement('li');
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.innerHTML = `<span class="ev-time">${t}</span><span class="ev-type">${escapeHtml(type)}</span>${escapeHtml(detail || '')}`;
    eventLog.insertBefore(li, eventLog.firstChild);
    while (eventLog.children.length > 50) eventLog.removeChild(eventLog.lastChild);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const peers = new Set();

  function connect(roomId) {
    if (ws) try { ws.close(); } catch {}
    peers.clear();
    renderPeers([]);

    const name = (inputName.value.trim() || 'anon').slice(0, 24);
    setStatus('connecting', `Connecting to ${roomId}…`);

    const url = `${SERVER.ws}/?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      setStatus('connected', `Connected — room ${roomId}`);
      currentRoom = roomId;
      const share = `${location.origin}${location.pathname}?room=${roomId}`;
      shareUrl.textContent = share;
      linkWrap.classList.remove('hidden');
      history.replaceState(null, '', `?room=${roomId}`);
      logEvent('joined', `room ${roomId} as ${name}`);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'welcome':
          msg.peers.forEach((n) => peers.add(n));
          renderPeers([...peers]);
          break;
        case 'peer-join':
          peers.add(msg.name);
          renderPeers([...peers]);
          logEvent('peer join', msg.name);
          break;
        case 'peer-leave':
          peers.delete(msg.name);
          renderPeers([...peers]);
          logEvent('peer leave', msg.name);
          break;
        case 'play':
          logEvent('play', `${msg.from} @ ${fmtTime(msg.time)}`);
          break;
        case 'pause':
          logEvent('pause', `${msg.from} @ ${fmtTime(msg.time)}`);
          break;
        case 'seek':
          logEvent('seek', `${msg.from} → ${fmtTime(msg.time)}`);
          break;
        case 'chat':
          logEvent('chat', `${msg.from}: ${msg.text}`);
          break;
      }
    });

    ws.addEventListener('close', (e) => {
      if (e.code === 4004) setStatus('error', 'Room not found');
      else if (e.code === 4001) setStatus('error', 'Room full');
      else setStatus('idle', 'Disconnected');
      currentRoom = null;
    });

    ws.addEventListener('error', () => {
      setStatus('error', 'Connection error — is the server running?');
    });
  }

  function fmtTime(s) {
    if (typeof s !== 'number') return '—';
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${r}`;
  }

  async function createRoom() {
    setStatus('connecting', 'Creating room…');
    btnCreate.disabled = true;
    try {
      const res = await fetch(`${SERVER.http}/room`, { method: 'POST' });
      if (!res.ok) throw new Error('server returned ' + res.status);
      const { roomId } = await res.json();
      inputRoom.value = roomId;
      connect(roomId);
    } catch (err) {
      setStatus('error', 'Could not reach server');
      logEvent('error', err.message);
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

  if (urlRoom) {
    // auto-connect if arriving with ?room=...
    setTimeout(() => connect(urlRoom), 200);
  }
})();
