"""Photo bytes -> stage JSON (shared/stage.schema.json): vision, then analysis."""

import logging
import secrets
import string
import time
from datetime import datetime, timezone

import stage_analysis
import vision
from config import GAME

log = logging.getLogger("sketch")

_ID_CHARS = string.ascii_lowercase + string.digits


def new_id():
    return "".join(secrets.choice(_ID_CHARS) for _ in range(8))


def build_stage(photo, vision_cfg=None, debug=False, stage_id=None, source="scan"):
    """Returns (stage, warped BGR image). Raises ValueError if the photo can't be decoded."""
    t0 = time.perf_counter()
    seen = vision.scan_image(photo, vision_cfg, debug=debug)
    result = stage_analysis.analyze(seen["grid"])
    timings = {**seen["timings"], **result["timings"], "total": (time.perf_counter() - t0) * 1000}

    sid = stage_id or new_id()
    stage = {
        "version": 1,
        "id": sid,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": source,
        "cols": GAME["cols"],
        "rows": GAME["rows"],
        "tileSize": GAME["tileSize"],
        "tiles": result["tiles"],
        "spawns": result["spawns"],
        "fixes": result["fixes"],
        "navGraph": result["navGraph"],
        "cardDetected": bool(seen["cardDetected"]),
        "photoUrl": f"/api/stages/{sid}/photo",
        "timings": {k: round(float(v), 1) for k, v in timings.items()},
        "extras": None,
    }
    if debug:
        stage["debug"] = seen["debug"]
    log.info("scan %s: %s", sid, ", ".join(f"{k} {v:.1f} ms" for k, v in stage["timings"].items()))
    return stage, seen["warped"]
