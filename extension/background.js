// Service worker — owns the WebSocket, relays between popup and content script.

const SERVER = {
  http: 'https://ev-production.up.railway.app',
  ws: 'wss://ev-production.up.railway.app',
};

let ws = null;
let state = {
  roomId: null,
  name: 'anon',
  connected: false,
  peers: [],
  lastError: null,
};

async function loadState() {
  const stored = await chrome.storage.local.get(['name']);
  if (stored.name) state.name = stored.name;
}
loadState();

function server() {
  return SERVER;
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
}

function sendToContentScripts(msg) {
  chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://*.netflix.com/*', '*://*.twitch.tv/*'] }, (tabs) => {
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, msg).catch(() => {});
    }
  });
}

function closeWS() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  state.connected = false;
  state.peers = [];
}

async function createRoom() {
  state.lastError = null;
  broadcastState();
  try {
    const res = await fetch(`${server().http}/room`, { method: 'POST' });
    if (!res.ok) throw new Error('server ' + res.status);
    const { roomId } = await res.json();
    return roomId;
  } catch (e) {
    state.lastError = 'Could not reach server';
    broadcastState();
    throw e;
  }
}

function joinRoom(roomId) {
  closeWS();
  state.roomId = roomId;
  state.lastError = null;
  broadcastState();

  const url = `${server().ws}/?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(state.name)}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    state.connected = true;
    broadcastState();
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.type) {
      case 'welcome':
        state.peers = msg.peers || [];
        broadcastState();
        break;
      case 'peer-join':
        if (!state.peers.includes(msg.name)) state.peers.push(msg.name);
        broadcastState();
        break;
      case 'peer-leave':
        state.peers = state.peers.filter((n) => n !== msg.name);
        broadcastState();
        break;
      case 'play':
      case 'pause':
      case 'seek':
      case 'rate':
        sendToContentScripts({ type: 'remote-event', event: msg });
        break;
    }
  });

  ws.addEventListener('close', (e) => {
    state.connected = false;
    if (e.code === 4004) state.lastError = 'Room not found';
    else if (e.code === 4001) state.lastError = 'Room full';
    state.roomId = null;
    broadcastState();
  });

  ws.addEventListener('error', () => {
    state.lastError = 'Connection error';
    broadcastState();
  });
}

function leaveRoom() {
  closeWS();
  state.roomId = null;
  broadcastState();
}

function wsSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'get-state':
        sendResponse({ state });
        break;
      case 'set-name':
        state.name = (msg.name || 'anon').slice(0, 24);
        await chrome.storage.local.set({ name: state.name });
        broadcastState();
        sendResponse({ ok: true });
        break;
      case 'create-room':
        try {
          const roomId = await createRoom();
          joinRoom(roomId);
          sendResponse({ ok: true, roomId });
        } catch {
          sendResponse({ ok: false });
        }
        break;
      case 'join-room':
        joinRoom(msg.roomId);
        sendResponse({ ok: true });
        break;
      case 'leave-room':
        leaveRoom();
        sendResponse({ ok: true });
        break;
      case 'local-event':
        wsSend(msg.event);
        sendResponse({ ok: true });
        break;
    }
  })();
  return true;
});
