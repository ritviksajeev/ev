"""Harder synthetic phone photos of drawn index cards, for the adversarial vision tests.

Independent of tools.make_samples on purpose: the scene is lit in linear light and then encoded to
sRGB like a phone camera does, the card is placed with a pinhole camera of a phone's field of view,
and inks are given as they look in a photo. Each case adds one or two realistic stressors (steep
angle, small card, tungsten light, hard shadow, light table, glare, thin pens, off-hue markers,
pencil guides, odd orientation) to an otherwise ordinary photo.

Run from backend/:  python -m tools.make_hard_samples OUT_DIR
Writes OUT_DIR/<case>.jpg and OUT_DIR/<case>.truth.json ({"grid": rows x cols tile codes}).
"""

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

from config import GAME

COLS, ROWS = GAME["cols"], GAME["rows"]
EMPTY, SOLID, PASS, HAZARD = 0, 1, 2, 3
CLASS_NAMES = {SOLID: "solid", PASS: "pass", HAZARD: "hazard"}
TILE = 30  # card render resolution, px per tile
CARD_ASPECT = 5 / 3
PAPER = 0.86  # linear reflectance of white index card stock
PAPER_SRGB = 242  # how that paper looks in a well exposed photo; inks below are relative to it

# Inks as they look on white paper in a well exposed photo under neutral light (sRGB, BGR order).
INKS = {
    "black": (52, 52, 58),  # fresh black marker
    "worn-black": (82, 80, 84),
    "blue": (168, 88, 38),  # H about 108 in OpenCV units
    "red": (62, 52, 206),  # H about 178
    "orange-red": (40, 92, 226),  # H about 9: a red that photographs orange-ish
    "purple-blue": (168, 72, 98),  # H about 128: a blue that photographs purple-ish
}
DEFAULT_INKS = {SOLID: "black", PASS: "blue", HAZARD: "red"}

TABLES = {  # linear reflectance (BGR) and texture
    "walnut": ((0.05, 0.08, 0.13), "wood"),
    "slate": ((0.07, 0.07, 0.065), "plain"),
    "light-grey": ((0.50, 0.50, 0.49), "plain"),  # about sRGB 188: a light grey folding table
    "pale-grey": ((0.62, 0.62, 0.60), "plain"),  # about sRGB 207
}

# Light colour (BGR gain) the phone did not correct.
LIGHTS = {"neutral": (1.0, 1.0, 1.0), "tungsten": (0.58, 0.82, 1.08)}

# Stage designs in tile coordinates, rows and cols inclusive:
#   ("block", code, r0, r1, c0, c1)  filled marker area
#   ("line", code, r, c0, c1)        a pen line along row r
#   ("zigzag", HAZARD, r, c0, c1)    spikes drawn within row r
DESIGNS = {
    "classic": [
        ("block", SOLID, 18, 20, 5, 34),
        ("zigzag", HAZARD, 17, 17, 17, 22),
        ("line", PASS, 13, 8, 15),
        ("line", PASS, 13, 24, 31),
        ("line", PASS, 8, 15, 24),
    ],
    "gaps": [
        ("block", SOLID, 17, 20, 2, 14),
        ("block", SOLID, 17, 20, 25, 37),
        ("block", HAZARD, 20, 20, 15, 24),
        ("line", PASS, 12, 16, 23),
        ("line", PASS, 9, 4, 10),
        ("line", PASS, 9, 29, 35),
    ],
    "towers": [
        ("block", SOLID, 19, 21, 3, 36),
        ("block", SOLID, 12, 18, 8, 9),
        ("block", SOLID, 12, 18, 30, 31),
        ("line", PASS, 12, 11, 28),
        ("line", PASS, 15, 15, 24),
        ("zigzag", HAZARD, 18, 18, 16, 23),
    ],
    "pen-only": [  # one pen for everything, as a judge would draw it
        ("line", SOLID, 18, 4, 35),
        ("line", SOLID, 13, 7, 15),
        ("line", SOLID, 13, 24, 32),
        ("line", PASS, 9, 14, 25),
        ("zigzag", HAZARD, 17, 17, 18, 21),
    ],
    "judge-adds": [  # a pre-drawn card plus platforms the judge added with a fine pen
        ("block", SOLID, 18, 20, 4, 35),
        ("line", SOLID, 14, 6, 13),
        ("line", PASS, 10, 16, 24),
        ("line", SOLID, 14, 27, 34),
        ("line", PASS, 6, 9, 16),
    ],
}

BASE = {
    "frame": (1280, 960),  # the client always sends long side 1280
    "cover": 0.5,  # share of the frame the card covers
    "yaw": 0.0, "pitch": 10.0, "roll": 4.0,  # degrees; yaw spins the card on the table
    "fov": 68.0,  # horizontal field of view of a phone main camera, along the long side
    "table": "walnut",
    "light": "neutral",
    "exposure": 1.0,
    "shadow": None,  # {"shade": light left in the shadow, "softness": px, "angle": deg, "part": share of card}
    "glare": None,  # {"strength": added light at the centre, "size": share of card width, "at": (u, v) on card}
    "motion": 0,  # blur length in px
    "pen": 0.85,  # line width in tiles; a fine-tip marker is about 0.3
    "drift": 0.08,  # how far a hand-drawn line wanders from its row centre, in tiles
    "inks": {},  # class code -> INKS key, overrides DEFAULT_INKS
    "pencil": 0,  # number of faint pencil guide lines
    "noise": 2.5,
    "jpeg": 85,
}

# Hard but fair: what a judge's phone photo at a hackathon table can look like.
CASES = {
    "baseline": {"seed": 1, "design": "classic"},
    "steep-30": {"seed": 2, "design": "gaps", "pitch": 30, "yaw": 12, "roll": 8},
    "small-card": {"seed": 3, "design": "towers", "cover": 0.27, "pitch": 14},
    "tungsten": {"seed": 4, "design": "classic", "light": "tungsten", "exposure": 0.8},
    "hard-shadow": {"seed": 5, "design": "gaps",
                    "shadow": {"shade": 0.4, "softness": 3, "angle": 35, "part": 0.4}},
    "motion-blur": {"seed": 6, "design": "towers", "motion": 7},
    "light-table": {"seed": 7, "design": "classic", "table": "light-grey"},
    "glare": {"seed": 8, "design": "gaps", "glare": {"strength": 0.15, "size": 0.18, "at": (0.3, 0.75)}},
    "thin-pen": {"seed": 9, "design": "pen-only", "pen": 0.4},
    "fine-tip-additions": {"seed": 10, "design": "judge-adds", "pen": 0.32},
    "pencil-guides": {"seed": 11, "design": "towers", "pencil": 8},
    "orange-red": {"seed": 12, "design": "towers", "inks": {HAZARD: "orange-red"}},
    "purple-blue": {"seed": 13, "design": "classic", "inks": {PASS: "purple-blue"}},
    "portrait-cw": {"seed": 14, "design": "gaps", "frame": (960, 1280), "yaw": 90, "cover": 0.4},
    "portrait-ccw": {"seed": 15, "design": "towers", "frame": (960, 1280), "yaw": -90, "cover": 0.4},
    "hackathon-table": {"seed": 16, "design": "judge-adds", "cover": 0.35, "pitch": 22, "yaw": -8,
                        "table": "light-grey", "light": "tungsten", "exposure": 0.85, "pen": 0.5,
                        "shadow": {"shade": 0.55, "softness": 25, "angle": 200, "part": 0.3}},
}
# Documented, not required: the outline cannot tell which end of the card is up.
ODD_ORIENTATION = {"upside-down": {"seed": 17, "design": "classic", "yaw": 180}}


def spec_for(name):
    return {**BASE, **{**CASES, **ODD_ORIENTATION}[name]}


def truth_grid(design):
    grid = np.zeros((ROWS, COLS), np.uint8)
    for kind, code, *where in DESIGNS[design]:
        if kind == "line":
            r, c0, c1 = where
            grid[r, c0:c1 + 1] = code
        else:
            r0, r1, c0, c1 = where
            grid[r0:r1 + 1, c0:c1 + 1] = code
    return grid


def score(grid, truth):
    """Exact tile agreement, plus per class recall and precision that forgive a one-row offset.

    A line drawn near a row boundary may fairly land in either row; that is not a scan error.
    """
    result = {"agreement": float((grid == truth).mean())}
    for code, name in CLASS_NAMES.items():
        want, got = truth == code, grid == code
        if not want.any() and not got.any():
            continue
        result[name] = {
            "recall": float((want & _grow_rows(got)).sum() / max(want.sum(), 1)),
            "precision": float((got & _grow_rows(want)).sum() / max(got.sum(), 1)),
        }
    return result


def _grow_rows(mask):
    grown = mask.copy()
    grown[1:] |= mask[:-1]
    grown[:-1] |= mask[1:]
    return grown


# --- colour --------------------------------------------------------------------------------------

def srgb_to_linear(v):
    v = np.asarray(v, np.float32)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def _ink_factor(name):
    """How much of the paper's light the ink lets through, per channel (linear)."""
    return srgb_to_linear(np.array(INKS[name], np.float32) / 255) / srgb_to_linear(PAPER_SRGB / 255)


# --- drawing the card ------------------------------------------------------------------------------

def _wobble(rng, n, lo, hi, samples_per_knot=8):
    knots = rng.uniform(lo, hi, n // samples_per_knot + 2)
    return np.interp(np.linspace(0, len(knots) - 1, n), np.arange(len(knots)), knots)


def _paper(rng, h, w):
    low = cv2.resize(rng.normal(0, 1, (4, 6)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    grain = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.9)
    tint = np.array([0.97, 1.0, 1.01], np.float32)
    return (PAPER * (1 + 0.015 * low + 0.025 * grain))[..., None] * tint


def _line_alpha(rng, shape, points, width):
    """Coverage of a marker line through points (tile units); ink density varies a little along it."""
    mask = np.zeros(shape, np.uint8)
    widths = width * TILE * (1 + _wobble(rng, len(points) - 1, -0.1, 0.1))
    pts = np.round(points * TILE * 16).astype(np.int32)
    for p, q, w in zip(pts[:-1], pts[1:], widths):
        cv2.line(mask, tuple(map(int, p)), tuple(map(int, q)), 255, max(1, int(round(w))), cv2.LINE_AA, shift=4)
    density = 0.9 + 0.1 * cv2.GaussianBlur(rng.uniform(0, 1, shape).astype(np.float32), (0, 0), 3)
    return mask.astype(np.float32) / 255 * density


def _block_alpha(rng, shape, r0, r1, c0, c1):
    """A filled area whose edges wobble from just outside to a little inside its tiles."""
    corners = np.array([(c0, r0), (c1 + 1, r0), (c1 + 1, r1 + 1), (c0, r1 + 1)], float)
    outline = []
    for i in range(4):
        start, side = corners[i], corners[(i + 1) % 4] - corners[i]
        length = math.hypot(*side)
        inward = np.array([-side[1], side[0]]) / length
        n = max(4, int(length * 4))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        outline.append(start + t * side + _wobble(rng, n, -0.05, 0.15)[:, None] * inward)
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.round(np.concatenate(outline) * TILE * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    density = 0.88 + 0.12 * cv2.GaussianBlur(rng.uniform(0, 1, shape).astype(np.float32), (0, 0), 4)
    return mask.astype(np.float32) / 255 * density


def _row_line(rng, r, c0, c1, pen, drift):
    """A hand-drawn line along row r: starts and ends inside its end tiles, wanders a little."""
    x0, x1 = c0 + 0.15 + pen / 2, c1 + 0.85 - pen / 2
    xs = np.linspace(x0, x1, max(8, int((x1 - x0) * 3)))
    slope = rng.uniform(-1, 1) * drift * np.linspace(-1, 1, len(xs))
    ys = r + 0.5 + slope + _wobble(rng, len(xs), -drift / 2, drift / 2)
    return np.stack([xs, ys], 1)


def _zigzag(rng, r, c0, c1, pen):
    period = rng.uniform(0.75, 0.95)
    xs = np.arange(c0 + 0.2, c1 + 0.85, period / 2)
    top, bottom = r + pen / 2 + 0.06, r + 1 - pen / 2 - 0.06
    ys = np.where(np.arange(len(xs)) % 2 == 0, bottom, top) + rng.uniform(-0.03, 0.03, len(xs))
    return np.stack([xs, ys], 1)


def _pencil(rng, card, count):
    """Faint guide lines (ruled or freehand) that are not part of the stage and must be ignored."""
    h, w = card.shape[:2]
    alpha = np.zeros((h, w), np.uint8)
    for i in range(count):
        if i % 3 == 2:  # a short vertical tick
            x, y = rng.uniform(0.1, 0.9) * w, rng.uniform(0.2, 0.7) * h
            p, q = (x, y), (x + rng.uniform(-8, 8), y + rng.uniform(60, 150))
        else:  # a long ruled line across a few tiles, in a row or near a row boundary
            y = (int(rng.integers(3, ROWS - 2)) + rng.uniform(0.2, 1.0)) * TILE
            x = rng.uniform(0.05, 0.5) * w
            p, q = (x, y), (x + rng.uniform(0.3, 0.5) * w, y + rng.uniform(-6, 6))
        cv2.line(alpha, tuple(int(v * 16) for v in p), tuple(int(v * 16) for v in q), 255,
                 int(rng.integers(3, 5)), cv2.LINE_AA, shift=4)
    graphite = srgb_to_linear(rng.uniform(150, 185) / 255) / srgb_to_linear(PAPER_SRGB / 255)
    opacity = alpha.astype(np.float32)[..., None] / 255
    return card * (1 - opacity * (1 - graphite))


def render_card(rng, spec):
    h, w = ROWS * TILE, COLS * TILE
    card = _paper(rng, h, w)
    if spec["pencil"]:
        card = _pencil(rng, card, spec["pencil"])
    layers = {}
    for kind, code, *where in DESIGNS[spec["design"]]:
        if kind == "block":
            alpha = _block_alpha(rng, (h, w), *where)
        elif kind == "line":
            alpha = _line_alpha(rng, (h, w), _row_line(rng, *where, spec["pen"], spec["drift"]), spec["pen"])
        else:
            pen = min(spec["pen"], 0.32)  # spikes are always drawn with a thin stroke
            alpha = _line_alpha(rng, (h, w), _zigzag(rng, where[0], where[2], where[3], pen), pen)
        layers[code] = 1 - (1 - layers.get(code, 0)) * (1 - alpha)
    for code, alpha in layers.items():
        ink = _ink_factor({**DEFAULT_INKS, **spec["inks"]}[code])
        card = card * (1 - alpha[..., None] * (1 - ink))
    return card


# --- photographing ---------------------------------------------------------------------------------

def _rotation(yaw, pitch, roll):
    # Positive pitch tips the top of the card away from the phone, as when shooting a card in front of you.
    y, p, r = np.radians([yaw, -pitch, roll])
    rz = np.array([[math.cos(y), -math.sin(y), 0], [math.sin(y), math.cos(y), 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    ry = np.array([[math.cos(r), 0, math.sin(r)], [0, 1, 0], [-math.sin(r), 0, math.cos(r)]])
    return rx @ ry @ rz  # spin the card on the table, then tilt the phone


def card_quad(rng, spec):
    """Corners (card TL, TR, BR, BL) in the photo: a pinhole camera with a phone's field of view.

    The card covers spec["cover"] of the frame, or less when a steep angle would push it out of frame.
    """
    frame_w, frame_h = spec["frame"]
    f = max(frame_w, frame_h) / 2 / math.tan(math.radians(spec["fov"]) / 2)
    corners = np.array([[-CARD_ASPECT, -1, 0], [CARD_ASPECT, -1, 0], [CARD_ASPECT, 1, 0], [-CARD_ASPECT, 1, 0]])
    tilted = corners @ _rotation(spec["yaw"], spec["pitch"], spec["roll"]).T

    def project(z):
        p = tilted + [0, 0, z]
        return f * p[:, :2] / p[:, 2:3]

    margin = 0.04 * min(frame_w, frame_h)
    cover, z = spec["cover"], 6.0
    while True:
        for _ in range(5):  # area goes as 1 / z^2
            z *= math.sqrt(cv2.contourArea(project(z).astype(np.float32)) / (cover * frame_w * frame_h))
        quad = project(z)
        room = np.array([frame_w, frame_h]) - 2 * margin - np.ptp(quad, axis=0)
        if (room >= 0).all():
            return quad - quad.min(0) + margin + rng.uniform(0.2, 0.8, 2) * room
        cover *= 0.95


def _table(rng, w, h, kind):
    colour, texture = TABLES[kind]
    low = cv2.resize(rng.normal(0, 1, (5, 7)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    if texture == "wood":
        grain = cv2.resize(rng.normal(0, 1, (h // 4, 6)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
        shade = 1 + 0.08 * low + 0.25 * grain
    else:
        shade = 1 + 0.05 * low + 0.04 * cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.7)
    return np.clip(shade[..., None] * np.array(colour, np.float32), 0, 1)


def _shadow(spec, quad, w, h):
    """Light left per pixel under a shadow edge that crosses `part` of the card."""
    s = spec["shadow"]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    n = np.array([math.cos(math.radians(s["angle"])), math.sin(math.radians(s["angle"]))])
    along = quad @ n
    edge = along.max() - s["part"] * np.ptp(along)
    dist = xx * n[0] + yy * n[1] - edge
    return 1 - (1 - s["shade"]) / (1 + np.exp(-np.clip(dist / s["softness"], -50, 50)))


def _glare(spec, quad, card_to_photo, w, h):
    g = spec["glare"]
    u, v = g["at"]
    centre = cv2.perspectiveTransform(np.float32([[[u * COLS * TILE, v * ROWS * TILE]]]), card_to_photo)[0, 0]
    radius = g["size"] * np.linalg.norm(quad[1] - quad[0])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return g["strength"] * np.exp(-((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2) / (2 * radius ** 2))


def _motion_kernel(length, angle):
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1
    turn = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), angle, 1.0)
    kernel = cv2.warpAffine(kernel, turn, (length, length))
    return kernel / kernel.sum()


def render_photo(spec):
    """JPEG bytes of the card in spec photographed on a table."""
    rng = np.random.default_rng(spec["seed"])
    w, h = spec["frame"]
    card = render_card(rng, spec)
    quad = card_quad(rng, spec)
    ch, cw = card.shape[:2]
    shrink = math.sqrt(cv2.contourArea(quad.astype(np.float32)) / (cw * ch))
    if shrink < 1:  # pre-blur so the warp does not alias thin lines
        card = cv2.GaussianBlur(card, (0, 0), 0.5 / shrink)
    to_photo = cv2.getPerspectiveTransform(np.float32([[0, 0], [cw, 0], [cw, ch], [0, ch]]), quad.astype(np.float32))
    card_img = cv2.warpPerspective(card, to_photo, (w, h), flags=cv2.INTER_LINEAR)
    alpha = cv2.warpPerspective(np.ones((ch, cw), np.float32), to_photo, (w, h), flags=cv2.INTER_LINEAR)

    table = _table(rng, w, h, spec["table"])
    lift = cv2.GaussianBlur(np.roll(alpha, (6, 4), (0, 1)), (0, 0), 8)  # soft contact shadow of the card
    scene = table * (1 - 0.4 * lift[..., None]) * (1 - alpha[..., None]) + card_img * alpha[..., None]

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - w / 2) ** 2 + (yy - h / 2) ** 2) / ((w / 2) ** 2 + (h / 2) ** 2)
    light = spec["exposure"] * (1 - rng.uniform(0.15, 0.25) * r2)
    if spec["shadow"]:
        light = light * _shadow(spec, quad, w, h)
    scene = scene * light[..., None] * np.array(LIGHTS[spec["light"]], np.float32)
    if spec["glare"]:
        glow = _glare(spec, quad, to_photo, w, h)[..., None]
        scene = scene + glow * (1 - np.clip(scene, 0, 1))
    scene = cv2.GaussianBlur(scene, (0, 0), rng.uniform(0.7, 1.0))  # lens
    if spec["motion"]:
        scene = cv2.filter2D(scene, -1, _motion_kernel(int(spec["motion"]), rng.uniform(0, 180)))

    photo = linear_to_srgb(scene).astype(np.float32) * 255
    noise = spec["noise"]
    photo = photo + rng.normal(0, noise, (h, w, 1)) + rng.normal(0, noise / 2, (h, w, 3))
    photo = cv2.addWeighted(photo, 1.4, cv2.GaussianBlur(photo, (0, 0), 1.2), -0.4, 0)  # phone sharpening
    ok, jpeg = cv2.imencode(".jpg", np.clip(photo, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, spec["jpeg"]])
    assert ok
    return jpeg.tobytes()


def write_case(name, out_dir):
    """Render one case into out_dir; returns the photo path."""
    spec = spec_for(name)
    photo = Path(out_dir) / f"{name}.jpg"
    photo.write_bytes(render_photo(spec))
    grid = truth_grid(spec["design"]).tolist()
    photo.with_name(f"{name}.truth.json").write_text(json.dumps({"grid": grid}, separators=(",", ":")) + "\n")
    return photo


def main(out_dir):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    for name in [*CASES, *ODD_ORIENTATION]:
        print(write_case(name, out_dir))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "hard-samples")
