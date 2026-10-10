"""Adversarial vision tests: harder-but-fair phone photos of drawn cards, and odd uploads.

The photos come from tools/make_hard_samples.py (steep perspective, a small card, tungsten light,
hard shadows, motion blur, a light-grey table, glare, fine-tip strokes, pencil guides, an orange-ish
red, a purple-ish blue, portrait photos, an upside-down card, a fingertip on the card). They are
rendered into a pytest temp folder, never into samples/.

Fair targets for a judge's phone photo at a hackathon table where the card is clearly visible:
  - the card is found;
  - at least 90% of the 40 x 24 tiles are right;
  - for each legend colour drawn on the card, at least 75% of its tiles are found (recall) and at
    least 75% of the tiles called that colour are right (precision). Agreement alone is weak: an
    empty grid already agrees on ~85% of the tiles, so a lost colour hardly moves it;
  - the scan takes under 500 ms.

Cases vision.py misses today are xfail with the measured root cause (KNOWN_GAPS). They are not
strict: once vision.py or shared/vision.json is fixed they show up as XPASS, and the entry can go.
"""

import json
import time

import cv2
import numpy as np
import pytest

import vision
from config import GAME, load_vision
from tools import make_hard_samples as hard

ROWS, COLS = GAME["rows"], GAME["cols"]
WARP = load_vision()["warp"]
MIN_AGREEMENT = 0.90
MIN_RECALL = 0.75
MIN_PRECISION = 0.75
MAX_SCAN_MS = 500

KNOWN_GAPS = {
    "hard-shadow-across-ink": (
        "flat_field: paper in a shadow that takes half the light falls under 0.5 x the 90th-percentile "
        "level, is taken for a wide ink area and divided by lit paper, so it turns solid (solid precision 0.57)"),
    "hard-shadow-half-light": "same flat_field paper test as hard-shadow-across-ink",
    "hard-shadow-60pct": "same flat_field paper test as hard-shadow-across-ink",
    "red-photographs-orange": (
        "hazard hue range stops at hMax 10; this red photographs at hue ~12.4 and is lost entirely "
        "(recall 0); hMax 16 finds it"),
    "blue-photographs-purple": (
        "pass hue range stops at hMax 130; this blue photographs at hue ~132 and is lost entirely "
        "(recall 0); hMax 142 finds it"),
    "fingertip-on-corner-light-skin": (
        "find_card: the fingertip sticks out past the card edge, so the convex hull loses that side; "
        "hull_to_quad builds a wrong quad, _plausible_card rejects it and nothing else is tried"),
}
UPSIDE_DOWN_GAP = ("scan_image only turns sideways cards (ink in the top half -> rotate 180); a card "
                   "photographed from across the table is warped upside down")
ONE_PX_GAP = "find_card resizes with fx/fy; a 1 px side scales to 0 px and cv2.resize raises cv2.error"

FAIR = [c["name"] for c in hard.CASES if c["fair"]]
UPSIDE_DOWN = [c["name"] for c in hard.CASES if c.get("upside_down")]
STRESS = [c["name"] for c in hard.CASES if not c["fair"] and not c.get("upside_down")]


def _known(names):
    return [pytest.param(n, marks=pytest.mark.xfail(reason=KNOWN_GAPS[n], strict=False)) if n in KNOWN_GAPS
            else n for n in names]


@pytest.fixture(scope="module")
def hard_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("hard-samples")


@pytest.fixture(scope="module")
def photo(hard_dir):
    """name -> (jpeg bytes, truth grid); each case is rendered once into the temp folder."""
    def load(name):
        jpg = hard_dir / f"{name}.jpg"
        truth_file = hard_dir / f"{name}.truth.json"
        if not jpg.exists():
            data, truth = hard.render(name)
            jpg.write_bytes(data)
            truth_file.write_text(json.dumps({"grid": truth.tolist()}))
        return jpg.read_bytes(), np.array(json.loads(truth_file.read_text())["grid"], np.uint8)
    return load


def _check_result(result):
    grid, warped = result["grid"], result["warped"]
    assert isinstance(grid, np.ndarray) and grid.shape == (ROWS, COLS) and grid.dtype == np.uint8
    assert set(np.unique(grid)) <= {vision.EMPTY, vision.SOLID, vision.PASS, vision.HAZARD}
    assert warped.shape == (WARP["height"], WARP["width"], 3) and warped.dtype == np.uint8
    assert isinstance(result["cardDetected"], bool)
    assert set(result["timings"]) == {"decode", "warp", "masks", "grid"}
    assert all(isinstance(ms, float) for ms in result["timings"].values())


def _scan_ms(data, runs=2):
    """Best of a few runs: other work on the machine should not fail a timing test."""
    best = None
    for _ in range(runs):
        start = time.perf_counter()
        result = vision.scan_image(data)
        ms = (time.perf_counter() - start) * 1000
        best = ms if best is None else min(best, ms)
    return result, best


# --- hard but fair photos ---------------------------------------------------------------------

@pytest.mark.parametrize("name", _known(FAIR))
def test_hard_photo_meets_fair_targets(photo, name):
    data, truth = photo(name)
    result = vision.scan_image(data)
    _check_result(result)
    s = hard.score(result["grid"], truth)
    assert result["cardDetected"], "the card is clearly visible"
    assert s["agreement"] >= MIN_AGREEMENT, f"tile agreement {s['agreement']:.3f}"
    for colour in ("solid", "pass", "hazard"):
        c = s[colour]
        if c["truth"]:
            assert c["recall"] >= MIN_RECALL, f"{colour} recall {c['recall']:.2f} ({c['found']} found, {c['truth']} drawn)"
            assert c["precision"] >= MIN_PRECISION, f"{colour} precision {c['precision']:.2f}"


@pytest.mark.parametrize("name", FAIR + UPSIDE_DOWN + STRESS)
def test_hard_photo_scans_fast(photo, name):
    data, _ = photo(name)
    result, ms = _scan_ms(data)
    _check_result(result)
    assert ms < MAX_SCAN_MS, f"{ms:.0f} ms"


@pytest.mark.parametrize("name", STRESS)
def test_beyond_fair_photo_still_finds_the_card(photo, name):
    """Dry marker, pale table, a shadow taking 65% of the light, a 15% card at 35 deg, heavy blur:
    no accuracy target, but the card is in plain view and must still be found."""
    data, _ = photo(name)
    result = vision.scan_image(data)
    _check_result(result)
    assert result["cardDetected"]


def test_pencil_guides_and_an_uninked_pencil_outline_are_ignored(photo):
    data, truth = photo("pencil-guides")
    grid = vision.scan_image(data)["grid"]
    assert not ((grid != vision.EMPTY) & (truth == vision.EMPTY)).any(), "pencil scanned as ink"


def test_fine_tip_strokes_land_in_their_own_row(photo):
    data, truth = photo("thin-strokes")
    grid = vision.scan_image(data)["grid"]
    rows = np.unique(np.nonzero(truth == vision.PASS)[0])
    for r in rows:
        drawn = truth[r] == vision.PASS
        assert (grid[r][drawn] == vision.PASS).mean() >= 0.8, f"row {r}"


@pytest.mark.parametrize("name", ["portrait-photo-card-sideways-cw", "portrait-photo-card-sideways-ccw"])
def test_card_turned_sideways_in_a_portrait_photo_comes_out_upright(photo, name):
    data, truth = photo(name)
    grid = vision.scan_image(data)["grid"]
    assert hard.score(grid, truth)["agreement"] >= 0.95
    assert hard.score(grid, truth[::-1, ::-1])["agreement"] < 0.9


# --- upside-down card (documented behaviour) ---------------------------------------------------

@pytest.mark.parametrize("name", UPSIDE_DOWN)
def test_upside_down_card_is_found_and_read(photo, name):
    """The card is found and read either way up (today: upside down, see the next test)."""
    data, truth = photo(name)
    result = vision.scan_image(data)
    assert result["cardDetected"]
    best = max(hard.score(result["grid"], t)["agreement"] for t in (truth, truth[::-1, ::-1]))
    assert best >= 0.95


@pytest.mark.parametrize("name", UPSIDE_DOWN)
@pytest.mark.xfail(reason=UPSIDE_DOWN_GAP, strict=False)
def test_upside_down_card_comes_out_upright(photo, name):
    data, truth = photo(name)
    assert hard.score(vision.scan_image(data)["grid"], truth)["agreement"] >= 0.95


# --- odd uploads --------------------------------------------------------------------------------

def _encode(img, ext=".jpg", params=()):
    ok, buf = cv2.imencode(ext, img, list(params))
    assert ok
    return buf.tobytes()


def _flat(h, w, value=200, channels=3):
    return np.full((h, w, channels) if channels > 1 else (h, w), value, np.uint8)


ODD = {
    "1x1-jpeg": lambda: _encode(_flat(1, 1)),
    "1x1-png": lambda: _encode(_flat(1, 1), ".png"),
    "3x2-png": lambda: _encode(_flat(2, 3), ".png"),
    "16x10-jpeg": lambda: _encode(_flat(10, 16)),
    "3x2000-png": lambda: _encode(_flat(2000, 3), ".png"),
    "1x4000-png": lambda: _encode(_flat(4000, 1), ".png"),
    "4000x1-png": lambda: _encode(_flat(1, 4000), ".png"),
    "all-black": lambda: _encode(_flat(960, 1280, 0)),
    "all-white": lambda: _encode(_flat(960, 1280, 255)),
    "grey-1ch-jpeg": lambda: _encode(_flat(960, 1280, 120, channels=1)),
    "png-16bit": lambda: _encode(np.random.default_rng(0).integers(0, 65535, (300, 400, 3)).astype(np.uint16), ".png"),
    "png-fully-transparent": lambda: _encode(np.zeros((480, 640, 4), np.uint8), ".png"),
}
ODD_CRASHES = {"1x4000-png", "4000x1-png"}


@pytest.mark.parametrize("name", [pytest.param(n, marks=pytest.mark.xfail(reason=ONE_PX_GAP, strict=False))
                                  if n in ODD_CRASHES else n for n in ODD])
def test_odd_upload_never_raises(name):
    data = ODD[name]()
    result = vision.scan_image(data, debug=True)
    _check_result(result)
    assert result["debug"] is not None


def test_4000px_photo_is_scanned_like_the_small_one(photo):
    data, truth = photo("judge-at-table")
    big = cv2.resize(vision.decode_image(data), (4000, 3000), interpolation=cv2.INTER_CUBIC)
    result, ms = _scan_ms(_encode(big, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 90]))
    _check_result(result)
    assert result["cardDetected"]
    assert hard.score(result["grid"], truth)["agreement"] >= 0.95
    assert ms < MAX_SCAN_MS, f"{ms:.0f} ms"


def test_greyscale_jpeg_of_a_card_still_finds_the_drawing(photo):
    """No colour left: every marker reads as solid ground, but the card and the drawing come through."""
    data, truth = photo("perspective-28")
    grey = cv2.cvtColor(vision.decode_image(data), cv2.COLOR_BGR2GRAY)
    result = vision.scan_image(_encode(grey, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 90]))
    _check_result(result)
    assert result["cardDetected"]
    drawn = truth != vision.EMPTY
    assert (result["grid"][drawn] != vision.EMPTY).mean() >= MIN_RECALL


def test_png_with_alpha_scans_like_the_photo(photo):
    data, truth = photo("perspective-28")
    bgra = cv2.cvtColor(vision.decode_image(data), cv2.COLOR_BGR2BGRA)
    result = vision.scan_image(_encode(bgra, ".png"))
    _check_result(result)
    assert result["cardDetected"]
    assert hard.score(result["grid"], truth)["agreement"] >= 0.95


def test_scan_is_deterministic(photo):
    data, _ = photo("judge-at-table")
    a, b = vision.scan_image(data), vision.scan_image(data)
    assert np.array_equal(a["grid"], b["grid"]) and a["cardDetected"] == b["cardDetected"]
