"""Turns a photo of a drawn index card into a grid of tile codes, with OpenCV only.

Steps: decode, find and warp the card, flatten the lighting, threshold one mask per marker
colour, sample the masks into the game grid, tidy the grid. Thresholds live in shared/vision.json.
"""

import base64
import itertools
import logging
import struct
import time

import cv2
import numpy as np

from config import GAME, load_vision

log = logging.getLogger("sketch")

EMPTY, SOLID, PASS, HAZARD = 0, 1, 2, 3
DETECT_MAX_SIDE = 640  # the card is searched for on a copy this size; corners are scaled back up
BACKGROUND_SCALE = 4  # lighting is estimated at 1/4 size, it only holds slow changes
GRID_COLORS = np.array([(240, 240, 240), (30, 30, 30), (210, 100, 30), (40, 40, 210)], np.uint8)  # BGR legend
# A small PNG can decode to a huge image (300 KB -> 100 Mpx, ~600 MB). The client always sends a
# 1280 px JPEG; anything over this many pixels is refused from its header, before decoding.
MAX_PIXELS = 40_000_000
UPSIDE_DOWN_INK_CENTRE = 0.40  # a landscape card whose ink centre is higher than this is turned over


class ImageTooLarge(ValueError):
    """The image header asks for more than MAX_PIXELS pixels."""


class _Timer:
    def __init__(self):
        self.times = {}
        self._last = time.perf_counter()

    def lap(self, name):
        now = time.perf_counter()
        self.times[name] = round((now - self._last) * 1000, 1)
        self._last = now


def scan_image(data, vision_cfg=None, debug=False):
    """Photo bytes -> {grid, cardDetected, warped, timings, debug}. Raises ValueError if undecodable."""
    cfg = vision_cfg if vision_cfg is not None else load_vision()
    timer = _Timer()
    img = decode_image(data)
    timer.lap("decode")

    card = find_card(img, cfg["detect"])
    corners, sideways = card if card is not None else (None, False)
    warped = warp_card(img, corners, cfg)
    timer.lap("warp")

    masks = colour_masks(normalize(warped, cfg["normalize"]), cfg)
    # Which end is up can't be told from the outline, so assume the ground is drawn low on the card.
    # A card photographed sideways is turned when most ink is in the top half; one in landscape only
    # when the ink sits clearly high (a judge photographing it from across the table): drawn cards
    # put their ink centre at 0.56-0.78 of the height, upside-down ones at about 0.33.
    centre = _ink_centre(masks)
    if card is not None and centre is not None and centre < (0.5 if sideways else UPSIDE_DOWN_INK_CENTRE):
        warped = cv2.rotate(warped, cv2.ROTATE_180)
        masks = {name: cv2.rotate(m, cv2.ROTATE_180) for name, m in masks.items()}
    timer.lap("masks")

    grid = clean_grid(sample_grid(masks, cfg["colors"]), cfg.get("cleanup", {}))
    timer.lap("grid")

    t = timer.times
    log.info("vision: decode %.1f ms, warp %.1f ms, masks %.1f ms, grid %.1f ms, card %s",
             t["decode"], t["warp"], t["masks"], t["grid"], "found" if card is not None else "not found")
    return {
        "grid": grid,
        "cardDetected": card is not None,
        "warped": warped,
        "timings": t,
        "debug": _debug_images(warped, masks, grid) if debug else None,
    }


def decode_image(data):
    """BGR image from file bytes. Raises ValueError if undecodable, ImageTooLarge if too many pixels."""
    data = bytes(data or b"")
    size = image_size(data)
    if size is not None and size[0] * size[1] > MAX_PIXELS:
        raise ImageTooLarge(f"That photo is too big ({size[0]} x {size[1]} pixels)")
    buf = np.frombuffer(data, np.uint8)
    try:
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR) if buf.size else None
    except cv2.error as e:
        raise ValueError(f"could not decode image: {e}") from None
    if img is None or img.size == 0:
        raise ValueError("could not decode image")
    if img.shape[0] * img.shape[1] > MAX_PIXELS:  # a format image_size does not read
        raise ImageTooLarge(f"That photo is too big ({img.shape[1]} x {img.shape[0]} pixels)")
    return img


def image_size(data):
    """(width, height) from a PNG, JPEG, GIF, BMP or WebP header, or None if not one of those."""
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", data[16:24])
        if data[:6] in (b"GIF87a", b"GIF89a"):
            return struct.unpack("<HH", data[6:10])
        if data[:2] == b"BM":
            w, h = struct.unpack("<ii", data[18:26])
            return abs(w), abs(h)
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8X":
                return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
            if chunk == b"VP8L":
                bits = int.from_bytes(data[21:25], "little")
                return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
            if chunk == b"VP8 ":
                w, h = struct.unpack("<HH", data[26:30])
                return w & 0x3FFF, h & 0x3FFF
            return None
        if data[:2] == b"\xff\xd8":
            return _jpeg_size(data)
    except struct.error:
        return None
    return None


def _jpeg_size(data):
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        if marker in (0x01, *range(0xD0, 0xDA)):  # no length; 0xD9 = end, 0xDA = scan start
            if marker in (0xD9, 0xDA):
                return None
            i += 2
            continue
        (length,) = struct.unpack(">H", data[i + 2:i + 4])
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):  # start of frame
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + length
    return None


def encode_jpeg(img, quality=85):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])
    if not ok:
        raise ValueError("could not encode image")
    return buf.tobytes()


# --- finding the card ------------------------------------------------------------------------

def find_card(img, cfg):
    """Card corners in img as (4x2 float32 TL, TR, BR, BL; sideways flag), or None.

    sideways means the card's long side was closer to vertical than horizontal in the photo,
    so which end is up cannot be told from the outline.
    """
    h, w = img.shape[:2]
    scale = min(1.0, DETECT_MAX_SIDE / max(h, w))
    if scale < 1:  # explicit size: a 1 px side would round to 0 px with fx/fy
        small = cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    else:
        small = img
    k = int(cfg["blur"]) | 1
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (k, k), 0)
    outlines = [_contours_from_edges(gray, cfg), _contours_from_paper(gray)]
    # Convex hulls first (they ignore ink that reaches the card edge); then, if no hull gave a card,
    # the raw outlines, where something lying across the card edge (a fingertip pinning a corner)
    # adds sides of its own that the hull would have swallowed together with a side of the card.
    for quads in ([_quads_from_contours(c, gray.shape, cfg) for c in outlines]
                  + [_quads_from_raw_contours(c, gray.shape, cfg) for c in outlines]):
        for quad in quads:
            if _plausible_card(quad, gray, cfg):
                corners, sideways = order_corners(quad)
                return corners / scale, sideways
    return None


def _contours_from_edges(gray, cfg):
    edges = cv2.Canny(gray, cfg["cannyLow"], cfg["cannyHigh"])
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))  # bridge small gaps in the outline
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return contours


def _contours_from_paper(gray):
    """Fallback: the largest bright region (white paper on a darker table)."""
    _, paper = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    paper = cv2.morphologyEx(paper, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    contours, _ = cv2.findContours(paper, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return contours


def _largest(contours, shape, cfg, tries=3):
    """(contour, hull) for the largest few outlines by hull area, down to minAreaFraction."""
    min_area = cfg["minAreaFraction"] * shape[0] * shape[1]
    pairs = sorted(((c, cv2.convexHull(c)) for c in contours), key=lambda p: cv2.contourArea(p[1]), reverse=True)
    return [(c, hull) for c, hull in pairs[:tries] if cv2.contourArea(hull) >= min_area]


def _quads_from_contours(contours, shape, cfg):
    """Quadrilaterals around the largest contours' convex hulls (lazily: a generator)."""
    for _, hull in _largest(contours, shape, cfg):
        quad = hull_to_quad(hull, cfg["approxEpsilon"])
        if quad is not None:
            yield quad


def _quads_from_raw_contours(contours, shape, cfg, longest=6, max_growth=1.25):
    """Quads from 4 of the 6 longest straight sides of each large raw outline, biggest first."""
    for contour, hull in _largest(contours, shape, cfg):
        pts = cv2.approxPolyDP(contour, cfg["approxEpsilon"] * cv2.arcLength(contour, True), True)
        pts = pts.reshape(-1, 2).astype(np.float64)
        if len(pts) < 4:
            continue
        sides = _straight_sides(pts, 5)
        if len(sides) < 4:
            continue
        lengths = [np.linalg.norm(b - a) for a, b in sides]
        keep = sorted(np.argsort(lengths)[-longest:])
        limit = max_growth * cv2.contourArea(hull)
        quads = []
        for combo in itertools.combinations(keep, 4):
            chosen = [sides[i] for i in combo]
            corners = [_intersect(chosen[i - 1], chosen[i]) for i in range(4)]
            if any(c is None for c in corners):
                continue
            quad = np.array(corners, np.float32)
            area = cv2.contourArea(quad)
            if 0 < area <= limit and cv2.isContourConvex(quad.reshape(-1, 1, 2)):
                quads.append((area, quad))
        for _, quad in sorted(quads, key=lambda q: -q[0]):
            yield quad


def hull_to_quad(hull, epsilon, max_bend_deg=5, max_growth=1.1):
    """Four corners from a convex hull: the four longest straight sides, extended until they meet.

    Extending the sides rebuilds a corner that ink cut off (dark ink on a dark table looks like table).
    A result much bigger than the hull means the sides were not the card's, e.g. table edges joined in.
    """
    pts = cv2.approxPolyDP(hull, epsilon * cv2.arcLength(hull, True), True).reshape(-1, 2).astype(np.float64)
    if len(pts) < 4:
        return None
    sides = _straight_sides(pts, max_bend_deg)
    if len(sides) < 4:
        return None
    lengths = [np.linalg.norm(b - a) for a, b in sides]
    keep = sorted(np.argsort(lengths)[-4:])
    sides = [sides[i] for i in keep]
    corners = [_intersect(sides[i - 1], sides[i]) for i in range(4)]
    if any(c is None for c in corners):
        return None
    quad = np.array(corners, np.float32)
    if cv2.contourArea(quad) > max_growth * cv2.contourArea(hull):
        return None
    return quad


def _straight_sides(pts, max_bend_deg):
    """Polygon sides as (start, end) pairs, merging neighbours that turn by less than max_bend_deg."""
    n = len(pts)
    vectors = np.roll(pts, -1, axis=0) - pts
    angles = np.degrees(np.arctan2(vectors[:, 1], vectors[:, 0]))
    turns = np.abs((angles - np.roll(angles, 1) + 180) % 360 - 180)  # turn into side i from side i-1
    start = int(np.argmax(turns))  # a real corner, so no merged side wraps around the start
    sides = []
    for k in range(n):
        i = (start + k) % n
        if sides and turns[i] < max_bend_deg:
            sides[-1] = (sides[-1][0], pts[(i + 1) % n])
        else:
            sides.append((pts[i], pts[(i + 1) % n]))
    return sides


def _intersect(line_a, line_b):
    (p, p2), (q, q2) = line_a, line_b
    r, s = p2 - p, q2 - q
    denom = r[0] * s[1] - r[1] * s[0]
    if abs(denom) < 1e-6 * np.linalg.norm(r) * np.linalg.norm(s):
        return None
    t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denom
    return p + t * r


def _plausible_card(quad, gray, cfg):
    h, w = gray.shape
    if not cv2.isContourConvex(quad.reshape(-1, 1, 2)):
        return False
    area = cv2.contourArea(quad) / (w * h)
    if not cfg["minAreaFraction"] <= area <= cfg["maxAreaFraction"]:
        return False
    sides = np.linalg.norm(quad - np.roll(quad, -1, axis=0), axis=1)
    pair_a, pair_b = sides[0] + sides[2], sides[1] + sides[3]
    if not 1.1 <= max(pair_a, pair_b) / max(min(pair_a, pair_b), 1e-6) <= 3.0:
        return False
    # The whole card is in frame, and a region running into two image borders is table or wall.
    slack = 0.01 * min(h, w)
    if (quad < -slack).any() or (quad[:, 0] > w - 1 + slack).any() or (quad[:, 1] > h - 1 + slack).any():
        return False
    margin = 2
    touching = [quad[:, 0].min() < margin, quad[:, 1].min() < margin,
                quad[:, 0].max() > w - 1 - margin, quad[:, 1].max() > h - 1 - margin]
    if sum(touching) >= 2:
        return False
    if not all(_side_is_card_edge(quad, i, gray, cfg["minContrast"] / 2) for i in range(4)):
        return False
    # Paper is brighter than the table around it.
    inside = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(inside, np.round(quad).astype(np.int32), 255)
    ring_px = max(3, int(0.03 * min(h, w)))
    ring = cv2.dilate(inside, np.ones((ring_px, ring_px), np.uint8)) & ~inside
    if not ring.any():
        return False
    return np.median(gray[inside > 0]) - np.median(gray[ring > 0]) >= cfg["minContrast"]


def _side_is_card_edge(quad, i, gray, min_step, min_fraction=0.5):
    """Along most of side i it is brighter just inside than just outside. Fails for a side through the table."""
    a, b = quad[i], quad[(i + 1) % 4]
    inward = (quad.mean(axis=0) - (a + b) / 2) * 0.04  # about half a tile, measured towards the centre
    on_side = a + np.linspace(0.1, 0.9, 17)[:, None] * (b - a)
    inner, outer = np.round(on_side + inward).astype(int), np.round(on_side - inward).astype(int)
    h, w = gray.shape
    valid = np.all((inner >= 0) & (outer >= 0) & (inner < (w, h)) & (outer < (w, h)), axis=1)
    if not valid.any():
        return False
    inner, outer = inner[valid], outer[valid]
    step = gray[inner[:, 1], inner[:, 0]].astype(int) - gray[outer[:, 1], outer[:, 0]]
    return np.mean(step >= min_step) >= min_fraction


def order_corners(quad):
    """(TL, TR, BR, BL) with the card's long sides horizontal, and whether the card lay sideways."""
    centre = quad.mean(axis=0)
    q = quad[np.argsort(np.arctan2(quad[:, 1] - centre[1], quad[:, 0] - centre[0]))]  # clockwise, y down
    sides = np.linalg.norm(np.roll(q, -1, axis=0) - q, axis=1)  # side i runs q[i] -> q[i+1]
    first_long = 0 if sides[0] + sides[2] >= sides[1] + sides[3] else 1

    def rightwardness(i):
        d = q[(i + 1) % 4] - q[i]
        return d[0] / (np.linalg.norm(d) + 1e-9)

    top = max((first_long, first_long + 2), key=rightwardness)
    return np.roll(q, -top, axis=0).astype(np.float32), rightwardness(top) < 0.5


def warp_card(img, corners, cfg):
    """The card as a landscape image of the configured size; the whole photo if no card was found."""
    size = (cfg["warp"]["width"], cfg["warp"]["height"])
    if corners is None:
        return cv2.resize(img, size, interpolation=cv2.INTER_AREA)
    w, h = size
    m = cfg["detect"].get("insetPx", 0)  # map the corners slightly outside the output to crop the card's rim
    dst = np.float32([[-m, -m], [w - 1 + m, -m], [w - 1 + m, h - 1 + m], [-m, h - 1 + m]])
    transform = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)
    return cv2.warpPerspective(img, transform, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


# --- colour masks -----------------------------------------------------------------------------

def normalize(warped, cfg):
    """Warped BGR card -> HSV with even lighting and white paper."""
    img = flat_field(warped, cfg["flatFieldKernel"]) if cfg.get("flatField", True) else warped
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    if cfg.get("clahe"):
        grid = int(cfg["claheTileGrid"])
        clahe = cv2.createCLAHE(clipLimit=float(cfg["claheClipLimit"]), tileGridSize=(grid, grid))
        hsv[..., 2] = clahe.apply(hsv[..., 2])
    return hsv


def flat_field(img, kernel):
    """Divide each channel by the paper's own brightness there: removes shadows, vignette and colour casts."""
    h, w = img.shape[:2]
    small = cv2.resize(img, (w // BACKGROUND_SCALE, h // BACKGROUND_SCALE), interpolation=cv2.INTER_AREA)
    k = max(3, int(kernel) // BACKGROUND_SCALE) | 1
    # Closing replaces ink narrower than the kernel with the paper around it.
    background = cv2.morphologyEx(small, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    # Ink areas wider than the kernel survive the closing; give them the typical paper colour instead.
    # Paper vs ink is judged on the darkest channel (a wide red or blue fill is dark in one), median
    # filtered so paper specks inside a filled block don't pass for paper, against a low bar: paper
    # under a hard shadow that takes half the light or more must still count as paper, or dividing
    # by lit paper turns the shadowed half of the card into solid ground.
    darkest = np.ascontiguousarray(small.min(axis=2))
    paper = cv2.medianBlur(darkest, min(k, 255)) >= 0.3 * np.percentile(background.min(axis=2), 90)
    if paper.any() and not paper.all():
        background[~paper] = np.median(background[paper], axis=0)
    background = cv2.blur(background, (k, k))
    background = cv2.resize(background, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.divide(img, np.maximum(background, 1), scale=255)


def colour_masks(hsv, cfg):
    """{solid, pass, hazard}: binary masks.

    Per colour: threshold, OPEN (drops specks), fill closed outlines if the colour asks for it
    (people outline a platform rather than colour it in), then DILATE so thin lines cover tiles.
    Dark pens are both dark and coloured, so a pixel that matches blue or red is never black ink.
    """
    morph = cfg["morph"]
    open_k = _ellipse(morph["openPx"])
    dilate_k = _ellipse(morph["dilatePx"])
    raw = {name: _in_ranges(hsv, spec["ranges"]) for name, spec in cfg["colors"].items()}
    coloured = np.zeros_like(raw["solid"])
    for name in ("pass", "hazard"):
        coloured |= cv2.dilate(raw[name], _ellipse(3))
    raw["solid"] &= cv2.bitwise_not(coloured)

    masks = {}
    for name, spec in cfg["colors"].items():
        mask = raw[name]
        if open_k is not None:
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_k)
        if spec.get("fillOutlines"):
            mask = fill_outlines(mask, morph.get("closePx", 9), morph.get("maxFillFraction", 0.3))
        if dilate_k is not None:
            mask = cv2.dilate(mask, dilate_k)
        masks[name] = mask
    return masks


def _in_ranges(hsv, ranges):
    mask = np.zeros(hsv.shape[:2], np.uint8)
    for r in ranges:
        mask |= cv2.inRange(hsv, (r["hMin"], r["sMin"], r["vMin"]), (r["hMax"], r["sMax"], r["vMax"]))
    return mask


def fill_outlines(mask, close_px, max_fraction):
    """Fill regions enclosed by ink, after bridging gaps up to close_px in the hand-drawn line.

    Enclosed regions bigger than max_fraction of the card are left alone: that is the card's own
    border or a frame drawn round everything, not a platform.
    """
    close_k = _ellipse(close_px)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_k) if close_k is not None else mask
    h, w = closed.shape
    outside = cv2.copyMakeBorder(closed, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(outside, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 255)
    holes = cv2.bitwise_not(outside)[1:-1, 1:-1]
    n, labels, stats, _ = cv2.connectedComponentsWithStats(holes, connectivity=4)
    small = np.zeros(n, bool)
    small[1:] = stats[1:, cv2.CC_STAT_AREA] <= max_fraction * h * w
    filled = np.where(small[labels], 255, 0).astype(np.uint8)
    return closed | filled


def _ellipse(px):
    px = int(px)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px, px)) if px > 1 else None


def _ink_centre(masks):
    """Height of the ink's centre of mass as a fraction of the card height (0 top), None if no ink."""
    ink = masks["solid"] | masks["pass"] | masks["hazard"]
    m = cv2.moments(ink, binaryImage=True)
    return m["m01"] / m["m00"] / ink.shape[0] if m["m00"] > 0 else None


# --- grid -------------------------------------------------------------------------------------

def sample_grid(masks, colors):
    """A tile takes a colour when that mask covers enough of it. Later codes win: hazard > solid > pass."""
    cols, rows = GAME["cols"], GAME["rows"]
    grid = np.zeros((rows, cols), np.uint8)
    for name, code in (("pass", PASS), ("solid", SOLID), ("hazard", HAZARD)):
        coverage = cv2.resize(masks[name], (cols, rows), interpolation=cv2.INTER_AREA) / 255.0
        grid[covered_tiles(coverage, colors[name]["coverage"])] = code
    return grid


def covered_tiles(coverage, threshold):
    """Tiles at or over threshold, plus lines that fall between two rows (or columns).

    A marker line drawn across a tile boundary can leave each tile under the threshold although
    the pair holds the whole line. When two neighbours sum to the threshold and stand out from
    the tiles either side of them, the fuller one is taken.
    """
    hits = coverage >= threshold
    across_rows = _split_lines(coverage, hits, threshold)
    # Vertical lines between two columns skip tiles with a hit above or below: along a horizontal
    # stroke the spill into the next row wobbles enough to look like short vertical lines.
    across_cols = _split_lines(coverage.T, hits.T, threshold, skip_beside_hits=True).T
    return hits | across_rows | across_cols


def _split_lines(coverage, hits, threshold, skip_beside_hits=False):
    """The fuller tile of each pair (a tile and the one below it) that holds a line between them."""
    a, b = coverage[:-1], coverage[1:]
    zero = np.zeros((1, coverage.shape[1]))
    above = np.vstack([zero, coverage[:-2]])
    below = np.vstack([coverage[2:], zero])
    split = (a + b >= threshold) & ~hits[:-1] & ~hits[1:] & (above < a) & (below < b)
    if skip_beside_hits:
        beside = np.zeros_like(hits)
        beside[:, 1:] |= hits[:, :-1]
        beside[:, :-1] |= hits[:, 1:]
        split &= ~beside[:-1] & ~beside[1:]
    out = np.zeros_like(hits)
    out[:-1] |= split & (a >= b)
    out[1:] |= split & (a < b)
    return out


def clean_grid(grid, cfg):
    """Drop tiles with no filled neighbour; fill empty tiles enclosed on four sides by solid."""
    grid = grid.copy()
    if cfg.get("removeIsolated", True):
        filled = grid != EMPTY
        grid[filled & (_neighbours(filled, diagonal=True) == 0)] = EMPTY
    if cfg.get("fillHoles", True):
        solid = grid == SOLID
        grid[(grid == EMPTY) & (_neighbours(solid, diagonal=False) == 4)] = SOLID
    return grid


def _neighbours(mask, diagonal):
    p = np.pad(mask.astype(np.uint8), 1)
    h, w = mask.shape
    offsets = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if diagonal:
        offsets += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    return sum(p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy, dx in offsets)


# --- debug images -----------------------------------------------------------------------------

def render_grid(grid, tile_px=12):
    """The grid drawn in the marker legend colours, with faint tile lines."""
    img = GRID_COLORS[np.repeat(np.repeat(np.minimum(grid, HAZARD), tile_px, 0), tile_px, 1)]
    img[::tile_px, :] = (img[::tile_px, :] * 0.85).astype(np.uint8)
    img[:, ::tile_px] = (img[:, ::tile_px] * 0.85).astype(np.uint8)
    return img


def _data_url(img, ext):
    params = [cv2.IMWRITE_JPEG_QUALITY, 80] if ext == ".jpg" else [cv2.IMWRITE_PNG_COMPRESSION, 6]
    ok, buf = cv2.imencode(ext, img, params)
    mime = "image/jpeg" if ext == ".jpg" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.tobytes()).decode('ascii')}"


def _debug_images(warped, masks, grid):
    half = (warped.shape[1] // 2, warped.shape[0] // 2)
    return {
        "warped": _data_url(cv2.resize(warped, half, interpolation=cv2.INTER_AREA), ".jpg"),
        "masks": {name: _data_url(cv2.resize(m, half, interpolation=cv2.INTER_AREA), ".png")
                  for name, m in masks.items()},
        "grid": _data_url(render_grid(grid), ".png"),
    }
