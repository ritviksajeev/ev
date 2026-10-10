"""Loads the shared config files that the game and the stage analyzer both read."""

import json
import logging
import math
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path):
    """KEY=value lines from sketch-fighter/.env, so the Gemini key needs no shell setup.

    Variables already set in the environment win; empty values are skipped. Copes with what
    Windows editors write: a UTF-8 byte-order mark, UTF-16 ("Unicode" in Notepad), CRLF. Also
    accepts `export KEY=value` and a ` # comment` after an unquoted value.
    """
    if not path.is_file():
        return
    raw = path.read_bytes()
    try:
        if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            text = raw.decode("utf-16")
        else:
            text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        logging.getLogger("sketch").warning("%s is not UTF-8 text (%s): save it as UTF-8; ignoring it", path, e)
        return
    for line in text.splitlines():
        key, sep, value = line.strip().partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if value[:1] in ("'", '"') and value[1:].find(value[0]) >= 0:
            value = value[1:1 + value[1:].find(value[0])]  # quoted: taken literally, up to the closing quote
        else:
            value = value.split(" #", 1)[0].split("\t#", 1)[0].strip()
        if sep and key and not key.startswith("#") and value:
            os.environ.setdefault(key, value)


_load_dotenv(APP_DIR / ".env")

SHARED_DIR = Path(os.environ.get("SHARED_DIR", APP_DIR / "shared"))


def fnv1a32(text):
    """32-bit FNV-1a over UTF-16 code units. frontend/src/config.js has the same function."""
    data = text.encode("utf-16-le")
    h = 0x811C9DC5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def _read_text(name):
    # Strip CR so a Windows checkout hashes the same as the browser bundle.
    return (SHARED_DIR / name).read_text(encoding="utf-8").replace("\r", "")


GAME_RAW = _read_text("game.json")
GAME = json.loads(GAME_RAW)
GAME_HASH = fnv1a32(GAME_RAW)


def load_vision():
    """Re-read on every call so values saved from /debug apply without a restart."""
    return json.loads(_read_text("vision.json"))


# --- vision.json validation (shared by the /debug save and /api/scan?debug=1 overrides) ---------
#
# Ranges per leaf key. Values outside them crash OpenCV (claheTileGrid 0 is a division by zero in
# C that kills the server process; a negative blur or a fractional warp size raises) or ask it for
# gigabytes. (kind, min, max): kind "int" needs a whole JSON number, "num" any finite number.
_VISION_RANGES = {
    "width": ("int", 100, 4000),
    "height": ("int", 100, 4000),
    "blur": ("int", 0, 63),
    "cannyLow": ("num", 0, 1000),
    "cannyHigh": ("num", 0, 1000),
    "approxEpsilon": ("num", 0, 0.5),
    "minContrast": ("num", 0, 255),
    "flatFieldKernel": ("int", 1, 1001),
    "claheClipLimit": ("num", 0, 100),
    "claheTileGrid": ("int", 1, 64),
    "hMin": ("num", 0, 179),
    "hMax": ("num", 0, 179),
    "sMin": ("num", 0, 255),
    "sMax": ("num", 0, 255),
    "vMin": ("num", 0, 255),
    "vMax": ("num", 0, 255),
}


def _vision_range(key):
    if key in _VISION_RANGES:
        return _VISION_RANGES[key]
    if key.endswith("Px"):
        return ("int", 0, 50)
    if key.endswith("Fraction") or key == "coverage":
        return ("num", 0, 1)
    return None


def _shape_problem(want, got, path):
    """None if `got` has exactly the keys and value kinds of `want` (lists: every item like want[0])."""
    if isinstance(want, dict):
        if not isinstance(got, dict):
            return f"{path} must be an object"
        if set(want) != set(got):
            return f"{path} keys differ ({', '.join(sorted(set(want) ^ set(got)))})"
        for k in want:
            problem = _shape_problem(want[k], got[k], f"{path}.{k}")
            if problem:
                return problem
        return None
    if isinstance(want, list):
        if not isinstance(got, list) or not got:
            return f"{path} must be a non-empty list"
        return next((p for p in (_shape_problem(want[0], item, f"{path}[]") for item in got) if p), None)
    if isinstance(want, bool) or isinstance(got, bool):
        return None if isinstance(got, bool) == isinstance(want, bool) else f"{path} must be true/false"
    if isinstance(want, (int, float)):
        return None if isinstance(got, (int, float)) else f"{path} must be a number"
    return None if isinstance(got, type(want)) else f"{path} has the wrong type"


def _range_problem(value, path):
    if isinstance(value, dict):
        return next((p for k, v in value.items() if (p := _range_problem(v, f"{path}.{k}"))), None)
    if isinstance(value, list):
        return next((p for v in value if (p := _range_problem(v, f"{path}[]"))), None)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return f"{path} must be a finite number"
    rule = _vision_range(path.rsplit(".", 1)[-1])
    if rule is None:
        return None
    kind, lo, hi = rule
    if kind == "int" and not isinstance(value, int):
        return f"{path} must be a whole number"
    if not lo <= value <= hi:
        return f"{path} must be between {lo} and {hi}"
    return None


def vision_problem(cfg, reference=None):
    """None if cfg is a usable vision config: the same shape as `reference` (default: the saved
    shared/vision.json) and every number finite and within the range OpenCV can work with."""
    reference = load_vision() if reference is None else reference
    return _shape_problem(reference, cfg, "vision") or _range_problem(cfg, "vision")
