"""Flask app: the JSON API plus the built frontend (backend/static, produced by `npm run build`)."""

import copy
import hmac
import json
import logging
import os
import time
from pathlib import Path

from flask import Flask, g, jsonify, request, send_file
from werkzeug.exceptions import HTTPException

import enrich as gemini
import vision
from config import APP_DIR, GAME_HASH, SHARED_DIR, load_vision
from pipeline import build_stage
from store import Store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sketch")

STATIC_DIR = Path(__file__).resolve().parent / "static"
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent / "data"))
CORS_ORIGINS = {
    o.strip().rstrip("/")
    for o in os.environ.get("CORS_ORIGINS", "https://evzero.org,https://www.evzero.org,http://localhost:5173").split(",")
    if o.strip()
}

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
store = Store(DATA_DIR)


def _seed_samples():
    """Sample stages from shared/stages/samples.json, so the gallery is never empty."""
    path = SHARED_DIR / "stages" / "samples.json"
    if not path.is_file():
        return
    for stage in json.loads(path.read_text(encoding="utf-8")):
        stage = {**stage, "photoUrl": f"/api/stages/{stage['id']}/photo"}
        photo = APP_DIR / "samples" / f"card-{stage['id'].split('-')[-1]}.jpg"
        store.add_sample(stage, photo)


_seed_samples()


# ---------- request plumbing ----------


@app.before_request
def _start_timer():
    g.t0 = time.perf_counter()


@app.after_request
def _after(response):
    if request.path.startswith("/api/"):
        origin = request.headers.get("Origin", "").rstrip("/")
        if origin in CORS_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
        response.headers.add("Vary", "Origin")
        ms = (time.perf_counter() - g.t0) * 1000
        log.info("%s %s -> %d in %.1f ms", request.method, request.path, response.status_code, ms)
    return response


@app.errorhandler(HTTPException)
def _http_error(e):
    if request.path.startswith("/api/"):
        messages = {413: "That photo is too big (10 MB max)", 404: "Not found"}
        return jsonify(error=messages.get(e.code, e.description)), e.code
    return e


@app.errorhandler(Exception)
def _crash(e):
    log.exception("unhandled error on %s", request.path)
    return jsonify(error="Something went wrong on the server"), 500


def _error(message, code):
    return jsonify(error=message), code


# ---------- API ----------


@app.get("/api/health")
def health():
    return jsonify(
        ok=True,
        configHash=GAME_HASH,
        gemini=bool(os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_MODEL")),
    )


@app.post("/api/scan")
def scan():
    upload = request.files.get("image")
    photo = upload.read() if upload else b""
    if not photo:
        return _error("Send the photo as the multipart field 'image'", 400)

    # The /debug page re-scans with its slider values; those scans aren't kept.
    debug = request.args.get("debug") == "1"
    vision_cfg = None
    if debug and request.form.get("vision"):
        try:
            overrides = json.loads(request.form["vision"])
        except ValueError:
            return _error("'vision' must be JSON", 400)
        if not isinstance(overrides, dict):
            return _error("'vision' must be a JSON object", 400)
        vision_cfg = _merge(load_vision(), overrides)

    try:
        stage, warped = build_stage(photo, vision_cfg, debug=debug)
    except ValueError:
        return _error("That file doesn't look like a photo", 400)
    except (KeyError, TypeError):
        if vision_cfg is not None:
            return _error("Those vision settings are incomplete", 400)
        raise

    if debug:
        stage["photoUrl"] = None
    else:
        store.put(stage, photo, vision.encode_jpeg(warped, quality=80))
    return jsonify(stage)


@app.get("/api/stages")
def stages():
    return jsonify(stages=store.recent(20))


@app.get("/api/stages/<sid>")
def stage(sid):
    found = store.get(sid)
    return jsonify(found) if found else _error("No such stage", 404)


@app.get("/api/stages/<sid>/photo")
def photo(sid):
    path = store.file(sid, "photo")
    if not path:
        return _error("No photo for that stage", 404)
    return send_file(path, mimetype="image/jpeg", max_age=3600)


@app.post("/api/stages/<sid>/enrich")
def enrich(sid):
    found = store.get(sid)
    if not found:
        return _error("No such stage", 404)
    if found.get("extras"):
        return jsonify(extras=found["extras"])
    path = store.file(sid, "warped")
    extras = gemini.enrich(path.read_bytes() if path else b"", seed=sid)
    store.set_extras(sid, extras)
    return jsonify(extras=extras)


# ---------- calibration (/debug) ----------


@app.get("/api/debug/vision")
def get_vision():
    return jsonify(load_vision())


@app.post("/api/debug/vision")
def save_vision():
    token = os.environ.get("DEBUG_TOKEN", "")
    if token:
        if not hmac.compare_digest(request.headers.get("X-Debug-Token", ""), token):
            return _error("Wrong or missing X-Debug-Token", 403)
    elif request.remote_addr not in ("127.0.0.1", "::1"):
        # No token configured: only the machine running the server may write.
        return _error("Set DEBUG_TOKEN on the server to save from another machine", 403)

    new = request.get_json(silent=True)
    current = load_vision()
    problem = _shape_mismatch(current, new)
    if problem:
        return _error(f"vision.json not saved: {problem}", 400)
    path = SHARED_DIR / "vision.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(new, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    log.info("vision.json saved from /debug")
    return jsonify(ok=True)


def _merge(base, overrides):
    out = copy.deepcopy(base)
    for k, v in overrides.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _shape_mismatch(want, got, path="vision"):
    """None if `got` has exactly the keys and value types of `want`."""
    if isinstance(want, dict):
        if not isinstance(got, dict):
            return f"{path} must be an object"
        if set(want) != set(got):
            return f"{path} keys differ ({', '.join(sorted(set(want) ^ set(got)))})"
        for k in want:
            problem = _shape_mismatch(want[k], got[k], f"{path}.{k}")
            if problem:
                return problem
        return None
    if isinstance(want, list):
        if not isinstance(got, list) or not got:
            return f"{path} must be a non-empty list"
        return next((p for p in (_shape_mismatch(want[0], item, f"{path}[]") for item in got) if p), None)
    if isinstance(want, bool) or isinstance(got, bool):
        return None if isinstance(got, bool) == isinstance(want, bool) else f"{path} must be true/false"
    if isinstance(want, (int, float)):
        return None if isinstance(got, (int, float)) else f"{path} must be a number"
    return None if isinstance(got, type(want)) else f"{path} has the wrong type"


# ---------- the game ----------


@app.get("/")
def index():
    if (STATIC_DIR / "index.html").exists():
        return app.send_static_file("index.html")
    return (
        "<p>Frontend not built. Run <code>npm run build</code> in <code>frontend/</code>, "
        "or use the Vite dev server on port 5173.</p>",
        200,
    )


@app.get("/debug")
def debug_page():
    if (STATIC_DIR / "debug.html").exists():
        return app.send_static_file("debug.html")
    return "<p>Build the frontend first (npm run build), or open /debug.html on the Vite dev server.</p>", 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=True)
