# Sketch Fighter (working title)

Draw a fighting-game stage on an index card, photograph it with your phone, and fight on it seconds later.

This folder is a self-contained app (Flask + Phaser 3). It is not part of the static evzero.org site, but its static build is published there at **evzero.org/sketch/**. The full spec, with the amendments agreed while building, is in [`docs/SPEC.md`](docs/SPEC.md).

## Layout

```
backend/              Flask API; serves the built game from backend/static
  app.py              routes
  config.py           loads shared/*.json (the same files the game reads)
  physics.py          port of frontend/src/sim/physics.js (parity-tested)
  vision.py           photo -> 40 x 24 tile grid (OpenCV)
  stage_analysis.py   jump table, reachability, fixes, spawns, nav graph
  enrich.py           optional Gemini stage name / announcer line
  tools/              sample generators
  tests/              pytest
shared/
  game.json           physics + combat constants (Python and JS)
  vision.json         colour / coverage thresholds (tune on /debug)
  stage.schema.json   stage JSON contract between /api/scan and the game
  fixtures/           physics reference trajectories (written by the JS sim)
  stages/             sample stages built by the real pipeline (bundled into the web build)
frontend/             Vite + Phaser 3, plain ES modules
  src/sim/            fixed-step movement + tile collision (the one definition)
  src/scenes/         Boot, Home, Capture, Reveal, Fight, Result
  src/controls/       touch, keyboard, gamepad -> one six-button interface
  src/bot/            CPU (nav graph when the stage has one)
  src/debug/          /debug calibration page
samples/              synthetic card photos + ground truth
Dockerfile            Cloud Run / Railway image
```

## Try it on your phone

**Without a server (sample stages only):** open **evzero.org/sketch/**. It always plays in landscape: turn the phone sideways (it works with rotation lock on too). Everything except photo scanning works there.

**Everything, from your laptop on the same Wi-Fi:**

```sh
cd backend
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python app.py                         # API on :8080

cd ../frontend && npm install
npm run dev                           # prints a "Network" URL like http://192.168.1.20:5173
```

Open the Network URL on the phone. If it doesn't load, the laptop's firewall is blocking it, or the Wi-Fi isolates devices (common on venue and campus Wi-Fi). Turn on your phone's hotspot and connect the laptop to it.

For a production-like run, `npm run build`, then `python app.py` alone serves the game and the API on :8080 (use `http://<laptop-ip>:8080`).

## Deploy

### The game on evzero.org

```sh
cd frontend && npm run build:web      # writes ../../sketch (repo root)
```

Commit `sketch/` and push to `main`. GitHub Pages publishes it about a minute later. `.env.web` sets `VITE_API_BASE`. Leave it at `none` until the server is deployed, then set it to the server's URL (for example `https://sketch-fighter.up.railway.app`), rebuild and push again. Snap a stage then works from the website.

### The server

The API needs Python and OpenCV, so it runs as a container, as a single instance (the recent-stages gallery lives in memory).

**Railway** (you already use it for `server/`):
1. New project, then Deploy from GitHub repo, `ritviksajeev/ev`.
2. Settings, then Root Directory: `sketch-fighter`. Railway picks up the `Dockerfile` and `railway.json`.
3. Variables: `GEMINI_API_KEY`, `GEMINI_MODEL` (your Gemini Pro model name), `CORS_ORIGINS=https://evzero.org,https://www.evzero.org`, and `DEBUG_TOKEN` (any secret string, for saving calibration).
4. Settings, then Networking, then Generate Domain. That URL serves the whole game too, and goes into `VITE_API_BASE`.

**Cloud Run** (the original plan):

```sh
gcloud run deploy sketch-fighter --source . --region us-central1 \
  --min-instances 1 --max-instances 1 --cpu 2 --memory 1Gi --no-cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars GEMINI_MODEL=<model>,CORS_ORIGINS=https://evzero.org,DEBUG_TOKEN=<secret> \
  --set-secrets GEMINI_API_KEY=<secret-name>:latest
```

## Environment

All optional; see `.env.example`. The stage never waits on Gemini.

| Variable | What it does |
|---|---|
| `GEMINI_API_KEY` | Server-side only. Without it, stage names come from a local list. |
| `GEMINI_MODEL` | Model name (the team uses the latest Gemini Pro). Never hardcoded. Pro models think before answering, so `enrich.py` asks for minimal thinking and gives up after `GEMINI_TIMEOUT_S` (default 8). |
| `CORS_ORIGINS` | Sites allowed to call the API (evzero.org for the web build). |
| `DEBUG_TOKEN` | Required to save calibration from `/debug` on a public server. |
| `DATA_DIR` | Where scanned stages and photos are kept. |

## Calibrating at the venue

Marker colours shift under every light. Open `/debug` on the server, load a photo of a drawn card, and move the sliders: the warped card, each colour mask and the final grid update live, with the timing of every step. **Save** writes `shared/vision.json` on the server and downloads a copy. Commit that copy, since a redeploy resets the server's disk.

Drawing tips: blank (unruled) white index card, thick markers, dark table, whole card in frame.

## Shared config

Both sides read `shared/game.json`. The frontend bundles it at build time. At startup it compares its copy's hash with `/api/health`, and the Home chip turns amber if the server's file differs, which means the frontend needs a rebuild. Movement physics is defined once in `frontend/src/sim/physics.js`; `backend/physics.py` is a line-for-line port, and `backend/tests/test_physics.py` replays `shared/fixtures/physics.json` to keep them identical. After changing movement code or `game.json`, regenerate the fixture with `node frontend/scripts/physics-fixture.mjs`.

## Tests

```sh
cd backend && pytest                  # physics parity, vision accuracy, analysis, API
```

## Build phases

- [x] 0. Skeleton: Flask serving Vite + Phaser, shared config on both sides, Dockerfile
- [x] 1. Fight scene: movement, jumps, one-way platforms, keyboard
- [x] 2. Combat, KO, timer, Result
- [x] 3. Touch controls and mobile web (always landscape, safe areas, fullscreen on Android)
- [ ] 4. Vision pipeline, `/api/scan`, Capture, `/debug` (frontend done; backend in progress)
- [ ] 5. Stage analysis, Reveal (frontend done; backend in progress)
- [x] 6. CPU opponent (nav graph once stages carry one), attract mode
- [ ] 7. Gemini extras (in progress), gamepads (done), sound (done), polish, deploy
