const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const roomInput = $('room');
const btnCreate = $('btn-create');
const btnJoin = $('btn-join');
const btnLeave = $('btn-leave');
const statusEl = $('status');
const statusDot = statusEl.querySelector('.dot');
const statusText = statusEl.querySelector('.status-text');
const controls = $('room-controls');
const active = $('room-active');
const roomCode = $('room-code');
const peersEl = $('peers');

function render(state) {
  nameInput.value = state.name || '';

  if (state.roomId && state.connected) {
    statusDot.className = 'dot connected';
    statusText.textContent = 'Connected';
    controls.classList.add('hidden');
    active.classList.remove('hidden');
    roomCode.textContent = state.roomId;
    peersEl.innerHTML = state.peers.length
      ? state.peers.map((n) => `<div class="peer">${escape(n)}</div>`).join('')
      : 'Just you in here.';
  } else if (state.roomId && !state.connected) {
    statusDot.className = 'dot connecting';
    statusText.textContent = 'Connecting…';
  } else if (state.lastError) {
    statusDot.className = 'dot error';
    statusText.textContent = state.lastError;
    controls.classList.remove('hidden');
    active.classList.add('hidden');
  } else {
    statusDot.className = 'dot idle';
    statusText.textContent = 'Not connected';
    controls.classList.remove('hidden');
    active.classList.add('hidden');
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function send(msg) {
  return new Promise((r) => chrome.runtime.sendMessage(msg, r));
}

async function refresh() {
  const { state } = await send({ type: 'get-state' });
  render(state);
}

nameInput.addEventListener('change', async () => {
  await send({ type: 'set-name', name: nameInput.value.trim() });
});
btnCreate.addEventListener('click', async () => {
  btnCreate.disabled = true;
  await send({ type: 'create-room' });
  btnCreate.disabled = false;
});
btnJoin.addEventListener('click', async () => {
  const id = roomInput.value.trim();
  if (!id) return;
  await send({ type: 'join-room', roomId: id });
});
roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });
btnLeave.addEventListener('click', async () => {
  await send({ type: 'leave-room' });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'state') render(msg.state);
});

refresh();
