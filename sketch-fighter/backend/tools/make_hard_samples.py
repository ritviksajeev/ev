"""Harder synthetic phone photos of drawn index cards, with ground truth, for the adversarial vision tests.

Each case is one hard-but-realistic condition a judge's photo at a hackathon table can have (steep
perspective, a small card, tungsten light, a hard shadow, motion blur, a light-grey table, a glare
spot, fine-tip strokes, pencil guide lines, an orange-ish red, a purple-ish blue, a portrait photo,
an upside-down card), plus a few combinations and some beyond-fair stress cases.

Nothing is written into samples/. render(case) returns (jpeg bytes, truth grid) in memory, and
    python -m tools.make_hard_samples [out_dir]          (from backend/)
writes card JPEGs + truth JSON to out_dir (a new temp folder by default) and prints how
vision.scan_image does on each: tile agreement, per-colour recall/precision, card found, time.

Colours are given as the ratio the phone records against bare paper (BGR), like tools/make_samples.py,
so the flat-field step in vision.py sees the same numbers. Hue notes use OpenCV units (0-179).
"""

import json
import math
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from config import GAME

COLS, ROWS = GAME["cols"], GAME["rows"]
EMPTY, SOLID, PASS, HAZARD = 0, 1, 2, 3
TILE = 30  # card render resolution (px per tile) before it is photographed
CARD_ASPECT = 5 / 3

INKS = {
    SOLID: (0.10, 0.10, 0.12),  # fresh black permanent marker
    PASS: (0.66, 0.33, 0.10),  # blue marker, hue ~108
    HAZARD: (0.18, 0.16, 0.82),  # red marker, hue ~179/0
}
DRY_BLACK = (0.40, 0.40, 0.43)  # a drying-out black marker, or a phone tone curve lifting the shadows
ORANGE_RED = (0.10, 0.44, 0.92)  # red that photographs orange-ish: hue ~12.4, S ~228
RED_ORANGE = (0.12, 0.34, 0.90)  # a warmer red: hue ~8.5, inside the stock range but near its edge
PURPLE_BLUE = (0.66, 0.22, 0.40)  # blue that photographs purple-ish (ballpoint / violet-blue): hue ~132
VIOLET_BLUE = (0.70, 0.24, 0.34)  # bluer violet: hue ~128, inside the stock range but near its edge

TABLES = {  # (reflectance BGR, texture)
    "walnut": ((0.10, 0.15, 0.22), "wood"),
    "slate": ((0.15, 0.15, 0.14), "fine"),
    "lightgrey": ((0.60, 0.61, 0.60), "fine"),  # pale laminate / folding table: low contrast with the card
    "palegrey": ((0.74, 0.75, 0.74), "fine"),  # beyond fair: nearly paper-coloured
}
LIGHTS = {
    "neutral": (1.0, 1.0, 1.0),
    "tungsten": (0.64, 0.90, 1.12),  # 2700 K bulbs, phone white balance only partly corrects (R/B ~1.75)
}

# Shapes use tile coordinates, rows and cols inclusive (same as tools/make_samples.py):
#   ("block", code, r0, r1, c0, c1)   filled marker area
#   ("stroke", code, r, r, c0, c1)    one marker line along row r
#   ("zigzag", HAZARD, r, r, c0, c1)  red spikes across one row
STAGE_A = [  # a typical judge's card: ground, three platforms, a lava strip, a hazard block
    ("block", SOLID, 17, 19, 6, 33),
    ("stroke", PASS, 12, 12, 9, 16),
    ("stroke", PASS, 12, 12, 23, 30),
    ("stroke", PASS, 7, 7, 15, 24),
    ("zigzag", HAZARD, 16, 16, 17, 22),
    ("block", HAZARD, 4, 5, 3, 6),
]
STAGE_B = [  # side towers, bridges, a pit
    ("block", SOLID, 15, 20, 2, 8),
    ("block", SOLID, 15, 20, 31, 37),
    ("block", SOLID, 9, 10, 17, 22),
    ("stroke", PASS, 15, 15, 10, 29),
    ("stroke", PASS, 6, 6, 4, 11),
    ("stroke", PASS, 6, 6, 28, 35),
    ("zigzag", HAZARD, 21, 21, 10, 29),
]

BASE = {"frame": (1280, 960), "cover": 0.30, "pitch": 12.0, "roll": 4.0, "yaw": 6.0, "z": 4.2,
        "table": "walnut", "light": "neutral", "exposure": 1.0, "stroke": (0.78, 0.95), "shapes": STAGE_A}

# fair=True: a judge's photo of a clearly visible card should scan right (the tests hold it to
# the fair targets). fair=False: beyond fair, documented only (never raises, right shapes).
CASES = [
    {"name": "perspective-28", "seed": 11, "fair": True, "pitch": 28.0, "roll": 9.0, "yaw": 12.0, "z": 3.4},
    {"name": "perspective-25-sideways-tilt", "seed": 12, "fair": True, "pitch": 14.0, "roll": 25.0, "yaw": -15.0,
     "z": 3.4, "shapes": STAGE_B},
    {"name": "small-card-25pct", "seed": 13, "fair": True, "cover": 0.25, "pitch": 18.0},
    {"name": "tungsten", "seed": 14, "fair": True, "light": "tungsten", "exposure": 0.85, "noise": 5.0},
    {"name": "hard-shadow", "seed": 15, "fair": True, "shadow": {"depth": 0.45, "softness": 3.0, "angle": 30.0}},
    {"name": "hard-shadow-across-ink", "seed": 16, "fair": True, "shapes": STAGE_B,
     "shadow": {"depth": 0.5, "softness": 2.0, "angle": 100.0, "offset": 0.05}},
    {"name": "hard-shadow-half-light", "seed": 32, "fair": True,
     "shadow": {"depth": 0.5, "softness": 10.0, "angle": 30.0}},
    {"name": "hard-shadow-60pct", "seed": 33, "fair": True, "shadow": {"depth": 0.6, "softness": 2.0, "angle": 0.0}},
    {"name": "motion-blur", "seed": 17, "fair": True, "motion": 9},
    {"name": "lightgrey-table", "seed": 18, "fair": True, "table": "lightgrey"},
    {"name": "glare-spot", "seed": 19, "fair": True, "glare": {"strength": 0.55, "sigma": 1.6, "at": (18, 14)}},
    {"name": "glare-on-blue-and-red", "seed": 20, "fair": True,
     "glare": {"strength": 0.5, "sigma": 2.0, "at": (14, 18)}},
    {"name": "thin-strokes", "seed": 21, "fair": True, "stroke": (0.38, 0.5), "zigzag": (0.2, 0.25)},
    {"name": "pencil-guides", "seed": 22, "fair": True, "pencil": True},
    {"name": "red-photographs-orange", "seed": 23, "fair": True, "inks": {HAZARD: ORANGE_RED}},
    {"name": "red-photographs-red-orange", "seed": 24, "fair": True, "inks": {HAZARD: RED_ORANGE}},
    {"name": "blue-photographs-purple", "seed": 25, "fair": True, "inks": {PASS: PURPLE_BLUE}},
    {"name": "blue-photographs-violet", "seed": 26, "fair": True, "inks": {PASS: VIOLET_BLUE}},
    {"name": "portrait-photo-card-across", "seed": 27, "fair": True, "frame": (960, 1280), "cover": 0.32},
    {"name": "portrait-photo-card-sideways-cw", "seed": 28, "fair": True, "frame": (960, 1280), "yaw": 90.0 + 5},
    {"name": "portrait-photo-card-sideways-ccw", "seed": 29, "fair": True, "frame": (960, 1280), "yaw": -90.0 - 4,
     "shapes": STAGE_B},
    {"name": "judge-at-table", "seed": 30, "fair": True, "pitch": 26.0, "roll": 7.0, "yaw": -9.0, "z": 3.6,
     "cover": 0.3, "table": "lightgrey", "light": "tungsten", "exposure": 0.9, "motion": 5, "pencil": True,
     "shadow": {"depth": 0.35, "softness": 6.0, "angle": 200.0}, "glare": {"strength": 0.4, "sigma": 1.5, "at": (8, 30)}},
    {"name": "judge-fine-tip-shadow", "seed": 31, "fair": True, "pitch": 25.0, "z": 3.6, "cover": 0.28,
     "stroke": (0.4, 0.55), "light": "tungsten", "shadow": {"depth": 0.4, "softness": 3.0, "angle": 60.0},
     "motion": 5, "shapes": STAGE_B},
    # Documented behaviour, not a fair accuracy target:
    {"name": "upside-down", "seed": 40, "fair": False, "yaw": 180.0 + 6, "upside_down": True},
    {"name": "upside-down-across-table", "seed": 41, "fair": False, "yaw": 180.0 - 8, "pitch": 24.0, "z": 3.6,
     "upside_down": True, "shapes": STAGE_B},
    # A fingertip pinning a curling card flat, over an empty corner. Skin is orange-red (hue ~8-15),
    # which is also what a wider hazard hue range would start to pick up.
    {"name": "fingertip-on-corner-light-skin", "seed": 42, "fair": True, "pitch": 15.0,
     "thumb": {"at": (24, 38), "length": 7.0, "width": 3.6, "skin": (0.52, 0.62, 0.86)}},
    {"name": "fingertip-on-corner-dark-skin", "seed": 43, "fair": True, "pitch": 15.0, "light": "tungsten",
     "thumb": {"at": (24, 2), "length": 7.0, "width": 3.6, "skin": (0.20, 0.30, 0.50)}},
    # Beyond fair: documented only.
    {"name": "x-dry-black-marker", "seed": 50, "fair": False, "inks": {SOLID: DRY_BLACK}, "motion": 5},
    {"name": "x-palegrey-table", "seed": 51, "fair": False, "table": "palegrey"},
    {"name": "x-deep-hard-shadow", "seed": 52, "fair": False, "shadow": {"depth": 0.65, "softness": 2.0, "angle": 0.0}},
    {"name": "x-tiny-card-15pct-steep", "seed": 53, "fair": False, "cover": 0.15, "pitch": 35.0, "z": 3.2},
    {"name": "x-heavy-motion-blur", "seed": 54, "fair": False, "motion": 17},
]


def case(name):
    """The full spec of one case by name (BASE filled in)."""
    for spec in CASES:
        if spec["name"] == name:
            return {**BASE, **spec}
    raise KeyError(name)


def truth_grid(shapes):
    grid = np.zeros((ROWS, COLS), np.uint8)
    for _, code, r0, r1, c0, c1 in shapes:
        grid[r0:r1 + 1, c0:c1 + 1] = code
    return grid


# --- the card ----------------------------------------------------------------------------------

def _wobble(rng, n, lo, hi, samples_per_knot=6):
    knots = rng.uniform(lo, hi, n // samples_per_knot + 2)
    return np.interp(np.linspace(0, len(knots) - 1, n), np.arange(len(knots)), knots)


def _paper(rng, h, w):
    tint = rng.uniform(0.93, 0.97) * np.array([rng.uniform(0.96, 0.99), 1.0, rng.uniform(1.0, 1.02)])
    low = cv2.resize(rng.normal(0, 1, (5, 8)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.8)
    return np.clip((1 + 0.02 * low + 0.03 * grain)[..., None] * tint, 0, 1).astype(np.float32)


def _fill_alpha(rng, shape, polygon):
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.round(polygon * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    streaks = 0.84 + 0.16 * cv2.GaussianBlur(rng.uniform(0, 1, shape).astype(np.float32), (0, 0), 4)
    x0, y0 = polygon.min(0).astype(int)
    x1, y1 = polygon.max(0).astype(int)
    specks = np.zeros(shape, np.uint8)
    for _ in range(int((x1 - x0) * (y1 - y0) / TILE ** 2 * 0.3)):
        cv2.circle(specks, (int(rng.uniform(x0, x1)), int(rng.uniform(y0, y1))), int(rng.integers(1, 4)), 255, -1)
    streaks = np.where(specks > 0, streaks * 0.45, streaks)
    return mask.astype(np.float32) / 255 * streaks * rng.uniform(0.93, 0.99)


def _block_polygon(rng, r0, r1, c0, c1):
    corners = np.array([(c0, r0), (c1 + 1, r0), (c1 + 1, r1 + 1), (c0, r1 + 1)], float)
    points = []
    for i in range(4):
        start, side = corners[i], corners[(i + 1) % 4] - corners[i]
        length = math.hypot(*side)
        inward = np.array([-side[1], side[0]]) / length
        n = max(4, int(length * 4))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        points.append(start + t * side + _wobble(rng, n, -0.10, 0.20)[:, None] * inward)
    return np.concatenate(points) * TILE


def _polyline_alpha(rng, shape, points, width):
    mask = np.zeros(shape, np.uint8)
    widths = width * TILE * (1 + _wobble(rng, len(points) - 1, -0.08, 0.08))
    pts = np.round(points * TILE * 16).astype(np.int32)
    for p, q, w in zip(pts[:-1], pts[1:], widths):
        cv2.line(mask, tuple(map(int, p)), tuple(map(int, q)), 255, max(1, int(round(w))), cv2.LINE_AA, shift=4)
    streaks = 0.88 + 0.12 * cv2.GaussianBlur(rng.uniform(0, 1, shape).astype(np.float32), (0, 0), 2)
    return mask.astype(np.float32) / 255 * streaks * rng.uniform(0.92, 0.99)


def _stroke_points(rng, r, c0, c1, width):
    x0 = c0 + width / 2 + rng.uniform(-0.12, 0.2)
    x1 = c1 + 1 - width / 2 - rng.uniform(-0.12, 0.2)
    xs = np.linspace(x0, x1, max(8, int((x1 - x0) * 3)))
    slope = rng.uniform(-0.1, 0.1) * np.linspace(-1, 1, len(xs))
    ys = r + 0.5 + rng.uniform(-0.05, 0.05) + slope + _wobble(rng, len(xs), -0.06, 0.06)
    return np.stack([xs, ys], 1)


def _zigzag_points(rng, r, c0, c1, width):
    period = rng.uniform(0.75, 0.95)
    xs = np.arange(c0 + 0.15, c1 + 0.9, period / 2)
    top, bottom = r + width / 2 + 0.04, r + 1 - width / 2 - 0.04
    ys = np.where(np.arange(len(xs)) % 2 == 0, bottom, top) + rng.uniform(-0.04, 0.04, len(xs))
    return np.stack([xs + rng.uniform(-0.05, 0.05, len(xs)), ys], 1)


def _pencil(rng, card):
    """Faint pencil: ruled guide lines across the card, sketchy strokes, and an outline that was never inked."""
    h, w = card.shape[:2]
    alpha = np.zeros((h, w), np.uint8)
    line_px = max(2, int(round(0.12 * TILE)))  # a 0.5 mm pencil line on a 5-inch card
    for row in (8.0, 13.0, 18.0, 21.6):  # ruled guides, some on a tile boundary, some mid-tile
        y = int((row + rng.uniform(-0.1, 0.1)) * TILE)
        cv2.line(alpha, (int(0.3 * TILE), y), (int((COLS - 0.3) * TILE), y + int(rng.uniform(-6, 6))), 255,
                 line_px, cv2.LINE_AA)
    for col in (10.0, 20.0, 30.0):  # vertical guides
        x = int(col * TILE)
        cv2.line(alpha, (x, int(0.5 * TILE)), (x + int(rng.uniform(-6, 6)), int((ROWS - 0.5) * TILE)), 255,
                 line_px, cv2.LINE_AA)
    cv2.rectangle(alpha, (int(25 * TILE), int(2 * TILE)), (int(35 * TILE), int(3.4 * TILE)), 255, line_px,
                  cv2.LINE_AA)  # a platform planned in pencil and never inked
    for _ in range(6):  # sketchy hatching
        p = np.array([rng.uniform(0, w), rng.uniform(0, h)])
        q = p + rng.uniform(-200, 200, 2)
        cv2.line(alpha, tuple(map(int, p)), tuple(map(int, q)), 255, line_px, cv2.LINE_AA)
    graphite = 0.55  # the darkest a pencil line gets on the card (HB, pressed lightly: faint)
    opacity = alpha.astype(np.float32)[..., None] / 255 * rng.uniform(0.6, 0.75)
    smudge = cv2.GaussianBlur((rng.uniform(0, 1, (h // 40, w // 40)) > 0.93).astype(np.float32), (0, 0), 1.5)
    smudge = cv2.resize(smudge, (w, h), interpolation=cv2.INTER_CUBIC)[..., None]  # eraser smears
    return card * (1 - opacity * (1 - graphite)) * (1 - 0.08 * np.clip(smudge, 0, 1))


def render_card(rng, spec):
    h, w = ROWS * TILE, COLS * TILE
    card = _paper(rng, h, w)
    if spec.get("pencil"):
        card = _pencil(rng, card)
    layers = {code: np.zeros((h, w), np.float32) for code in INKS}
    for kind, code, r0, r1, c0, c1 in spec["shapes"]:
        if kind == "block":
            alpha = _fill_alpha(rng, (h, w), _block_polygon(rng, r0, r1, c0, c1))
        elif kind == "stroke":
            width = rng.uniform(*spec["stroke"])
            alpha = _polyline_alpha(rng, (h, w), _stroke_points(rng, r0, c0, c1, width), width)
        else:
            width = rng.uniform(*spec.get("zigzag", (0.25, 0.32)))
            alpha = _polyline_alpha(rng, (h, w), _zigzag_points(rng, r0, c0, c1, width), width)
        layers[code] = 1 - (1 - layers[code]) * (1 - alpha)
    inks = {**INKS, **spec.get("inks", {})}
    for code, alpha in layers.items():
        card *= 1 - alpha[..., None] * (1 - np.array(inks[code], np.float32))
    return card


# --- the photo ---------------------------------------------------------------------------------

def _table(rng, w, h, kind):
    base, texture = TABLES[kind]
    low = cv2.resize(rng.normal(0, 1, (6, 8)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    shade = 1 + 0.08 * low
    if texture == "wood":
        grain = cv2.resize(rng.normal(0, 1, (h // 3, 10)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
        shade = shade + 0.22 * grain
    else:
        shade = shade + 0.06 * cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.7)
    return np.clip(shade[..., None] * np.array(base, np.float32), 0, 1)


def _rotation(yaw, pitch, roll):
    y, p, r = np.radians([yaw, pitch, roll])
    rz = np.array([[math.cos(y), -math.sin(y), 0], [math.sin(y), math.cos(y), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    ry = np.array([[math.cos(r), 0, math.sin(r)], [0, 1, 0], [-math.sin(r), 0, math.cos(r)]])
    return rz @ ry @ rx


def card_quad(rng, spec):
    """Corners (card TL, TR, BR, BL) in the photo: a tilted card seen from z card-half-heights away."""
    frame_w, frame_h = spec["frame"]
    corners = np.array([[-CARD_ASPECT, -1, 0], [CARD_ASPECT, -1, 0], [CARD_ASPECT, 1, 0], [-CARD_ASPECT, 1, 0]])
    pts = corners @ _rotation(spec["yaw"], spec["pitch"], spec["roll"]).T + [0, 0, spec["z"]]
    quad = pts[:, :2] / pts[:, 2:3]
    area = cv2.contourArea(quad.astype(np.float32))
    cover = spec["cover"]
    margin = 0.04 * min(frame_w, frame_h)
    while True:
        scaled = quad * math.sqrt(cover * frame_w * frame_h / area)
        room = np.array([frame_w, frame_h]) - 2 * margin - (scaled.max(0) - scaled.min(0))
        if (room >= 0).all():
            return scaled - scaled.min(0) + margin + rng.uniform(0.2, 0.8, 2) * room
        cover *= 0.97


def _shadow(w, h, quad, spec):
    """A hard-edged shadow (a phone or a hand) whose edge crosses the card."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    angle = math.radians(spec["angle"])
    centre = quad.mean(0) + spec.get("offset", 0.0) * (quad.max(0) - quad.min(0))
    dist = (xx - centre[0]) * math.cos(angle) + (yy - centre[1]) * math.sin(angle)
    return 1 - spec["depth"] / (1 + np.exp(-np.clip(dist / spec["softness"], -50, 50)))


def _glare(scene, warp, spec):
    """A specular spot (ceiling light) on the card around tile (row, col): washes out the ink under it."""
    h, w = scene.shape[:2]
    row, col = spec["at"]
    pts = np.float32([[[(col + 0.5) * TILE, (row + 0.5) * TILE], [(col + 1.5) * TILE, (row + 0.5) * TILE]]])
    centre, beside = cv2.perspectiveTransform(pts, warp)[0]
    tile_px = float(np.linalg.norm(beside - centre))  # one tile's size in the photo at that spot
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sigma = spec["sigma"] * tile_px
    glow = spec["strength"] * np.exp(-(((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2) / sigma ** 2) / 2)
    return scene + glow[..., None] * (1 - scene)


def _thumb(scene, warp, spec):
    """A thumb holding the card at tile (row, col) on its rim, pointing towards the card centre."""
    h, w = scene.shape[:2]
    row, col = spec["at"]
    pts = np.float32([[[col * TILE, row * TILE], [COLS * TILE / 2, ROWS * TILE / 2], [(col + 1) * TILE, row * TILE]]])
    tip, centre, beside = cv2.perspectiveTransform(pts, warp)[0]
    tile_px = float(np.linalg.norm(beside - tip))
    direction = (centre - tip) / np.linalg.norm(centre - tip)
    middle = tip - direction * spec["length"] * tile_px * 0.35  # most of the thumb is off the card
    axes = (int(spec["length"] * tile_px / 2), int(spec["width"] * tile_px / 2))
    mask = np.zeros((h, w), np.float32)
    angle = math.degrees(math.atan2(direction[1], direction[0]))
    cv2.ellipse(mask, (tuple(map(int, middle)), (2 * axes[0], 2 * axes[1]), angle), 1.0, -1, cv2.LINE_AA)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    shade = 0.85 + 0.15 * np.cos(np.clip(((xx - middle[0]) * -direction[1] + (yy - middle[1]) * direction[0])
                                         / max(axes[1], 1), -1.5, 1.5))  # rounder: darker at the sides
    skin = np.array(spec["skin"], np.float32) * shade[..., None]
    return scene * (1 - mask[..., None]) + skin * mask[..., None]


def _motion_kernel(length, angle_deg):
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1
    turn = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), angle_deg, 1.0)
    kernel = cv2.warpAffine(kernel, turn, (length, length))
    return kernel / kernel.sum()


def render(spec_or_name):
    """(JPEG bytes as the phone client would send them, truth grid rows x cols in the card's own orientation)."""
    spec = case(spec_or_name) if isinstance(spec_or_name, str) else {**BASE, **spec_or_name}
    rng = np.random.default_rng(spec["seed"])
    frame_w, frame_h = spec["frame"]
    card = render_card(rng, spec)
    ch, cw = card.shape[:2]
    quad = card_quad(rng, spec)
    src = np.float32([[0, 0], [cw, 0], [cw, ch], [0, ch]])
    warp = cv2.getPerspectiveTransform(src, quad.astype(np.float32))
    card_img = cv2.warpPerspective(card, warp, (frame_w, frame_h), flags=cv2.INTER_AREA)
    alpha = cv2.warpPerspective(np.ones((ch, cw), np.float32), warp, (frame_w, frame_h), flags=cv2.INTER_LINEAR)
    alpha = alpha[..., None]

    table = _table(rng, frame_w, frame_h, spec["table"])
    drop = cv2.GaussianBlur(np.roll(alpha[..., 0], (6, 4), (0, 1)), (0, 0), 8)
    scene = table * (1 - 0.4 * drop[..., None]) * (1 - alpha) + card_img * alpha
    if spec.get("thumb"):
        scene = _thumb(scene, warp, spec["thumb"])

    yy, xx = np.mgrid[0:frame_h, 0:frame_w].astype(np.float32)
    r2 = ((xx - frame_w / 2) ** 2 + (yy - frame_h / 2) ** 2) / ((frame_w / 2) ** 2 + (frame_h / 2) ** 2)
    light = spec["exposure"] * rng.uniform(0.95, 1.02) * (1 - rng.uniform(0.15, 0.25) * r2)
    if spec.get("shadow"):
        light = light * _shadow(frame_w, frame_h, quad, spec["shadow"])
    scene = scene * light[..., None] * np.array(LIGHTS[spec["light"]], np.float32)
    if spec.get("glare"):
        scene = _glare(scene, warp, spec["glare"])
    scene = cv2.GaussianBlur(scene * 255, (0, 0), rng.uniform(0.6, 0.9))  # lens softness
    if spec.get("motion"):
        scene = cv2.filter2D(scene, -1, _motion_kernel(int(spec["motion"]), rng.uniform(0, 180)))
    noise = spec.get("noise", rng.uniform(2.0, 4.0))
    scene = scene + rng.normal(0, noise, (frame_h, frame_w, 1)) + rng.normal(0, noise / 3, (frame_h, frame_w, 3))
    scene = cv2.addWeighted(scene, 1.5, cv2.GaussianBlur(scene, (0, 0), 1.5), -0.5, 0)  # phone sharpening
    photo = np.clip(scene, 0, 255).astype(np.uint8)
    ok, jpeg = cv2.imencode(".jpg", photo, [cv2.IMWRITE_JPEG_QUALITY, 85])  # what the client uploads
    assert ok
    return jpeg.tobytes(), truth_grid(spec["shapes"])


# --- scoring -----------------------------------------------------------------------------------

def score(grid, truth):
    """Tile agreement, agreement over tiles inked in either grid, and recall/precision per legend colour."""
    grid, truth = np.asarray(grid), np.asarray(truth)
    out = {"agreement": float((grid == truth).mean())}
    ink = (grid != EMPTY) | (truth != EMPTY)
    out["inkAgreement"] = float((grid[ink] == truth[ink]).mean()) if ink.any() else 1.0
    for code, name in ((SOLID, "solid"), (PASS, "pass"), (HAZARD, "hazard")):
        t, g = truth == code, grid == code
        hits = int((t & g).sum())
        out[name] = {"truth": int(t.sum()), "found": int(g.sum()),
                     "recall": hits / t.sum() if t.any() else None,
                     "precision": hits / g.sum() if g.any() else None}
    return out


def _fmt(x):
    return "  -  " if x is None else f"{x:5.2f}"


def main(argv=None):
    import vision  # imported here so the generator itself only needs config

    argv = sys.argv[1:] if argv is None else argv
    out_dir = Path(argv[0]) if argv else Path(tempfile.mkdtemp(prefix="sketch-hard-"))
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"writing to {out_dir}")
    print(f"{'case':36s} fair card  agree  inkAg  solR  solP  pasR  pasP  hazR  hazP   ms")
    for spec in CASES:
        data, truth = render(spec["name"])
        (out_dir / f"{spec['name']}.jpg").write_bytes(data)
        (out_dir / f"{spec['name']}.truth.json").write_text(json.dumps({"grid": truth.tolist()}) + "\n")
        vision.scan_image(data)  # warm-up
        t0 = time.perf_counter()
        result = vision.scan_image(data)
        ms = (time.perf_counter() - t0) * 1000
        s = score(result["grid"], truth)
        line = (f"{spec['name']:36s} {'y' if spec['fair'] else 'n':4s} {'y' if result['cardDetected'] else 'N':4s} "
                f"{s['agreement']:5.3f}  {s['inkAgreement']:5.3f} "
                + " ".join(f"{_fmt(s[c]['recall'])} {_fmt(s[c]['precision'])}" for c in ("solid", "pass", "hazard"))
                + f" {ms:5.0f}")
        if spec.get("upside_down"):
            flipped = score(result["grid"], truth[::-1, ::-1])
            line += f"   vs 180-turned truth: agree {flipped['agreement']:.3f}"
        print(line)


if __name__ == "__main__":
    main()
