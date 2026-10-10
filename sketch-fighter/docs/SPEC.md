# Sketch Fighter: build spec

Draw a fighting-game stage on paper, photograph it with your phone, and fight on it seconds later. Mobile web first.

This is the original team spec, followed by the amendments agreed while building. Where they conflict, **the amendments win**.

## Context

- 22-hour hackathon, team of two. Judges spend 1-2 minutes at the table and score functionality, creativity and technical difficulty.
- Demo: a judge adds a few platforms to a pre-drawn index card, photographs it on a phone, sees the stage built in seconds, and fights on it.
- Reliability and speed beat features.
- Must work on iPhone Safari and Android Chrome in landscape. Also playable on a laptop with keyboard or gamepad.
- All art, names and sounds must be original. Nothing from Smash Bros, Brawlhalla or any other existing game.

## Hard requirements

1. Photo to playable stage in under 5 s on decent Wi-Fi. Server-side processing (vision + stage analysis) under 1.5 s.
2. Gemini never blocks stage creation. The stage is built from OpenCV alone; Gemini only adds optional extras asynchronously.
3. Every server step logs its duration, and the scan response includes a `timings` object.
4. The Gemini model name comes from `GEMINI_MODEL`. Never hardcode a model name. The key stays server-side (`GEMINI_API_KEY`).
5. Physics constants live in one shared config file (`shared/game.json`) read by both the Python analyzer and the game.

## Stack

- Backend: Python 3.11, Flask, opencv-python-headless, NumPy, google-genai. Serves the API and the built frontend.
- Frontend: Vite + Phaser 3.90, plain JS ES modules.
- Deployment: Dockerfile for Cloud Run, single instance (min 1, max 1).

## Shared config (`shared/game.json`)

tileSize 24; grid 40 x 24 (stage 960 x 576 px); canvas 1280 x 720 with the stage centred.
Blast zones: KO when a fighter leaves the canvas by more than 120 px left/right/bottom or 200 px top.
gravity 1500, jumpVelocity 570, doubleJumpVelocity 500, runSpeed 260, maxFallSpeed 900. Fighter hitbox 18 x 34.
validatorPessimism 0.9: the analyzer assumes jumps (and run speed) are 90% as strong as they are.

## Drawing legend

Black marker = solid ground. Blue marker = pass-through platform (jump up through it, land on top, hold down to drop). Red marker = hazard. Anything else is ignored.

## Stage JSON

The contract is `shared/stage.schema.json`. Tile codes: 0 empty, 1 solid, 2 pass-through, 3 hazard, 4 added by a fix (rendered highlighted, behaves as solid). Grid coordinates are `[col, row]`, row 0 at the top; `tiles[row][col]`.

## Vision pipeline (`backend/vision.py`)

The client sends an already-resized JPEG (long side 1280).
1. Decode with `cv2.imdecode`.
2. Find the card: grayscale, blur, Canny, contours, largest 4-point polygon via `approxPolyDP`. Order corners, perspective-warp to 1000 x 600. No card found: fall back to the whole image and set `cardDetected: false`.
3. Normalize lighting, convert to HSV.
4. One mask per legend colour, thresholds from `shared/vision.json`. Red uses two hue ranges. Black is low value and low saturation.
5. Dilate each mask slightly so thin marker lines become solid.
6. Sample into the 40 x 24 grid: a tile gets a colour if that colour's coverage in the cell exceeds its threshold. Priority: hazard, then solid, then pass-through.
7. Clean up: remove isolated single tiles, fill one-tile holes inside solid areas.

## Stage analysis (`backend/stage_analysis.py`), target < 300 ms

- Jump table, computed once at startup from game.json: simulate jumps, double jumps and walking off ledges with a fixed timestep, the fighter hitbox and the pessimism factor, over a spread of horizontal input timings. For each move record the landing offset and the tiles the hitbox sweeps, so checking a move is a lookup. Pass-through tiles block only when falling onto them from above.
- Standable node: an empty tile with a solid or pass-through tile directly below, enough headroom for the hitbox, no hazard.
- Reachability: BFS over standable nodes using walk, fall, jump and double-jump moves.
- Checks, each with an automatic fix (at most 10 candidate fixes per check, 3 rounds total; every fix recorded with cells and a short message):
  1. Main stage = the largest connected group of standable nodes. Almost no ground: add a default flat stage across the bottom third.
  2. Unreachable platforms: add a small stepping platform within jump range, or remove the platform if no step can be placed.
  3. Recovery: from off-stage points near each edge (a few tiles out and below), a double-jump arc must land back on stage; else add a short ledge.
  4. Enclosed pockets: flood fill empty space from the canvas edges; empty regions not connected to open air get opened by removing the fewest solid tiles.
  5. Fair spawns: two standable nodes on the main stage, roughly mirrored around the stage centre, far apart, with similar distances to their nearest edges.
- Nav graph: standable nodes and the edges between them with move type, for the CPU.
- Unit tests (pytest) on handcrafted grids: flat stage, unreachable floating platform, sealed box, unrecoverable edge, empty card. Full pipeline on every photo in /samples under 1.5 s.

## API

- `POST /api/scan`: multipart image -> stage JSON. Saves the stage in memory and on disk.
- `POST /api/stages/<id>/enrich`: optional Gemini extras. Never on the critical path.
- `GET /api/stages/<id>`, `GET /api/stages/<id>/photo`, `GET /api/stages` (recent stages for attract mode / gallery).
- Debug variant (`debug=1`): also returns intermediate images (warped card, each mask, grid) as base64.

## Gemini extras (`backend/enrich.py`)

Sends the warped card image, asks for structured JSON: `stageName` (2-4 words), `announcerLine` (one short sentence), `accentColor` (hex). 8 s timeout. Any failure: a random name from a local list. The game behaves identically either way.

## Game

Scenes: Home (title, "Snap a stage", "Play a sample stage", small How-to-draw legend), Capture (camera input, preview, upload progress, retake), Reveal (photo, scan-line sweep, tiles assemble, fixes pulse in the highlight colour with messages, stage name fades in when Gemini returns, then FIGHT), Fight, Result (winner, Rematch, New stage), Attract (laptop on the table: loops recent stages with two CPUs; tap or key -> Home), Debug.

Fighters: two original fighters drawn in code. Run, jump, one double jump, drop through pass-through platforms by holding down.

Combat (numbers in game.json): quick 50/100/150 ms, 5%, base 220, growth 7, 35 deg; strong 220/120/300 ms, 13%, base 320, growth 11, 45 deg. Short-lived hitboxes in front of the attacker, one hit per attack per target. Launch speed = base + growth x (target damage % after the hit), away from the attacker at the attack angle. Hitstun = launch speed x 0.35 ms, max 700 ms, no inputs during hitstun. 60 ms hit-pause and a small screen shake on strong hits. KO on crossing a blast zone; off-screen indicator bubble. 1 stock, 30 s timer; on time-out the lower damage % wins. Big damage % in the HUD.

CPU: moves on the nav graph toward the node nearest the player; attacks in range with a small random reaction delay; off stage steers to the nearest ledge and double-jumps. Default difficulty easy: judges should usually win.

Controls: one interface (`left, right, down, jump, quick, strong`). Touch: floating joystick on the left 40% (down drops through), Jump (largest), Quick, Strong buttons >= 64 CSS px, multi-touch, light vibration on hit. Keyboard: A/D, S, W/Space, J, K; P2 arrows, Numpad1, Numpad2. Gamepad: stick/D-pad, A jump, X quick, B strong, two pads for local 2P. Phones: 1P vs CPU. Laptop: 1P vs CPU and local 2P.

Mobile web: viewport `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`; safe-area insets; no scroll / zoom / pull-to-refresh / selection; fullscreen + landscape lock where supported (Android); unlock audio on first tap.

Capture: `<input type="file" accept="image/*" capture="environment">`; always re-encode on the client (createImageBitmap with imageOrientation from-image, fallback `<img>`; long side 1280; JPEG 0.85); show upload progress then go straight into Reveal; on `cardDetected: false` still show the stage but offer Retake.

Debug page at `/debug` (not linked): upload a photo, see every intermediate image, sliders for each HSV and coverage threshold with live re-processing, Save writes `shared/vision.json`, timing breakdown.

Out of scope: online multiplayer, accounts, character select, shields, ledge grabs, items, multiple stocks, any existing game's assets or names.

---

## Amendments (agreed)

1. **Code lives in `sketch-fighter/`** of the evzero.org repo. `sketch/` at the repo root is the static web build served at evzero.org/sketch/ (GitHub Pages, no server). The API runs separately (Cloud Run or Railway); the web build reaches it via `VITE_API_BASE`, and Flask allows that origin via `CORS_ORIGINS`.
2. **One movement model, two ports.** Fighter movement and tile collision are a small custom fixed-step simulation, not Phaser Arcade: `frontend/src/sim/physics.js` is the reference and `backend/physics.py` is a line-for-line port. `shared/fixtures/physics.json` (written by `frontend/scripts/physics-fixture.mjs`) must be reproduced by the Python port to 1e-9. Physics runs at `physics.fps` (120 Hz). Per step: timers, horizontal control, jump, then integrate (vy += g dt, clamp to maxFallSpeed, x += vx dt, resolve X, y += vy dt, resolve Y).
3. **Pessimism** scales `jumpVelocity`, `doubleJumpVelocity` and `runSpeed` by `validatorPessimism` for the analyzer only.
4. **Hazards collide like solid ground** and hurt on contact (`combat.hazard`: damage, upward knockback, cooldown). The analyzer treats them as blocking, never standable, and a move whose hitbox touches one is invalid.
5. **Knockback** decays at `physics.knockbackDecay` px/s^2 horizontally; launch speed is capped at `physics.maxLaunchSpeed` so nothing moves more than a tile per step. Being hit refreshes the double jump.
6. **Drop-through**: holding down ignores pass-through tiles, and for `dropThroughMs` after release.
7. **Nav graph edges** are `[from, to, type, moveId]` with types walk, fall, drop, jump, double_jump and `navGraph.moves[]` input recipes `{type, dir, holdFromMs, holdUntilMs, doubleJumpAtMs}`. The CPU uses recipes for timing and steers toward the target node in closed loop.
8. **Fixes** carry `op: "add" | "remove"`; types `default_stage`, `added_step`, `removed_platform`, `added_ledge`, `opened_pocket`.
9. **UI is HTML over the canvas** (menus, HUD, touch controls), styled after evzero.org. Phaser draws the stage and fighters only.
10. **Always landscape.** When the viewport is portrait (phone held upright or rotation lock on), the whole app is rotated 90 degrees with CSS so it plays in landscape anyway; touch coordinates are mapped back. No vw/vh units in UI CSS: container units (`cqw`/`cqh`) of the landscape app box instead.
11. **Vision**: blank (unruled) cards; morphological open before dilate to drop thin printed lines; flat-field normalisation (divide by a heavily blurred copy) before CLAHE. Grid size comes from game.json only.
12. **Server**: gunicorn 1 worker x 8 threads. Gallery seeded from `/samples` at startup. `/debug` save requires `DEBUG_TOKEN` when set and also offers a download.
13. **Sample stages** for the web build are produced by the real pipeline from the sample photos and bundled, so "Play a sample stage" and the CPU work with no server.
14. **Gemini Pro.** The team's key is for the latest Gemini **Pro** model; it goes in `GEMINI_MODEL` at deploy time (still never hardcoded). Pro models think before answering and are slower than Flash, so `enrich.py` must: ask for minimal thinking in a model-agnostic way (try `thinking_config` with `thinking_level="low"` as the Gemini 3 family expects; if the API rejects that config, retry once without it, all inside the time limit), keep the prompt and image small (the 1000 x 600 warped card as JPEG ~80), use structured output (`response_mime_type="application/json"` + `response_schema`), and make the timeout configurable via `GEMINI_TIMEOUT_S` (default 8). The frontend fires the enrich request the moment a scan returns and never waits for it; the name fades in whenever it arrives.
15. **One player for now.** Phones and laptops both play you vs the CPU (keyboard, gamepad or touch); the local 2-player mode is removed. No hosting needed: the server runs on the laptop (`dev.cmd`) and phones on the same Wi-Fi use it. The Gemini key lives in `sketch-fighter/.env`.
16. **Analyzer checks moves at both strengths.** A move counts only if it is valid with pessimistic physics and with real physics and both land on the same platform; the edge targets where the real jump lands. (Pessimistic-only let full-strength jumps bonk ceilings or land on higher pass-through platforms.) The CPU follows a recipe step-exactly: jump or press down on step 0, the second jump on step round(doubleJumpAtMs x fps / 1000), no direction before holdFromMs, then steer onto the target node and stop within 3 px.
17. **Knockback decay 800** (was 1200), so strong hits KO from about 45-55% near a ledge and 80% mid-stage and 30-second matches can end in a KO.
