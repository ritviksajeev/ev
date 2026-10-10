"""Optional Gemini extras for a stage: a name, an announcer line and an accent colour.

Never on the critical path and never raises: without GEMINI_API_KEY and
GEMINI_MODEL, on a timeout, or on any error, it returns a name from a local
list. The model name only ever comes from the environment.
"""

import json
import logging
import os
import re
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

log = logging.getLogger("sketch")

# Hung calls run out their own clock here instead of holding request threads.
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gemini")
_clients = {}

PROMPT = (
    "This is a photo of an index card on which someone drew a level for a 2D platform "
    "fighting game: black marker is solid ground, blue marker is a platform you can jump "
    "through, red marker is a hazard. Give the stage a fun, original name of 2 to 4 words "
    "inspired by what is drawn (never the name of an existing game, character or franchise), "
    "one short announcer line of at most 10 words, and an accent colour that suits it as "
    "#rrggbb. Bright colours that read well on a near-black background."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "stageName": {"type": "string"},
        "announcerLine": {"type": "string"},
        "accentColor": {"type": "string"},
    },
    "required": ["stageName", "announcerLine", "accentColor"],
}

FALLBACK_NAMES = [
    "Margin Notes", "Graphite Gulch", "Eraser Flats", "Sticky Note Summit", "Ruled Ridge",
    "Doodle Docks", "Index Island", "Inkwell Heights", "Spiral Bound", "Paper Cut Pass",
    "Highlighter Hollow", "Staple Street", "Crumple Canyon", "Ballpoint Bluffs",
    "Sketchbook Spire", "Folded Corner", "Smudge Valley", "Blue Line Bay", "Scribble Station",
    "Notebook Narrows", "Red Pen Ravine", "Tracing Terrace", "Pencil Shavings", "Draft Zero",
]
FALLBACK_LINES = [
    "Pencils down. Fists up.",
    "Fresh ink, fresh bruises.",
    "Drawn by hand, settled by hand.",
    "Mind the red lines.",
    "Every scribble counts.",
    "No erasers in this arena.",
    "Stay on the page.",
    "Somebody is getting crossed out.",
]
FALLBACK_COLORS = ["#a78bfa", "#6aff9a", "#ffc857", "#5b8cff", "#ff7ab6", "#7ae7ff"]

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def fallback(seed=""):
    """A deterministic local name for a stage id."""
    h = zlib.crc32(str(seed).encode())
    return {
        "stageName": FALLBACK_NAMES[h % len(FALLBACK_NAMES)],
        "announcerLine": FALLBACK_LINES[(h >> 8) % len(FALLBACK_LINES)],
        "accentColor": FALLBACK_COLORS[(h >> 16) % len(FALLBACK_COLORS)],
        "source": "fallback",
    }


def enrich(warped_jpeg, seed=""):
    """Gemini extras for the warped card image, or the fallback. Never raises."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    model = os.environ.get("GEMINI_MODEL", "").strip()
    if not key or not model or not warped_jpeg:
        return fallback(seed)

    timeout = _timeout()
    t0 = time.perf_counter()
    future = _pool.submit(_ask, key, model, warped_jpeg, timeout)
    try:
        extras = _clean(future.result(timeout=timeout), seed)
        log.info("enrich (%s): %.0f ms", model, (time.perf_counter() - t0) * 1000)
        return extras
    except FutureTimeout:
        log.warning("enrich (%s): no answer within %.1f s, using a local name", model, timeout)
    except Exception as e:  # noqa: BLE001 - any failure falls back
        # Exception text can echo request details; never let the key reach a log.
        log.warning("enrich (%s) failed: %s: %s", model, type(e).__name__, str(e).replace(key, "***")[:200])
    return fallback(seed)


def _timeout():
    try:
        return max(1.0, float(os.environ.get("GEMINI_TIMEOUT_S", "8")))
    except ValueError:
        return 8.0


def _client(key, timeout):
    from google import genai
    from google.genai import types

    if key not in _clients:
        _clients[key] = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=int(timeout * 1000)))
    return _clients[key]


def _ask(key, model, image, timeout):
    """One structured-output call. Pro models think before answering, so ask for as
    little thinking as the model accepts: a thinking level (Gemini 3), else a small
    thinking budget (Gemini 2.5), else the model's default."""
    from google.genai import errors, types

    client = _client(key, timeout)
    contents = [types.Part.from_bytes(data=image, mime_type="image/jpeg"), PROMPT]
    thinking = [
        types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        types.ThinkingConfig(thinking_budget=128),
        None,
    ]
    for i, think in enumerate(thinking):
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SCHEMA,
            temperature=1.0,
            thinking_config=think,
        )
        try:
            response = client.models.generate_content(model=model, contents=contents, config=config)
        except errors.ClientError as e:
            # 400 = this model doesn't take that thinking setting; try the next one.
            if e.code == 400 and i < len(thinking) - 1:
                continue
            raise
        return response.parsed if isinstance(response.parsed, dict) else json.loads(response.text)
    raise RuntimeError("no thinking setting accepted")


def _clean(data, seed):
    """Validate the model's answer; fill any bad field from the fallback."""
    base = fallback(seed)
    name = " ".join(str(data.get("stageName", "")).split())
    line = " ".join(str(data.get("announcerLine", "")).split())
    color = str(data.get("accentColor", "")).strip()
    if not 1 <= len(name.split()) <= 5 or len(name) > 40:
        name = base["stageName"]
    if not line or len(line) > 120:
        line = base["announcerLine"]
    if not HEX.match(color):
        color = base["accentColor"]
    return {"stageName": name, "announcerLine": line, "accentColor": color.lower(), "source": "gemini"}
