"""Adversarial review of stage_analysis.py and physics.py.

Every test says in its docstring whether it LOCKS IN an invariant (passes today and must keep
passing) or exposes a DEFECT (fails today). Grids are built here or embedded as literals: the
three "vision" grids are exactly what vision.scan_image produced for the sample photos (card-06,
card-09 unmodified; card-03 with a left-to-right shadow gradient), so these tests do not depend
on the vision code staying the same.
"""

import json
import math
import random
import statistics
import time

import numpy as np
import pytest

import physics
import stage_analysis as sa
from config import GAME, SHARED_DIR

ROWS, COLS, T = GAME["rows"], GAME["cols"], GAME["tileSize"]
HALF_W = GAME["fighter"]["width"] / 2
HALF_H = GAME["fighter"]["height"] / 2
S, P, H = physics.SOLID, physics.PASS, physics.HAZARD

SCHEMA = json.loads((SHARED_DIR / "stage.schema.json").read_text())
FIX_TYPES = set(SCHEMA["properties"]["fixes"]["items"]["properties"]["type"]["enum"])
FIX_OPS = set(SCHEMA["properties"]["fixes"]["items"]["properties"]["op"]["enum"])
_EDGE_ITEMS = SCHEMA["properties"]["navGraph"]["properties"]["edges"]["items"]["prefixItems"]
EDGE_TYPES = set(_EDGE_ITEMS[2]["enum"])
_MOVE = SCHEMA["properties"]["navGraph"]["properties"]["moves"]["items"]
MOVE_KEYS = set(_MOVE["required"])
MOVE_TYPES = set(_MOVE["properties"]["type"]["enum"])
MOVE_DIRS = set(_MOVE["properties"]["dir"]["enum"])
TILE_CODES = set(SCHEMA["properties"]["tiles"]["items"]["items"]["enum"])


# --- Grids -------------------------------------------------------------------------------


def blank():
    return np.zeros((ROWS, COLS), np.uint8)


def literal(rows):
    return np.array([[int(ch) for ch in row] for row in rows], np.uint8)


def _flat():
    g = blank()
    g[18:20, 6:34] = S
    return g


def _classic():
    # Same as test_analysis.classic_stage (copied so this file stands alone).
    g = _flat()
    g[14, 9:16] = g[14, 24:31] = P
    g[10, 16:24] = S
    g[17, 19:21] = H
    return g


def _staircase():
    g = blank()
    for i in range(10):
        g[20 - i, 4 + 3 * i:7 + 3 * i] = S
    return g


def _tall_wall():
    # A wall drawn up from the middle of the floor, short of the top of the card.
    g = blank()
    g[18:20, 4:36] = S
    g[3:18, 19:21] = S
    return g


def _wall_to_top():
    # The same wall drawn all the way to the top edge of the card.
    g = blank()
    g[18:20, 4:36] = S
    g[0:18, 19:21] = S
    return g


def _spiral():
    g = blank()
    g[20, 4:36] = g[4, 4:36] = S
    g[4:21, 4] = g[4:21, 35] = S
    g[8, 8:32] = S
    g[8:17, 31] = S
    g[16, 12:32] = S
    g[12, 12:28] = S
    g[8:13, 8] = S
    return g


def _nested_boxes():
    g = blank()
    g[19:21, 3:37] = S
    g[4, 6:34] = g[18, 6:34] = S
    g[4:19, 6] = g[4:19, 33] = S
    g[8, 12:28] = g[14, 12:28] = S
    g[8:15, 12] = g[8:15, 27] = S
    return g


def _corner_box():
    # A sealed box in the bottom-left corner, closed against the grid's left edge by tiles.
    g = blank()
    g[18:20, 0:30] = S
    g[10, 0:9] = S
    g[10:18, 0] = g[10:18, 8] = S
    return g


def _stacked_pass():
    g = blank()
    g[19:21, 5:35] = S
    for r in (16, 13, 10, 7):
        g[r, 12:28] = P
    return g


def _double_pass():
    g = blank()
    g[19:21, 5:35] = S
    g[14:16, 12:28] = P
    return g


def _hazard_floor():
    g = blank()
    g[19:21, 5:35] = S
    g[18, 10:30] = H
    return g


def _hazard_floor_island():
    g = blank()
    g[19:21, 5:35] = H
    g[14, 15:25] = S
    return g


def _top_row_platform():
    g = _flat()
    g[0, 10:30] = S
    return g


def _row1_platform():
    g = _flat()
    g[1, 10:30] = S
    return g


def _edge_huggers():
    g = _flat()
    g[10, 0:5] = g[10, 35:40] = S
    return g


def _edge_to_edge():
    g = blank()
    g[18:20, :] = S
    return g


def _edges_only():
    g = blank()
    g[18:20, 0:6] = g[18:20, 34:40] = S
    g[14, 14:26] = P
    return g


def _bottom_row():
    g = blank()
    g[23, :] = S
    return g


def _lopsided():
    g = blank()
    g[18:20, 2:16] = S
    g[14, 2:6] = P
    return g


def _mirrored():
    g = _flat()
    g[14, 6:12] = g[14, 28:34] = P
    g[10, 17:23] = S
    return g


def _layered():
    g = _flat()
    g[14, 8:14] = P
    g[10, 10:30] = P
    g[14, 26:32] = P
    return g


def _two_islands():
    g = blank()
    g[18:20, 2:12] = g[18:20, 28:38] = S
    return g


def _pass_floor():
    g = blank()
    g[20, 3:37] = P
    g[15, 10:30] = P
    return g


def _v_stairs():
    g = blank()
    for i in range(8):
        g[10 + i, 4 + i] = g[10 + i, 35 - i] = S
    g[18, 4:36] = S
    return g


def _bowl():
    g = blank()
    g[18:20, 10:30] = S
    g[12:18, 10] = g[12:18, 29] = S
    return g


def _pillars():
    g = blank()
    for c in range(2, 38, 6):
        g[12 + (c % 5), c:c + 2] = S
    return g


def _rects(seed):
    rng = np.random.default_rng(seed)
    g = blank()
    for _ in range(rng.integers(3, 9)):
        r, c = rng.integers(2, 22), rng.integers(0, 36)
        h, w = rng.integers(1, 3), rng.integers(2, 12)
        g[r:r + h, c:c + w] = rng.choice([S, S, S, P, H])
    return g


CARD_03_SHADOW = literal([
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000011122222222222222222211100000000",
    "0000000011100000000000000000011100000000",
    "0000000011100000000000000000011100000000",
    "0000000011100000000000000000011100000000",
    "0000000011100002222222222000011100000000",
    "0000000011100000000000000000011100000000",
    "0000000011100000000000000000011100000000",
    "0000000011100000033333300000011100000000",
    "0000111111111111111111111111111111110000",
    "0000111111111111111111111111111111110000",
    "0000111111111111111111111111111111110000",
    "0000000000000000000000000000000000000000",
    "1000000000000000000000000000000000000000",
    "1000000000000000000000000000000000000000",
])

CARD_06 = literal([
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000222222222220000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000002222222000000000000000002222222000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000111110000000000000000",
    "0000000000000000000111110000000000000000",
    "0000000000000000000111110000000000000000",
    "0000000000000111111111111111100000000000",
    "0000000000000111111111111111100000000000",
    "0000000000000111111111111111100333330000",
    "0001111111111111111111111111111111111000",
    "0001111111111111111111111111111111111000",
    "0001111111111111111111111111111111111000",
    "0000000000000000000111110000000000000000",
    "0000000000000000000111110000000000000000",
])

CARD_09 = literal([
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000222222200000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000022222222222200000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
    "0011111112222222222222222222222111111100",
    "0011111110000000000000000000000111111100",
    "0011111110000000000000000000000111111100",
    "0011111110000000000000000000000111111100",
    "0011111110000000000000000000000111111100",
    "0011111110000000000000000000000111111100",
    "0000000003333333333333333333333000000000",
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000",
])

STRUCTURED = {
    "empty": blank,
    "solid": lambda: np.full((ROWS, COLS), S, np.uint8),
    "all_hazard": lambda: np.full((ROWS, COLS), H, np.uint8),
    "all_pass": lambda: np.full((ROWS, COLS), P, np.uint8),
    "single_tile": lambda: (lambda g: (g.__setitem__((12, 20), S), g)[1])(blank()),
    "flat": _flat,
    "classic": _classic,
    "staircase": _staircase,
    "tall_wall": _tall_wall,
    "wall_to_top": _wall_to_top,
    "spiral": _spiral,
    "nested_boxes": _nested_boxes,
    "corner_box": _corner_box,
    "stacked_pass": _stacked_pass,
    "double_pass": _double_pass,
    "hazard_floor": _hazard_floor,
    "hazard_floor_island": _hazard_floor_island,
    "top_row_platform": _top_row_platform,
    "row1_platform": _row1_platform,
    "edge_huggers": _edge_huggers,
    "edge_to_edge": _edge_to_edge,
    "edges_only": _edges_only,
    "bottom_row": _bottom_row,
    "lopsided": _lopsided,
    "mirrored": _mirrored,
    "layered": _layered,
    "two_islands": _two_islands,
    "pass_floor": _pass_floor,
    "v_stairs": _v_stairs,
    "bowl": _bowl,
    "pillars": _pillars,
    "card03_shadow": lambda: CARD_03_SHADOW.copy(),
    "card06": lambda: CARD_06.copy(),
    "card09": lambda: CARD_09.copy(),
    **{f"rects{i}": (lambda i=i: _rects(100 + i)) for i in range(6)},
}


def _noise():
    rng = np.random.default_rng(11)
    out = {f"noise{i}": rng.integers(0, 4, (ROWS, COLS)).astype(np.uint8) for i in range(3)}
    for d in (0.05, 0.1, 0.2, 0.3):
        mask = rng.random((ROWS, COLS)) < d
        out[f"sparse{d}"] = (mask * rng.integers(1, 4, (ROWS, COLS))).astype(np.uint8)
    return out


NOISE = _noise()

_cache = {}


def analyzed(name):
    if name not in _cache:
        grid = STRUCTURED[name]() if name in STRUCTURED else NOISE[name]
        _cache[name] = (grid, sa.analyze(grid))
    return _cache[name]


def final(out):
    tiles = np.array(out["tiles"], np.uint8)
    return tiles, sa.Nav(tiles)


# --- Contract on every grid ---------------------------------------------------------------


def check_contract(grid, out):
    json.dumps(out)
    assert set(out) == {"tiles", "spawns", "fixes", "navGraph", "timings"}
    tiles = out["tiles"]
    assert len(tiles) == ROWS and all(len(r) == COLS for r in tiles)
    assert all(type(v) is int and v in TILE_CODES for r in tiles for v in r)

    # Fixes: valid type/op, op semantics, and replaying them in order gives exactly the output
    # tiles, with every listed cell actually changed (cells == tile diff).
    t = np.array(grid, np.uint8)
    for f in out["fixes"]:
        assert set(f) == {"type", "op", "cells", "message"}
        assert f["type"] in FIX_TYPES and f["op"] in FIX_OPS, f
        assert isinstance(f["message"], str) and f["message"]
        cells = [tuple(c) for c in f["cells"]]
        assert cells and len(set(cells)) == len(cells), f
        value = physics.FIX if f["op"] == "add" else physics.EMPTY
        for c, r in cells:
            assert type(c) is int and type(r) is int and 0 <= c < COLS and 0 <= r < ROWS
            assert t[r, c] != value, f"{f['type']} lists unchanged cell {(c, r)}"
            t[r, c] = value
    assert t.tolist() == tiles

    # Nav graph shape and references.
    g = out["navGraph"]
    assert set(g) == {"nodes", "edges", "moves"}
    n = len(g["nodes"])
    for a, b, kind, m in g["edges"]:
        assert type(a) is int and type(b) is int and 0 <= a < n and 0 <= b < n and a != b
        assert kind in EDGE_TYPES
        if kind == "walk":
            assert m is None
        else:
            assert type(m) is int and 0 <= m < len(g["moves"]) and g["moves"][m]["type"] == kind
    for m in g["moves"]:
        assert set(m) == MOVE_KEYS and m["type"] in MOVE_TYPES and m["dir"] in MOVE_DIRS
        assert type(m["holdFromMs"]) is int and m["holdFromMs"] >= 0
    stand = sa.standable(np.array(tiles, np.uint8))
    assert all(stand[r, c] for c, r in g["nodes"])

    # Spawns: two distinct standable nodes on the main stage.
    _, nav = final(out)
    main = nav.cells(nav.main)
    spawns = [(s["col"], s["row"]) for s in out["spawns"]]
    assert len(spawns) == 2 and spawns[0] != spawns[1]
    for s in out["spawns"]:
        assert set(s) == {"col", "row"} and type(s["col"]) is int and type(s["row"]) is int
    for c, r in spawns:
        assert stand[r, c], (c, r)
        assert (c, r) in main, (c, r)


@pytest.mark.parametrize("name", list(STRUCTURED) + list(NOISE))
def test_contract_holds_on_adversarial_grids(name):
    """LOCKS IN: analyze never raises on 24x40 grids of codes 0-3 and its output follows
    stage.schema.json; fixes have valid type/op and their cells are exactly the tile diff;
    spawns are distinct standable main-stage nodes."""
    grid, out = analyzed(name)
    check_contract(grid, out)


# --- Structural invariants after fixes ----------------------------------------------------

# Grids a person could plausibly draw (or vision could produce from a real photo).
REALISTIC = [n for n in STRUCTURED if n not in ("solid", "all_hazard", "all_pass", "spiral")]


@pytest.mark.parametrize("name", list(STRUCTURED))
def test_no_sealed_pockets_after_fixes(name):
    """LOCKS IN: after fixes no empty or pass-through region is sealed off from open air
    (nested boxes, spirals, boxes against the grid edge, all-solid cards)."""
    _, out = analyzed(name)
    tiles, _ = final(out)
    pockets = ((tiles == physics.EMPTY) | (tiles == physics.PASS)) & ~sa._open_air(tiles)
    assert not pockets.any(), np.argwhere(pockets)[:5].tolist()


def _one_way(nav):
    """Open-air nodes reachable from the main stage that cannot get back to it."""
    main = set(nav.main)
    fwd = nav.reach(sorted(main))
    back = nav.reach(sorted(main), backward=True)
    return sorted(nav.cells([i for i in range(nav.n) if nav.open[i] and i in fwd and i not in back]))


ONE_WAY_OK = [n for n in REALISTIC if n not in ("tall_wall", "card03_shadow", "corner_box")]


@pytest.mark.parametrize("name", ONE_WAY_OK)
def test_no_one_way_traps(name):
    """LOCKS IN: no open-air platform the main stage can reach is a dead end (a pit you can
    drop into but never leave). This is the property _main_stage's comment says matters."""
    _, out = analyzed(name)
    _, nav = final(out)
    assert _one_way(nav) == []


def test_tall_wall_leaves_far_side_a_one_way_trap():
    """DEFECT: a wall drawn up from the middle of the floor. The analyzer bridges up the near
    side ("Added steps so you can reach a platform"), so the far half becomes reachable by
    dropping off the wall top, but there is no way back: _check_unreachable only tries the
    two-step _bridge for need_in groups, the single-step "get back up" candidates all fail, and
    _remove_platform refuses because the far floor is the same tile blob as the main stage.
    A fighter (or the CPU) that crosses the wall is stuck there for the rest of the match. The
    mirror image of the bridge it already built would fix it."""
    _, out = analyzed("tall_wall")
    _, nav = final(out)
    assert _one_way(nav) == []


def test_stray_speck_blocks_fixing_a_one_way_trap():
    """DEFECT (vision output of samples/card-03.jpg under a side shadow): the floor outside the
    box's left wall, (4..7, 17), is a dead end. The analyzer's first candidate step at
    (3..5, 14) does give that floor a way back up, but the group also holds a one-node speck at
    (0, 21) (two dark pixels at the card corner) whose own exit the step blocks, and _joined
    requires every cell of the group to rejoin, so the step is reverted; removal is refused
    (same blob as the main stage) and the 4-node floor stays a trap while the mirror-image floor
    on the right gets its step. Joining should be judged per node (or the speck dropped)."""
    _, out = analyzed("card03_shadow")
    _, nav = final(out)
    trapped = _one_way(nav)
    assert (5, 17) not in trapped, trapped


def test_opening_a_sealed_box_does_not_make_a_trap():
    """DEFECT: a box drawn sealed in the corner of the card (harmless while sealed). The pocket
    check opens it by removing the single roof tile (1, 10): the fewest tiles, as SPEC says, but
    a one-tile hole 8 rows above the box floor. A fighter walking on the roof drops in and can
    never jump back out (a straight double jump rises ~191 px, the hole is 192 px up and needs
    pixel alignment), so the fix turns a sealed box into a one-way pit for 7 nodes; the trap is
    then neither stepped (nothing fits) nor removed (same blob as the main stage). Opening should
    prefer an opening a fighter can get back out of (a side wall at floor level, two rows tall),
    or the pocket should be filled instead."""
    _, out = analyzed("corner_box")
    _, nav = final(out)
    assert _one_way(nav) == []


def test_unreachable_half_behind_full_height_wall_is_neither_stepped_nor_removed():
    """DEFECT (low): a wall drawn from the floor to the top edge of the card splits the stage.
    The far half is unreachable from the main stage (nothing can go over row 0), SPEC check 2
    says add a step or else remove the platform, but no fix at all is recorded: removal is
    refused because the far floor is one tile blob with the main stage, and pockets ignore it
    because it touches open air. Half the drawn stage silently becomes scenery, and both spawns
    end up crammed on one half. Opening the wall (like opened_pocket) would fix it."""
    _, out = analyzed("wall_to_top")
    _, nav = final(out)
    main = set(nav.main)
    fwd = nav.reach(sorted(main))
    unreachable = sorted(nav.cells([i for i in range(nav.n) if nav.open[i] and i not in fwd]))
    assert unreachable == [], f"{len(unreachable)} nodes, e.g. {unreachable[:3]}; fixes={out['fixes']}"


def _edge_is_open(tiles, edge, side):
    """The column just past an outer edge has nothing blocking from head height down, so a
    fighter can actually be knocked off there (edges against walls have no off-stage)."""
    c, r = edge
    nc = c + side
    return not (0 <= nc < COLS) or not sa._blocking(tiles[max(r - 1, 0):, nc]).any()


@pytest.mark.parametrize("name", REALISTIC)
def test_open_outer_edges_are_recoverable(name):
    """LOCKS IN: from the off-stage points beside and below each open outer edge of the main
    stage a double-jump recovery lands back on it, with the analyzer's pessimistic physics and
    with the real physics."""
    _, out = analyzed(name)
    tiles, nav = final(out)
    main = nav.cells(nav.main)
    for side in (-1, 1):
        edge = sa._outer_edge(nav, side)
        if not _edge_is_open(tiles, edge, side):
            continue
        assert sa._edge_recovers(tiles, main, edge, side), (side, edge)
        saved = sa.PHYS
        sa.PHYS = GAME["physics"]
        try:
            assert sa._edge_recovers(tiles, main, edge, side), ("full physics", side, edge)
        finally:
            sa.PHYS = saved


def test_fixes_do_not_undo_earlier_fixes():
    """DEFECT (low): on a V of one-tile stairs the analyzer adds two-step bridges whose lower
    stones sit at row 22 under the stage, then a later round removes those same stones as
    "Removed a platform nobody could reach". The Reveal screen pulses an added step and then a
    removal of the analyzer's own tiles, and the upper half of each bridge is left behind.
    A removal should never target cells an earlier fix added (and vice versa)."""
    _, out = analyzed("v_stairs")
    added, churn = set(), []
    for f in out["fixes"]:
        cells = {tuple(c) for c in f["cells"]}
        if f["op"] == "add":
            added |= cells
        elif cells & added:
            churn.append((f["type"], sorted(cells & added)))
    assert churn == [], churn


# --- Spawns -------------------------------------------------------------------------------

SYMMETRIC = ["flat", "classic", "stacked_pass", "double_pass", "edge_to_edge", "edges_only",
             "mirrored", "pass_floor", "bowl", "empty"]


def _apart_enough(nav, c1, c2, tiles=5):
    """At least `tiles` columns apart, or half the main stage's width if that is narrower."""
    cols = nav.cols[nav.main]
    return abs(c2 - c1) >= min(tiles, (int(cols.max()) - int(cols.min())) // 2)


@pytest.mark.parametrize("name", SYMMETRIC)
def test_spawns_mirror_on_symmetric_stages(name):
    """LOCKS IN: on a stage that is left-right symmetric (and stays so after fixes) the spawns
    are mirror images: same row, columns mirrored about the grid centre within one tile, and
    apart (5 tiles, or half the main stage's width if that is narrower)."""
    _, out = analyzed(name)
    tiles, nav = final(out)
    assert (tiles == tiles[:, ::-1]).all(), "fixture is no longer symmetric after fixes"
    (c1, r1), (c2, r2) = [(s["col"], s["row"]) for s in out["spawns"]]
    assert r1 == r2
    assert abs((c1 + c2) - (COLS - 1)) <= 1
    assert _apart_enough(nav, c1, c2), (c1, c2)


@pytest.mark.parametrize("name", [n for n in REALISTIC if n not in ("wall_to_top", "tall_wall", "corner_box")])
def test_spawns_roughly_mirrored_apart_and_mutually_reachable(name):
    """LOCKS IN: spawns sit roughly mirrored about the main stage's horizontal centre (within
    3 tiles), apart (5 tiles, or half the main stage's width if narrower; not checked on the
    random-rectangle junk stages), and each can reach the other on the nav graph."""
    _, out = analyzed(name)
    _, nav = final(out)
    cols = nav.cols[nav.main]
    (c1, r1), (c2, r2) = [(s["col"], s["row"]) for s in out["spawns"]]
    assert abs((c1 + c2) - (int(cols.min()) + int(cols.max()))) <= 6, (c1, c2, cols.min(), cols.max())
    if not name.startswith("rects"):
        assert _apart_enough(nav, c1, c2), (c1, c2, cols.min(), cols.max())
    a, b = int(nav.node_grid[r1, c1]), int(nav.node_grid[r2, c2])
    assert b in nav.reach([a]) and a in nav.reach([b])


def _side_platform():
    # An ordinary drawing: a floor, and a blue platform hanging out past its left end.
    g = blank()
    g[18:20, 12:34] = S
    g[14, 2:9] = P
    return g


@pytest.mark.parametrize("make", [_side_platform, lambda: STRUCTURED["corner_box"]()],
                         ids=["side_platform", "corner_box"])
def test_spawns_are_not_next_to_each_other(make):
    """DEFECT: with a floor (cols 12..33) and a reachable platform hanging out past its left end
    (cols 2..8), the main stage spans cols 2..33, its "centre" is 17.5, and _spawns' cost puts
    mirror symmetry about that centre (weight 2) far above separation (weight 1 on
    |gap - 15.5|), so both fighters spawn on the floor ONE tile apart: (17,17) and (18,17),
    overlapping hitboxes at the start of the match. Same on corner_box: (14,17) and (15,17).
    Every variant tried (platform at cols 0..6, 2..8, 4..10; rows 12, 14, 15) spawns 1 apart.
    Separation should be a hard floor (e.g. >= 8 tiles or half the main width), with mirroring
    judged per platform rather than about the bounding-box centre."""
    grid = make()
    out = sa.analyze(grid)
    _, nav = final(out)
    (c1, _), (c2, _) = [(s["col"], s["row"]) for s in out["spawns"]]
    assert _apart_enough(nav, c1, c2, tiles=8), out["spawns"]


# --- Nav edges flown with full physics and the CPU contract -------------------------------


def fly(tiles, start, target, recipe, x_offset=0.0):
    """SPEC amendment 16, as Bot.followPlan does it: jump / press down on step 0, second jump on
    step round(doubleJumpAtMs * fps / 1000), no direction before holdFromMs, then steer to the
    target node centre and stop within 3 px. FULL-strength physics. Returns the landed body or
    why it failed."""
    grid = physics.as_grid(tiles)
    b = physics.create_body(GAME, *start)
    b["x"] += x_offset
    target_x = target[0] * T + T / 2
    fps = GAME["physics"]["fps"]
    hold_from = math.floor(recipe["holdFromMs"] * fps / 1000 + 0.5)
    dj = recipe["doubleJumpAtMs"]
    dj_step = None if dj is None else math.floor(dj * fps / 1000 + 0.5)
    airborne = False
    for step in range(sa.MAX_MOVE_STEPS):
        jump = (step == 0 and recipe["type"] in ("jump", "double_jump")) or step == dj_step
        down = step == 0 and recipe["type"] == "drop"
        dx = target_x - b["x"]
        d = 0 if step < hold_from or abs(dx) <= 3 else (1 if dx > 0 else -1)
        physics.step_body(b, {"dir": d, "down": down, "jump": jump}, grid, GAME, GAME["physics"], 1 / fps)
        if b["hazard"] is not None:
            return "touched a hazard"
        if not b["onGround"]:
            airborne = True
        elif airborne:
            return b
    return "never landed"


def lands_on(b, node):
    if isinstance(b, str):
        return False
    cols = {math.floor((b["x"] - HALF_W) / T), math.floor((b["x"] + HALF_W - physics.EPS) / T)}
    return round((b["y"] + HALF_H) / T) - 1 == node[1] and node[0] in cols


def failing_edges(out, x_offset=0.0):
    tiles = np.array(out["tiles"], np.uint8)
    g = out["navGraph"]
    nodes = g["nodes"]
    bad = []
    for a, b, kind, m in g["edges"]:
        if kind == "walk":
            continue
        landed = fly(tiles, tuple(nodes[a]), tuple(nodes[b]), g["moves"][m], x_offset)
        if not lands_on(landed, nodes[b]):
            where = landed if isinstance(landed, str) else (landed["x"], landed["y"])
            bad.append((tuple(nodes[a]), tuple(nodes[b]), g["moves"][m], where))
    return bad


@pytest.mark.parametrize("name", ["stacked_pass", "double_pass", "pass_floor", "staircase",
                                  "edge_huggers", "mirrored", "hazard_floor"])
def test_every_nav_edge_is_flyable(name):
    """LOCKS IN: exhaustively, every non-walk nav edge of these stages (stacked pass-through
    platforms, low pass ceilings, stairs, hazard floors) is flown onto its target by the CPU
    contract with full-strength physics."""
    _, out = analyzed(name)
    bad = failing_edges(out)
    assert not bad, bad[:5]


@pytest.mark.parametrize("name", ["lopsided", "layered", "card06", "card09"])
def test_nav_edges_landing_on_a_tile_boundary(name):
    """DEFECT: an edge whose flight ends with a hitbox side exactly on a tile boundary. Run speed
    is 13/6 px per step, so after 9k steps a hitbox side lands exactly on a column boundary;
    which column it then "covers" depends on floating-point rounding of the absolute x. The
    jump table traces each recipe at template column 40 and assumes the outcome is the same from
    every column, but at x = 311.99999999999835 (card06, from (21,12)) the real flight covers the
    pass-through tile at (12, 9) by 1.6e-12 px and lands on it, while the table recorded a clean
    miss and a landing on the floor at (9, 18). Open loop and closed loop both land on the
    platform. card06 and card09 are the bundled sample stages (shared/stages/samples.json
    sample-06 and sample-09 ship these edges). Fix: treat a crossing or cell event whose hitbox
    edge is within ~1e-6 px of a tile boundary as ambiguous (check both columns, or drop the move)."""
    _, out = analyzed(name)
    bad = failing_edges(out)
    assert not bad, bad[:5]


@pytest.mark.parametrize("x_offset", [-3.0, 3.0])
def test_nav_edges_from_where_the_bot_actually_starts(x_offset):
    """DEFECT (contract gap): Bot.navigate starts a move as soon as |x - node centre| <= 3 px,
    but the analyzer verifies every move from the exact centre. On the team's own classic stage
    some jump edges from the floor to the floor under a pass-through platform (e.g. (18,17) ->
    (13,17), jump dir -1 holdFromMs 300) clear the pass-through corner by less than 3 px, so a
    start 3 px toward it lands on the platform instead. Either verify moves from centre +/- 3 px
    or make the bot line up tighter (it can get within ~1.1 px at run speed)."""
    _, out = analyzed("classic")
    bad = failing_edges(out, x_offset)
    assert not bad, bad[:5]


# --- Speed --------------------------------------------------------------------------------


def test_analysis_time_on_adversarial_grids():
    """LOCKS IN: median < 300 ms and worst < 1 s over the adversarial set, noise included
    (best of two runs per grid, so another process hogging the CPU does not fail it)."""
    times = {}
    for name in list(STRUCTURED) + list(NOISE):
        grid = STRUCTURED[name]() if name in STRUCTURED else NOISE[name]
        best = math.inf
        for _ in range(2):
            t0 = time.perf_counter()
            sa.analyze(grid)
            best = min(best, (time.perf_counter() - t0) * 1000)
        times[name] = best
    assert statistics.median(times.values()) < 300, times
    worst = max(times, key=times.get)
    assert times[worst] < 1000, (worst, times[worst])


# --- physics.py ---------------------------------------------------------------------------


def test_physics_never_ends_a_step_inside_a_blocking_tile():
    """LOCKS IN: fuzzed bodies on random grids (all tile codes), random inputs, and launches up
    to maxLaunchSpeed in any direction with hitstun, never end a step overlapping a solid,
    hazard or fix tile (no tunnelling, no corner clipping)."""
    rnd = random.Random(1)
    phys = GAME["physics"]
    dt = 1 / phys["fps"]

    def inside(b, grid):
        return any(physics.blocks(physics.tile_at(grid, c, r)) for c, r in sa._hitbox_cells(b["x"], b["y"]))

    for trial in range(120):
        rng = np.random.default_rng(trial)
        tiles = ((rng.random((ROWS, COLS)) < 0.25) * rng.integers(1, 5, (ROWS, COLS))).astype(int)
        grid = physics.as_grid(tiles.tolist())
        for _ in range(200):
            b = physics.create_body(GAME, rnd.randrange(COLS), rnd.randrange(1, ROWS - 1))
            b["onGround"] = False
            if not inside(b, grid):
                break
        else:
            continue
        for step in range(400):
            if rnd.random() < 0.02:
                angle = rnd.uniform(0, 2 * math.pi)
                speed = rnd.uniform(0, phys["maxLaunchSpeed"])
                b["vx"], b["vy"] = speed * math.cos(angle), speed * math.sin(angle)
                b["hitstun"] = rnd.uniform(0, 0.7)
            inp = {"dir": rnd.choice((-1, 0, 1)), "down": rnd.random() < 0.1, "jump": rnd.random() < 0.05}
            physics.step_body(b, inp, grid, GAME, phys, dt)
            assert not inside(b, grid), (trial, step, b)
