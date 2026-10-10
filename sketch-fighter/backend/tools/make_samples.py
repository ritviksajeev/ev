"""Renders synthetic phone photos of hand-drawn index cards, plus the grid each one should scan to.

Run from backend/:  python -m tools.make_samples
Writes samples/card-NN.jpg and samples/card-NN.truth.json ({"grid": rows x cols tile codes}).
Every card has a fixed seed, so repeated runs produce the same files.
"""

import json
import math
from pathlib import Path

import cv2
import numpy as np

from config import GAME

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "samples"
COLS, ROWS = GAME["cols"], GAME["rows"]
EMPTY, SOLID, PASS, HAZARD = 0, 1, 2, 3
TILE = 30  # card render resolution (px per tile) before the card is "photographed"
CARD_ASPECT = 5 / 3

# Marker reflectance per BGR channel: 1 lets the paper show through. One variant is picked per card.
INKS = {
    SOLID: [(0.10, 0.10, 0.12), (0.14, 0.12, 0.12), (0.22, 0.21, 0.22)],  # the last is a worn-out marker
    PASS: [(0.66, 0.33, 0.10), (0.78, 0.48, 0.16), (0.60, 0.30, 0.18)],
    HAZARD: [(0.18, 0.16, 0.82), (0.14, 0.24, 0.86), (0.30, 0.14, 0.80)],
}

TABLES = {  # base reflectance (BGR) of dark venue tables
    "walnut": (0.10, 0.15, 0.22),
    "slate": (0.15, 0.15, 0.14),
    "felt": (0.21, 0.12, 0.09),
    "laminate": (0.34, 0.34, 0.33),  # mid grey: less contrast with the card
}

# Light colour gains (BGR): phones do not fully correct warm or cool venue lighting.
LIGHTS = {"neutral": (1.0, 1.0, 1.0), "warm": (0.82, 0.96, 1.07), "cool": (1.08, 1.0, 0.86)}

# Shapes use tile coordinates, rows and cols inclusive:
#   ("block", code, r0, r1, c0, c1)  filled marker area
#   ("stroke", code, r, r, c0, c1)   one marker line about a tile thick
#   ("zigzag", HAZARD, r, r, c0, c1) red spikes across one row
CARDS = [
    {
        "name": "classic", "seed": 101, "frame": (1280, 960), "light": "neutral", "table": "walnut", "curl": True,
        "shapes": [
            ("block", SOLID, 17, 19, 7, 32),
            ("stroke", PASS, 12, 12, 10, 16),
            ("stroke", PASS, 12, 12, 23, 29),
            ("stroke", PASS, 7, 7, 16, 23),
        ],
    },
    {
        "name": "lava pit", "seed": 202, "frame": (1280, 960), "light": "warm", "table": "walnut", "shadow": True,
        "glare": True,
        "shapes": [
            ("block", SOLID, 16, 19, 3, 15),
            ("block", SOLID, 16, 19, 24, 36),
            ("zigzag", HAZARD, 19, 19, 16, 23),
            ("stroke", PASS, 11, 11, 16, 23),
            ("stroke", PASS, 8, 8, 5, 11),
            ("stroke", PASS, 8, 8, 28, 34),
        ],
    },
    {
        "name": "twin towers", "seed": 303, "frame": (1280, 720), "light": "cool", "table": "slate", "pencil": True,
        "motion": True,
        "shapes": [
            ("block", SOLID, 18, 20, 4, 35),
            ("block", SOLID, 10, 17, 8, 10),
            ("block", SOLID, 10, 17, 29, 31),
            ("stroke", PASS, 10, 10, 11, 28),
            ("stroke", PASS, 14, 14, 15, 24),
            ("zigzag", HAZARD, 17, 17, 17, 22),
        ],
    },
    {
        "name": "lonely line", "seed": 404, "frame": (1280, 960), "light": "warm", "table": "felt", "shadow": True,
        "dim": True,
        "shapes": [
            ("stroke", SOLID, 13, 13, 14, 23),
        ],
    },
    {
        "name": "crowded", "seed": 505, "frame": (1280, 960), "light": "neutral", "table": "slate", "shadow": True,
        "glare": True,
        "shapes": [
            ("block", SOLID, 19, 21, 2, 37),
            ("block", SOLID, 14, 16, 4, 9),
            ("block", SOLID, 14, 16, 30, 35),
            ("block", SOLID, 6, 8, 17, 22),
            ("block", HAZARD, 9, 9, 17, 22),
            ("zigzag", HAZARD, 18, 18, 14, 25),
            ("stroke", PASS, 11, 11, 3, 12),
            ("stroke", PASS, 11, 11, 27, 36),
            ("stroke", PASS, 15, 15, 13, 26),
            ("stroke", PASS, 4, 4, 7, 14),
            ("stroke", PASS, 4, 4, 25, 32),
        ],
    },
    {
        "name": "pyramid", "seed": 606, "frame": (1280, 960), "light": "cool", "table": "walnut", "pencil": True,
        "curl": True,
        "shapes": [
            ("block", SOLID, 19, 21, 3, 12),
            ("block", SOLID, 16, 21, 13, 18),
            ("block", SOLID, 13, 23, 19, 23),  # runs off the bottom edge of the card
            ("block", SOLID, 16, 21, 24, 28),
            ("block", SOLID, 19, 21, 29, 36),
            ("zigzag", HAZARD, 18, 18, 31, 35),
            ("stroke", PASS, 9, 9, 6, 12),
            ("stroke", PASS, 9, 9, 30, 36),
            ("stroke", PASS, 6, 6, 16, 26),
        ],
    },
    {
        "name": "corner fort", "seed": 707, "frame": (1280, 960), "light": "warm", "table": "felt", "dim": True,
        "shapes": [
            ("block", SOLID, 18, 23, 0, 11),  # fills the bottom-left corner of the card
            ("block", SOLID, 16, 18, 16, 35),
            ("block", HAZARD, 21, 22, 13, 22),
            ("stroke", PASS, 13, 13, 4, 10),
            ("stroke", PASS, 12, 12, 20, 27),
            ("stroke", PASS, 7, 7, 12, 19),
        ],
    },
    {
        "name": "sky islands", "seed": 808, "frame": (960, 1280), "yaw": 90.0, "light": "neutral", "table": "walnut",
        "shadow": True, "motion": True,
        "shapes": [
            ("block", SOLID, 15, 17, 2, 11),
            ("block", SOLID, 12, 14, 15, 24),
            ("block", SOLID, 15, 17, 28, 37),
            ("zigzag", HAZARD, 11, 11, 18, 21),
            ("stroke", PASS, 8, 8, 6, 13),
            ("stroke", PASS, 8, 8, 26, 33),
            ("stroke", PASS, 19, 19, 15, 24),
        ],
    },
    {
        "name": "bridges", "seed": 909, "frame": (1280, 960), "light": "neutral", "table": "laminate", "glare": True,
        "shapes": [
            ("block", SOLID, 15, 20, 2, 8),
            ("block", SOLID, 15, 20, 31, 37),
            ("stroke", PASS, 15, 15, 9, 30),
            ("stroke", PASS, 9, 9, 14, 25),
            ("stroke", PASS, 5, 5, 4, 10),
            ("zigzag", HAZARD, 21, 21, 9, 30),
        ],
    },
]


def truth_grid(shapes):
    grid = np.zeros((ROWS, COLS), np.uint8)
    for _, code, r0, r1, c0, c1 in shapes:
        grid[r0:r1 + 1, c0:c1 + 1] = code
    return grid


# --- drawing ---------------------------------------------------------------------------------

def _wobble(rng, n, lo, hi, samples_per_knot=6):
    """n values in [lo, hi] that drift smoothly, like a hand following a line."""
    knots = rng.uniform(lo, hi, n // samples_per_knot + 2)
    return np.interp(np.linspace(0, len(knots) - 1, n), np.arange(len(knots)), knots)


def _paper(rng, h, w):
    tint = rng.uniform(0.93, 0.97) * np.array([rng.uniform(0.96, 0.99), 1.0, rng.uniform(1.0, 1.02)])
    low = cv2.resize(rng.normal(0, 1, (5, 8)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.8)
    shade = 1 + 0.02 * low + 0.03 * grain
    return np.clip(shade[..., None] * tint, 0, 1).astype(np.float32)


def _fill_alpha(rng, shape, polygon, xx, yy):
    """Alpha of a marker-filled polygon: overlapping strokes leave streaks and a few paper specks."""
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.round(polygon * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    # Streaks: an irregular brightness profile across the fill direction.
    angle = rng.uniform(0, math.pi)
    across = (xx * math.cos(angle) + yy * math.sin(angle)).astype(np.int32)
    across -= across.min()
    profile = cv2.GaussianBlur(rng.uniform(0, 1, (1, int(across.max()) + 1)).astype(np.float32), (0, 0), 3)
    profile = (profile - profile.min()) / (np.ptp(profile) + 1e-6)
    density = 0.84 + 0.16 * profile[0, across]
    x0, y0 = polygon.min(0).astype(int)
    x1, y1 = polygon.max(0).astype(int)
    specks = np.zeros(shape, np.uint8)
    for _ in range(int((x1 - x0) * (y1 - y0) / TILE**2 * 0.3)):
        centre = (int(rng.uniform(x0, x1)), int(rng.uniform(y0, y1)))
        cv2.circle(specks, centre, int(rng.integers(1, 4)), 255, -1)
    density = np.where(specks > 0, density * 0.45, density)
    return mask.astype(np.float32) / 255 * density * rng.uniform(0.93, 0.99)


def _block_polygon(rng, r0, r1, c0, c1):
    """Outline of a filled area, each side wobbling between slightly outside and well inside the tiles."""
    corners = np.array([(c0, r0), (c1 + 1, r0), (c1 + 1, r1 + 1), (c0, r1 + 1)], float)
    points = []
    for i in range(4):
        start, side = corners[i], corners[(i + 1) % 4] - corners[i]
        length = math.hypot(*side)
        inward = np.array([-side[1], side[0]]) / length  # clockwise walk with y down
        n = max(4, int(length * 4))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        inset = _wobble(rng, n, -0.10, 0.20)[:, None]
        points.append(start + t * side + inset * inward)
    return np.concatenate(points) * TILE


def _polyline_alpha(rng, shape, points, width):
    """Alpha of a marker line through points (tile units) with a width that varies a little."""
    mask = np.zeros(shape, np.uint8)
    widths = width * TILE * (1 + _wobble(rng, len(points) - 1, -0.08, 0.08))
    pts = np.round(points * TILE * 16).astype(np.int32)
    for p, q, w in zip(pts[:-1], pts[1:], widths):
        cv2.line(mask, tuple(map(int, p)), tuple(map(int, q)), 255, max(1, int(round(w))), cv2.LINE_AA, shift=4)
    streaks = 0.88 + 0.12 * cv2.GaussianBlur(rng.uniform(0, 1, shape).astype(np.float32), (0, 0), 2)
    return mask.astype(np.float32) / 255 * streaks * rng.uniform(0.92, 0.99)


def _stroke_points(rng, r, c0, c1, width):
    """A horizontal line along row r that starts and ends inside its first and last tile."""
    x0 = c0 + width / 2 + rng.uniform(-0.12, 0.25)
    x1 = c1 + 1 - width / 2 - rng.uniform(-0.12, 0.25)
    xs = np.linspace(x0, x1, max(8, int((x1 - x0) * 3)))
    slope = rng.uniform(-0.1, 0.1) * np.linspace(-1, 1, len(xs))  # the line drifts a little across the row
    ys = r + 0.5 + rng.uniform(-0.05, 0.05) + slope + _wobble(rng, len(xs), -0.06, 0.06)
    return np.stack([xs, ys], 1)


def _zigzag_points(rng, r, c0, c1, width):
    period = rng.uniform(0.75, 0.95)
    xs = np.arange(c0 + 0.15, c1 + 0.9, period / 2)
    top, bottom = r + width / 2 + 0.04, r + 1 - width / 2 - 0.04
    ys = np.where(np.arange(len(xs)) % 2 == 0, bottom, top) + rng.uniform(-0.04, 0.04, len(xs))
    return np.stack([xs + rng.uniform(-0.05, 0.05, len(xs)), ys], 1)


def _shape_alpha(rng, shape, item, xx, yy):
    kind, _, r0, r1, c0, c1 = item
    if kind == "block":
        return _fill_alpha(rng, shape, _block_polygon(rng, r0, r1, c0, c1), xx, yy)
    if kind == "stroke":
        width = rng.uniform(0.78, 0.95)
        return _polyline_alpha(rng, shape, _stroke_points(rng, r0, c0, c1, width), width)
    width = rng.uniform(0.25, 0.32)
    return _polyline_alpha(rng, shape, _zigzag_points(rng, r0, c0, c1, width), width)


def _pencil_marks(rng, card):
    """Faint, half-erased pencil guide lines: real cards have them and they must not scan as ink."""
    h, w = card.shape[:2]
    alpha = np.zeros((h, w), np.uint8)
    for _ in range(4):
        p = (int(rng.uniform(0, w)), int(rng.uniform(0, h)))
        q = (int(p[0] + rng.uniform(-400, 400)), int(p[1] + rng.uniform(-120, 120)))
        cv2.line(alpha, p, q, 255, 2, cv2.LINE_AA)
    opacity = alpha.astype(np.float32)[..., None] / 255 * 0.35
    graphite = 0.6  # reflectance
    return card * (1 - opacity * (1 - graphite))


def render_card(rng, card_spec):
    h, w = ROWS * TILE, COLS * TILE
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    card = _paper(rng, h, w)
    if card_spec.get("pencil"):
        card = _pencil_marks(rng, card)
    layers = {code: np.zeros((h, w), np.float32) for code in INKS}
    for item in card_spec["shapes"]:
        alpha = _shape_alpha(rng, (h, w), item, xx, yy)
        layers[item[1]] = 1 - (1 - layers[item[1]]) * (1 - alpha)  # overlapping marker gets darker
    for code, alpha in layers.items():
        variants = INKS[code]
        ink = np.array(variants[rng.integers(len(variants))], np.float32)
        card *= 1 - alpha[..., None] * (1 - ink)
    return card


# --- photographing -----------------------------------------------------------------------------

def render_table(rng, w, h, kind="walnut"):
    """A table top (dark wood, slate, felt or grey laminate) as a float BGR image in 0..1."""
    low = cv2.resize(rng.normal(0, 1, (6, 8)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    shade = 1 + 0.10 * low
    if kind == "walnut":
        # Grain: noise that changes quickly across the boards and slowly along them, then turned.
        grain = cv2.resize(rng.normal(0, 1, (h // 3, 10)).astype(np.float32), (w * 2, h * 2),
                           interpolation=cv2.INTER_CUBIC)
        turn = cv2.getRotationMatrix2D((w, h), rng.uniform(-30, 30), 1.0)
        grain = cv2.warpAffine(grain, turn, (w * 2, h * 2), borderMode=cv2.BORDER_REFLECT)[h // 2:h // 2 + h,
                                                                                             w // 2:w // 2 + w]
        shade = shade + 0.22 * grain
    else:
        fibre = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.9 if kind == "felt" else 0.6)
        shade = shade + (0.25 if kind == "felt" else 0.15) * fibre
    return np.clip(shade[..., None] * np.array(TABLES[kind], np.float32), 0, 1)


def _rotation(yaw, pitch, roll):
    y, p, r = np.radians([yaw, pitch, roll])
    rz = np.array([[math.cos(y), -math.sin(y), 0], [math.sin(y), math.cos(y), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    ry = np.array([[math.cos(r), 0, math.sin(r)], [0, 1, 0], [-math.sin(r), 0, math.cos(r)]])
    return rz @ ry @ rx


def card_quad(rng, frame_w, frame_h, yaw, cover):
    """Corners (TL, TR, BR, BL) of the card in the photo: a tilted 3-D card seen by a phone camera."""
    corners = np.array([[-CARD_ASPECT, -1, 0], [CARD_ASPECT, -1, 0], [CARD_ASPECT, 1, 0], [-CARD_ASPECT, 1, 0]])
    pts = corners @ _rotation(yaw, rng.uniform(-18, 18), rng.uniform(-10, 10)).T + [0, 0, 3.7]
    quad = pts[:, :2] / pts[:, 2:3]
    area = cv2.contourArea(quad.astype(np.float32))
    margin = 0.03 * min(frame_w, frame_h)
    while True:
        scaled = quad * math.sqrt(cover * frame_w * frame_h / area)
        room = np.array([frame_w, frame_h]) - 2 * margin - (scaled.max(0) - scaled.min(0))
        if (room >= 0).all():
            return scaled - scaled.min(0) + margin + rng.uniform(0, 1, 2) * room
        cover *= 0.97


def _lighting(rng, w, h, with_shadow):
    """Per-pixel light level: exposure, vignette and optionally a soft shadow across part of the shot."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - w / 2) ** 2 + (yy - h / 2) ** 2) / ((w / 2) ** 2 + (h / 2) ** 2)
    light = rng.uniform(0.88, 1.05) * (1 - rng.uniform(0.15, 0.32) * r2)
    if with_shadow:
        angle = rng.uniform(0, 2 * math.pi)
        dist = (xx - w / 2) * math.cos(angle) + (yy - h / 2) * math.sin(angle) - rng.uniform(-0.15, 0.25) * w
        softness = rng.uniform(40, 160)
        light *= 1 - rng.uniform(0.25, 0.45) / (1 + np.exp(-dist / softness))
    return light


def _curl(rng, card, pad):
    """The card does not lie flat: it bows by a few pixels. Returns the padded card and its alpha."""
    alpha = cv2.copyMakeBorder(np.ones(card.shape[:2], np.float32), pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    card = cv2.copyMakeBorder(card, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    bow = rng.uniform(3, 5) * rng.choice([-1, 1])
    map_y = (yy - bow * np.sin(np.pi * np.clip((xx - pad) / (w - 2 * pad), 0, 1))).astype(np.float32)
    card = cv2.remap(card, xx, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    alpha = cv2.remap(alpha, xx, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return card, alpha


def _glare(rng, scene, quad):
    """A soft reflection of a ceiling light on the card: washes out the ink underneath."""
    h, w = scene.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = quad.mean(0) + rng.uniform(-0.3, 0.3, 2) * (quad.max(0) - quad.min(0))
    sx, sy = rng.uniform(80, 200, 2)
    glow = rng.uniform(0.15, 0.28) * np.exp(-(((xx - cx) / sx) ** 2 + ((yy - cy) / sy) ** 2) / 2)
    return scene + glow[..., None] * (1 - scene)


def _motion_kernel(rng):
    length = int(rng.integers(5, 9))
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1
    turn = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), rng.uniform(0, 180), 1.0)
    kernel = cv2.warpAffine(kernel, turn, (length, length))
    return kernel / kernel.sum()


def render_photo(card_spec):
    rng = np.random.default_rng(card_spec["seed"])
    frame_w, frame_h = card_spec["frame"]
    card = render_card(rng, card_spec)
    ch, cw = card.shape[:2]
    pad = 12 if card_spec.get("curl") else 0
    if pad:
        card, card_alpha = _curl(rng, card, pad)
    else:
        card_alpha = np.ones((ch, cw), np.float32)
    yaw = card_spec.get("yaw", 0.0) + rng.uniform(-18, 18) * (0.2 if "yaw" in card_spec else 1)
    quad = card_quad(rng, frame_w, frame_h, yaw, rng.uniform(0.45, 0.75))
    src = np.float32([[pad, pad], [pad + cw, pad], [pad + cw, pad + ch], [pad, pad + ch]])
    warp = cv2.getPerspectiveTransform(src, quad.astype(np.float32))
    card_img = cv2.warpPerspective(card, warp, (frame_w, frame_h), flags=cv2.INTER_LINEAR)
    alpha = cv2.warpPerspective(card_alpha, warp, (frame_w, frame_h), flags=cv2.INTER_LINEAR)[..., None]

    table = render_table(rng, frame_w, frame_h, card_spec["table"])
    drop = cv2.GaussianBlur(np.roll(alpha[..., 0], (8, 5), (0, 1)), (0, 0), 10)  # the card lifts off the table
    scene = table * (1 - 0.5 * drop[..., None]) * (1 - alpha) + card_img * alpha

    scene *= _lighting(rng, frame_w, frame_h, card_spec.get("shadow", False))[..., None]
    scene *= np.array(LIGHTS[card_spec["light"]], np.float32)
    if card_spec.get("glare"):
        scene = _glare(rng, scene, quad)
    if card_spec.get("dim"):
        scene *= rng.uniform(0.5, 0.62)
    scene = cv2.GaussianBlur(scene * 255, (0, 0), rng.uniform(0.6, 1.1))  # lens softness
    if card_spec.get("motion"):
        scene = cv2.filter2D(scene, -1, _motion_kernel(rng))

    noise = rng.uniform(6, 8) if card_spec.get("dim") else rng.uniform(2.0, 4.5)
    scene = scene + rng.normal(0, noise, (frame_h, frame_w, 1)) + rng.normal(0, noise / 3, (frame_h, frame_w, 3))
    if card_spec.get("dim"):
        scene = cv2.GaussianBlur(scene, (0, 0), 1.0)  # the phone's noise reduction
    scene = cv2.addWeighted(scene, 1.5, cv2.GaussianBlur(scene, (0, 0), 1.5), -0.5, 0)  # the phone's sharpening
    photo = np.clip(scene, 0, 255).astype(np.uint8)
    ok, jpeg = cv2.imencode(".jpg", photo, [cv2.IMWRITE_JPEG_QUALITY, 85])
    assert ok
    return jpeg.tobytes()


def main():
    SAMPLES_DIR.mkdir(exist_ok=True)
    for i, spec in enumerate(CARDS, 1):
        stem = SAMPLES_DIR / f"card-{i:02d}"
        stem.with_suffix(".jpg").write_bytes(render_photo(spec))
        grid = truth_grid(spec["shapes"]).tolist()
        stem.with_suffix(".truth.json").write_text(json.dumps({"grid": grid}, separators=(",", ":")) + "\n")
        print(f"{stem.name}: {spec['name']}")


if __name__ == "__main__":
    main()
