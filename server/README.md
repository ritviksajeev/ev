# evzero watchparty — server

Tiny WebSocket relay for the watchparty extension. No persistence, no auth yet — just rooms + event fanout.

## Run locally

```bash
cd server
npm install
npm run dev
```

Server listens on `http://localhost:8787`.

## HTTP endpoints

- `GET /health` — `{ ok, rooms }`
- `POST /room` — creates a room, returns `{ roomId }`

## WebSocket

Connect to `ws://localhost:8787/?room=<id>&name=<displayName>`.

### Client → server messages

```json
{ "type": "play",  "time": 42.0 }
{ "type": "pause", "time": 42.0 }
{ "type": "seek",  "time": 120.5 }
{ "type": "rate",  "rate": 1.5 }
{ "type": "chat",  "text": "hi" }
{ "type": "ping",  "t": 12345 }
```

### Server → client messages

```json
{ "type": "welcome",    "roomId": "abc123", "peers": ["alice"], "state": null }
{ "type": "peer-join",  "name": "bob" }
{ "type": "peer-leave", "name": "bob" }
{ "type": "play",  "time": 42.0, "from": "alice" }
{ "type": "pause", "time": 42.0, "from": "alice" }
{ "type": "seek",  "time": 120.5, "from": "alice" }
{ "type": "rate",  "rate": 1.5,   "from": "alice" }
{ "type": "chat",  "text": "hi",  "from": "alice" }
{ "type": "pong",  "t": 12345 }
```

Close codes: `4001` room full, `4004` unknown room.

## Deploy to Railway

1. Push the repo to GitHub.
2. [railway.com/new](https://railway.com/new) → **Deploy from GitHub repo** → pick this repo.
3. Set **Root Directory** to `server` (under service settings → Source).
4. Railway auto-detects Node via Nixpacks; no extra config needed. `PORT` is injected automatically.
5. Under **Settings → Networking**, click **Generate Domain**. Copy the `*.up.railway.app` URL.
6. Replace the placeholder in two places with that URL (swap `https` → `wss`, `http` → `https`):
   - `js/watch.js` — the `SERVER` constant
   - `extension/background.js` — the `FLY_SERVER` constant (keep the name or rename — just the URL matters)
