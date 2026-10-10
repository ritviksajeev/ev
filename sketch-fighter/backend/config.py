"""Loads the shared config files that the game and the stage analyzer both read."""

import json
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path):
    """KEY=value lines from sketch-fighter/.env, so the Gemini key needs no shell setup.

    Variables already set in the environment win; empty values are skipped.
    """
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
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
