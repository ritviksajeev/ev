"""Flask app: the JSON API plus the built frontend (backend/static, produced by `npm run build`)."""

import logging
import os
import time
from pathlib import Path

from flask import Flask, g, jsonify, request

from config import GAME_HASH

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sketch")

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


@app.before_request
def _start_timer():
    g.t0 = time.perf_counter()


@app.after_request
def _log_request(response):
    if request.path.startswith("/api/"):
        ms = (time.perf_counter() - g.t0) * 1000
        log.info("%s %s -> %d in %.1f ms", request.method, request.path, response.status_code, ms)
    return response


@app.get("/api/health")
def health():
    return jsonify(
        ok=True,
        configHash=GAME_HASH,
        gemini=bool(os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_MODEL")),
    )


@app.get("/")
def index():
    if (STATIC_DIR / "index.html").exists():
        return app.send_static_file("index.html")
    return (
        "<p>Frontend not built. Run <code>npm run build</code> in <code>frontend/</code>, "
        "or use the Vite dev server on port 5173.</p>",
        200,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), debug=True)
