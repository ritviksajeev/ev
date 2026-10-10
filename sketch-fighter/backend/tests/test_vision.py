"""Vision pipeline: the sample photos against their truth grids, no-card and bad input, grid rules."""

import base64
import json
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

import vision
from config import GAME, load_vision
from tools.make_samples import render_table

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "samples"
PHOTOS = sorted(p for p in SAMPLES_DIR.glob("*.jpg") if p.with_name(p.stem + ".truth.json").exists())
CLASSES = {vision.SOLID: "solid", vision.PASS: "pass", vision.HAZARD: "hazard"}


def _truth(photo):
    return np.array(json.loads(photo.with_name(photo.stem + ".truth.json").read_text())["grid"], np.uint8)


def _jpeg(img):
    return vision.encode_jpeg(img, 90)


def test_there_are_sample_photos_with_truth():
    assert len(PHOTOS) >= 8


@pytest.mark.parametrize("photo", PHOTOS, ids=lambda p: p.stem)
def test_sample_scans_match_truth(photo):
    result = vision.scan_image(photo.read_bytes())
    truth, grid = _truth(photo), result["grid"]

    assert result["cardDetected"]
    assert grid.shape == (GAME["rows"], GAME["cols"]) and grid.dtype == np.uint8
    assert (grid == truth).mean() >= 0.95
    for code, name in CLASSES.items():
        if not (truth == code).any():
            continue
        hits = ((grid == code) & (truth == code)).sum()
        assert hits / (truth == code).sum() >= 0.85, f"{name} recall"
        assert hits / max((grid == code).sum(), 1) >= 0.85, f"{name} precision"


@pytest.mark.parametrize("photo", PHOTOS, ids=lambda p: p.stem)
def test_sample_scan_is_fast(photo):
    data = photo.read_bytes()
    start = time.perf_counter()
    result = vision.scan_image(data)
    assert (time.perf_counter() - start) * 1000 < 500
    assert set(result["timings"]) == {"decode", "warp", "masks", "grid"}
    assert all(isinstance(ms, float) for ms in result["timings"].values())


def _noise():
    return np.random.default_rng(1).integers(0, 256, (960, 1280, 3), dtype=np.uint8)


def _plain_table():
    table = render_table(np.random.default_rng(2), 1280, 960, "walnut")
    return np.clip(table * 255, 0, 255).astype(np.uint8)


@pytest.mark.parametrize("make", [_noise, _plain_table], ids=["noise", "plain-table"])
def test_photo_without_a_card(make):
    result = vision.scan_image(_jpeg(make()))
    cfg = load_vision()["warp"]
    assert not result["cardDetected"]
    assert result["grid"].shape == (GAME["rows"], GAME["cols"])
    assert result["warped"].shape == (cfg["height"], cfg["width"], 3)


@pytest.mark.parametrize("data", [b"", b"not an image", b"\xff\xd8\xff\xe0 truncated jpeg"])
def test_undecodable_bytes_raise(data):
    with pytest.raises(ValueError, match="could not decode image"):
        vision.scan_image(data)


def _decode_data_url(url, mime):
    prefix = f"data:{mime};base64,"
    assert url.startswith(prefix)
    img = cv2.imdecode(np.frombuffer(base64.b64decode(url[len(prefix):]), np.uint8), cv2.IMREAD_UNCHANGED)
    assert img is not None
    return img


def test_debug_returns_data_urls_for_every_image():
    debug = vision.scan_image(PHOTOS[0].read_bytes(), debug=True)["debug"]
    _decode_data_url(debug["warped"], "image/jpeg")
    assert set(debug["masks"]) == {"solid", "pass", "hazard"}
    for url in debug["masks"].values():
        _decode_data_url(url, "image/png")
    grid = _decode_data_url(debug["grid"], "image/png")
    assert grid.shape[0] * GAME["cols"] == grid.shape[1] * GAME["rows"]


def test_debug_is_none_by_default():
    assert vision.scan_image(PHOTOS[0].read_bytes())["debug"] is None


def test_encode_jpeg_round_trips():
    img = np.full((60, 100, 3), 200, np.uint8)
    data = vision.encode_jpeg(img)
    assert data[:2] == b"\xff\xd8"
    assert vision.decode_image(data).shape == img.shape


# --- geometry -----------------------------------------------------------------------------------

def _rectangle(cx, cy, w, h, deg):
    box = cv2.boxPoints(((cx, cy), (w, h), deg))
    return np.random.default_rng(0).permutation(box).astype(np.float32)


def test_order_corners_puts_the_long_side_on_top():
    corners, sideways = vision.order_corners(_rectangle(300, 200, 250, 150, 12))
    top, right = corners[1] - corners[0], corners[2] - corners[1]
    assert not sideways
    assert top[0] > 0 and np.linalg.norm(top) > np.linalg.norm(right)
    assert corners[0][1] < corners[3][1]  # TL above BL


def test_order_corners_flags_a_card_lying_sideways():
    corners, sideways = vision.order_corners(_rectangle(300, 200, 150, 250, 5))
    assert sideways
    assert np.linalg.norm(corners[1] - corners[0]) > np.linalg.norm(corners[2] - corners[1])


def test_hull_to_quad_rebuilds_a_corner_hidden_by_ink():
    # A 500 x 300 card whose bottom-left corner is cut off by a dark block.
    hull = np.array([[0, 0], [500, 0], [500, 300], [120, 300], [0, 240]], np.int32).reshape(-1, 1, 2)
    quad = vision.hull_to_quad(hull, 0.005)
    expected = np.array([[0, 0], [500, 0], [500, 300], [0, 300]], np.float32)
    assert sorted(map(tuple, np.round(quad))) == sorted(map(tuple, expected))


# --- grid rules ---------------------------------------------------------------------------------

def test_line_split_between_two_rows_is_kept_once():
    coverage = np.zeros((6, 8))
    coverage[2, 1:7] = 0.25  # a thin line on the boundary of rows 2 and 3
    coverage[3, 1:7] = 0.22
    tiles = vision.covered_tiles(coverage, 0.4)
    assert tiles[2, 1:7].all()
    assert tiles.sum() == 6


def test_spill_beside_a_stroke_is_not_a_line():
    coverage = np.zeros((6, 8))
    coverage[2, :] = 0.9  # a stroke
    coverage[3, :] = [0.25, 0.2, 0.3, 0.15, 0.3, 0.1, 0.25, 0.2]  # wobbly spill below it
    tiles = vision.covered_tiles(coverage, 0.4)
    assert tiles[2].all() and not tiles[3].any()


def test_clean_grid_drops_isolated_tiles_and_fills_holes():
    grid = np.zeros((6, 8), np.uint8)
    grid[0, 7] = vision.PASS  # isolated
    grid[2:5, 1:6] = vision.SOLID
    grid[3, 3] = vision.EMPTY  # a one-tile hole
    cleaned = vision.clean_grid(grid, {"removeIsolated": True, "fillHoles": True})
    assert cleaned[0, 7] == vision.EMPTY
    assert cleaned[3, 3] == vision.SOLID
    assert (cleaned[2:5, 1:6] == vision.SOLID).all()


def test_hazard_wins_over_solid_and_solid_over_pass():
    rows, cols = GAME["rows"], GAME["cols"]
    masks = {name: np.zeros((rows * 25, cols * 25), np.uint8) for name in ("solid", "pass", "hazard")}
    masks["pass"][:, :] = 255
    masks["solid"][: rows * 25 // 2, :] = 255
    masks["hazard"][:25, :] = 255
    grid = vision.sample_grid(masks, load_vision()["colors"])
    assert (grid[0] == vision.HAZARD).all()
    assert (grid[1:rows // 2] == vision.SOLID).all()
    assert (grid[rows // 2:] == vision.PASS).all()
