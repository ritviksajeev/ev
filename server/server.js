import http from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

const PORT = process.env.PORT || 8787;
const MAX_ROOM_SIZE = 8;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;

/** @type {Map<string, { clients: Set<WebSocket>, createdAt: number, lastState: any }>} */
const rooms = new Map();

const http_server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (req.url === '/room' && req.method === 'POST') {
    const id = randomBytes(3).toString('hex');
    rooms.set(id, { clients: new Set(), createdAt: Date.now(), lastState: null });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ roomId: id }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ server: http_server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const roomId = url.searchParams.get('room');
  const name = (url.searchParams.get('name') || 'anon').slice(0, 32);

  if (!roomId || !rooms.has(roomId)) {
    ws.close(4004, 'unknown room');
    return;
  }

  const room = rooms.get(roomId);
  if (room.clients.size >= MAX_ROOM_SIZE) {
    ws.close(4001, 'room full');
    return;
  }

  ws.roomId = roomId;
  ws.name = name;
  room.clients.add(ws);

  broadcast(roomId, { type: 'peer-join', name }, ws);
  send(ws, { type: 'welcome', roomId, peers: peerNames(roomId, ws), state: room.lastState });

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'play':
      case 'pause':
      case 'seek':
      case 'rate':
        room.lastState = { type: msg.type, time: msg.time, rate: msg.rate, at: Date.now() };
        broadcast(roomId, { ...msg, from: name }, ws);
        break;
      case 'chat':
        if (typeof msg.text === 'string' && msg.text.length <= 500) {
          broadcast(roomId, { type: 'chat', text: msg.text, from: name }, ws);
        }
        break;
      case 'ping':
        send(ws, { type: 'pong', t: msg.t });
        break;
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    broadcast(roomId, { type: 'peer-leave', name });
    if (room.clients.size === 0) {
      setTimeout(() => {
        const r = rooms.get(roomId);
        if (r && r.clients.size === 0) rooms.delete(roomId);
      }, 60_000);
    }
  });
});

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(roomId, obj, except) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(obj);
  for (const c of room.clients) {
    if (c !== except && c.readyState === 1) c.send(payload);
  }
}
function peerNames(roomId, except) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.clients].filter((c) => c !== except).map((c) => c.name);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && now - room.createdAt > ROOM_TTL_MS) rooms.delete(id);
  }
}, 60_000);

http_server.listen(PORT, () => {
  console.log(`[watchparty] listening on :${PORT}`);
});
