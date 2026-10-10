# Sketch Fighter (working title)

Draw a fighting-game stage on an index card, photograph it with your phone, and fight on it seconds later.

This folder is a self-contained app (Flask + Phaser 3). It is not part of the static evzero.org site.

## Layout

```
backend/     Flask API + serves the built frontend from backend/static
  app.py     routes
  config.py  loads shared/*.json (same files the game reads)
  tests/     pytest
shared/
  game.json          physics + combat constants (Python and JS both read this)
  vision.json        HSV / coverage thresholds for the photo pipeline
  stage.schema.json  the stage JSON contract between /api/scan and the game
frontend/    Vite + Phaser 3, plain ES modules
  src/scenes/  Boot, Home, ... (one file per scene)
  src/ui/      HTML overlay for menus and HUD
samples/     sample card photos (tests, "Play a sample stage", attract mode)
Dockerfile   Cloud Run image (builds the frontend, then serves everything)
```

## Run locally

Backend (Python 3.11):

```sh
cd backend
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python app.py                  # http://localhost:8080
```

Frontend, either:

```sh
cd frontend && npm install
npm run dev     # http://localhost:5173, proxies /api to :8080, reachable from a phone on the LAN
npm run build   # writes backend/static, then the Flask server alone serves the game on :8080
```

Tests: `cd backend && pytest`.

### On the website (evzero.org/sketch/)

`npm run build:web` writes a static build to `sketch/` at the repo root. Commit it and push to `main`; GitHub Pages publishes it at evzero.org/sketch/ about a minute later. That build has no server behind it (`.env.web` sets `VITE_API_BASE=none`), so it covers everything up to photo scanning. Once the API is on Cloud Run, point `VITE_API_BASE` at it.

Both sides read `shared/game.json`. The frontend bundles it at build time; on start it compares its copy's hash with `/api/health` and logs a warning (and the Home chip turns amber) if the server's file differs, which means the frontend needs a rebuild.

## Environment

See `.env.example`. Both are optional; the stage never waits on Gemini.

- `GEMINI_API_KEY`: server-side only.
- `GEMINI_MODEL`: the model name. Not hardcoded anywhere.

## Deploy (Cloud Run)

One instance, always warm, so the in-memory stage gallery stays consistent:

```sh
gcloud run deploy sketch-fighter --source . --region us-central1 \
  --min-instances 1 --max-instances 1 --cpu 2 --memory 1Gi --no-cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars GEMINI_MODEL=<model> --set-secrets GEMINI_API_KEY=<secret>:latest
```

The image runs gunicorn with 1 worker and 8 threads. More workers would each hold their own gallery.

## Stage JSON

The contract is `shared/stage.schema.json`. In short:

- `tiles[row][col]`, 24 rows x 40 cols, row 0 at the top. 0 empty, 1 solid, 2 pass-through, 3 hazard, 4 added by a fix (behaves as solid).
- Grid coordinates are `[col, row]` everywhere. A spawn is the empty tile a fighter's feet occupy.
- `fixes[]`: `{type, op: "add"|"remove", cells, message}`, already applied to `tiles`.
- `navGraph`: `nodes` (standable tiles), `edges` as `[from, to, type, moveId]`, and `moves[]`, the input recipes the analyzer verified so the CPU can replay them.
- `cardDetected`, `photoUrl`, `timings` (ms per server step plus `total`), `extras` (`null` until Gemini or the fallback names the stage).

## Build phases

- [x] 0. Skeleton: Flask serving Vite + Phaser, shared config on both sides, Dockerfile
- [ ] 1. Fight scene on a hardcoded stage: movement, jumps, one-way platforms, keyboard
- [ ] 2. Combat, KO, timer, Result
- [ ] 3. Touch controls and mobile web details
- [ ] 4. Vision pipeline, `/api/scan`, Capture, `/debug`
- [ ] 5. Stage analysis (jump table, checks, fixes, spawns, nav graph), Reveal
- [ ] 6. CPU opponent, Attract mode
- [ ] 7. Gemini extras, gamepads, sound, polish, deploy
