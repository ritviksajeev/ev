"""Stage analysis on handcrafted grids: fixes, spawns, the exported nav graph, and that nav
edges can really be flown with full-strength physics by a closed-loop controller."""

import json
import math
import statistics
import time

import numpy as np
import pytest

import physics
import stage_analysis as sa
from config import GAME

ROWS, COLS, T = GAME["rows"], GAME["cols"], GAME["tileSize"]
HALF_H = GAME["fighter"]["height"] / 2
HALF_W = GAME["fighter"]["width"] / 2
FIX_TYPES = {"default_stage", "added_step", "removed_platform", "added_ledge", "opened_pocket"}
EDGE_TYPES = {"walk", "fall", "drop", "jump", "double_jump"}


def blank():
    return np.zeros((ROWS, COLS), np.uint8)


def flat_stage():
    g = blank()
    g[18:20, 6:34] = physics.SOLID
    return g


def floating_platform(row):
    g = flat_stage()
    g[row, 16:24] = physics.SOLID
    return g


def sealed_box():
    g = flat_stage()
    g[10, 12:28] = g[16, 12:28] = physics.SOLID
    g[10:17, 12] = g[10:17, 27] = physics.SOLID
    return g


def unrecoverable_edge():
    # The left edge of the stage is guarded by a hazard strip: from below and outside,
    # a double jump can never get back onto the stage.
    g = blank()
    g[16:18, 10:30] = physics.SOLID
    g[16, 7:10] = physics.HAZARD
    return g


def classic_stage():
    g = flat_stage()
    g[14, 9:16] = g[14, 24:31] = physics.PASS
    g[10, 16:24] = physics.SOLID
    g[17, 19:21] = physics.HAZARD
    return g


HANDCRAFTED = {
    "flat": flat_stage,
    "floating": lambda: floating_platform(9),
    "sealed_box": sealed_box,
    "unrecoverable_edge": unrecoverable_edge,
    "empty": blank,
    "classic": classic_stage,
}

_cache = {}


def analyzed(name):
    if name not in _cache:
        _cache[name] = sa.analyze(HANDCRAFTED[name]())
    return _cache[name]


def final_nav(out):
    return sa.Nav(np.array(out["tiles"], np.uint8))


def fix_types(out):
    return [f["type"] for f in out["fixes"]]


# --- Shared invariants ---------------------------------------------------------


def assert_schema(out):
    json.dumps(out)
    assert set(out) == {"tiles", "spawns", "fixes", "navGraph", "timings"}
    assert len(out["tiles"]) == ROWS and all(len(row) == COLS for row in out["tiles"])
    assert all(type(v) is int and 0 <= v <= 4 for row in out["tiles"] for v in row)

    assert len(out["spawns"]) == 2
    for s in out["spawns"]:
        assert set(s) == {"col", "row"} and type(s["col"]) is int and type(s["row"]) is int

    for f in out["fixes"]:
        assert set(f) == {"type", "op", "cells", "message"}
        assert f["type"] in FIX_TYPES and f["op"] in ("add", "remove")
        assert isinstance(f["message"], str) and 0 < len(f["message"]) <= 60
        assert all(len(c) == 2 and type(c[0]) is int and type(c[1]) is int for c in f["cells"])

    graph = out["navGraph"]
    assert set(graph) == {"nodes", "edges", "moves"}
    n = len(graph["nodes"])
    assert all(len(c) == 2 and type(c[0]) is int and type(c[1]) is int for c in graph["nodes"])
    for a, b, kind, move in graph["edges"]:
        assert type(a) is int and type(b) is int and 0 <= a < n and 0 <= b < n and a != b
        assert kind in EDGE_TYPES
        if kind == "walk":
            assert move is None
        else:
            assert type(move) is int and 0 <= move < len(graph["moves"])
            assert graph["moves"][move]["type"] == kind
    for m in graph["moves"]:
        assert set(m) == {"type", "dir", "holdFromMs", "holdUntilMs", "doubleJumpAtMs"}
        assert m["type"] in EDGE_TYPES - {"walk"} and m["dir"] in (-1, 0, 1)
        assert type(m["holdFromMs"]) is int and m["holdFromMs"] >= 0
        assert m["holdUntilMs"] is None or type(m["holdUntilMs"]) is int
        assert (m["doubleJumpAtMs"] is not None) == (m["type"] == "double_jump")
    referenced = {e[3] for e in graph["edges"] if e[3] is not None}
    assert referenced == set(range(len(graph["moves"])))

    assert set(out["timings"]) == {"analysis"} and isinstance(out["timings"]["analysis"], float)


def assert_fixes_replay(grid, out):
    """Replaying the fixes in order on the input gives the output tiles, and every listed cell changed."""
    tiles = np.array(grid, np.uint8)
    for f in out["fixes"]:
        value = physics.FIX if f["op"] == "add" else physics.EMPTY
        cells = [tuple(c) for c in f["cells"]]
        assert cells and len(set(cells)) == len(cells), f
        for c, r in cells:
            assert tiles[r, c] != value, f"{f['type']} lists unchanged cell {(c, r)}"
            tiles[r, c] = value
    assert tiles.tolist() == out["tiles"]


def assert_graph_matches_tiles(out):
    tiles = np.array(out["tiles"], np.uint8)
    rows, cols = np.nonzero(sa.standable(tiles))
    nodes = out["navGraph"]["nodes"]
    assert nodes == [[int(c), int(r)] for c, r in zip(cols, rows)]
    for a, b, kind, _ in out["navGraph"]["edges"]:
        if kind == "walk":
            assert nodes[a][1] == nodes[b][1] and abs(nodes[a][0] - nodes[b][0]) == 1


def assert_fair_spawns(out):
    nav = final_nav(out)
    main = nav.cells(nav.main)
    (c1, r1), (c2, r2) = [(s["col"], s["row"]) for s in out["spawns"]]
    assert (c1, r1) != (c2, r2)
    assert (c1, r1) in main and (c2, r2) in main


def check_all(grid, out):
    assert_schema(out)
    assert_fixes_replay(grid, out)
    assert_graph_matches_tiles(out)
    assert_fair_spawns(out)


@pytest.mark.parametrize("name", list(HANDCRAFTED))
def test_handcrafted_invariants(name):
    check_all(HANDCRAFTED[name](), analyzed(name))


# --- The SPEC's handcrafted grids --------------------------------------------------


def test_flat_stage_needs_no_fixes_and_gets_mirrored_spawns():
    out = analyzed("flat")
    assert out["fixes"] == []
    (c1, r1), (c2, r2) = [(s["col"], s["row"]) for s in out["spawns"]]
    assert r1 == r2 == 17
    centre = (6 + 33) / 2
    assert abs((c1 - centre) + (c2 - centre)) <= 1
    assert c2 - c1 >= 8
    assert min(c1 - 6, 33 - c1) == min(c2 - 6, 33 - c2)


def test_unreachable_floating_platform_gets_a_step():
    out = analyzed("floating")
    assert fix_types(out) == ["added_step"]
    step = out["fixes"][0]
    assert step["op"] == "add" and 2 <= len(step["cells"]) <= 3
    nav = final_nav(out)
    platform = {(c, 8) for c in range(16, 24)}
    assert platform <= nav.cells(nav.main)


def test_platform_too_far_for_one_step_gets_two():
    grid = floating_platform(5)
    out = sa.analyze(grid)
    check_all(grid, out)
    assert fix_types(out) == ["added_step"] and len(out["fixes"][0]["cells"]) >= 4
    nav = final_nav(out)
    assert {(c, 4) for c in range(16, 24)} <= nav.cells(nav.main)


def test_platform_out_of_any_reach_is_removed():
    grid = floating_platform(1)
    out = sa.analyze(grid)
    check_all(grid, out)
    assert fix_types(out) == ["removed_platform"]
    assert sorted(out["fixes"][0]["cells"]) == [[c, 1] for c in range(16, 24)]


def test_sealed_box_is_opened():
    out = analyzed("sealed_box")
    pockets = [f for f in out["fixes"] if f["type"] == "opened_pocket"]
    assert len(pockets) == 1 and pockets[0]["op"] == "remove"
    assert len(pockets[0]["cells"]) == 1  # one-tile walls: the fewest tiles is one
    (c, r), = pockets[0]["cells"]
    assert sealed_box()[r, c] == physics.SOLID
    tiles = np.array(out["tiles"], np.uint8)
    empty = (tiles == physics.EMPTY) | (tiles == physics.PASS)
    assert (empty == sa._open_air(tiles)).all()


def test_unrecoverable_edge_gets_a_ledge():
    grid = unrecoverable_edge()
    assert not sa._edge_recovers(grid, sa.Nav(grid).cells(sa.Nav(grid).main), (10, 15), -1)
    out = analyzed("unrecoverable_edge")
    ledges = [f for f in out["fixes"] if f["type"] == "added_ledge"]
    assert len(ledges) == 1 and ledges[0]["op"] == "add" and len(ledges[0]["cells"]) == 3
    assert all(c < 10 for c, _ in ledges[0]["cells"])
    nav = final_nav(out)
    main = nav.cells(nav.main)
    assert {(c, r - 1) for c, r in ledges[0]["cells"]} <= main
    assert sa._edge_recovers(nav.tiles, main, (10, 15), -1)


def test_empty_card_gets_default_stage():
    out = analyzed("empty")
    assert out["fixes"] == [
        {
            "type": "default_stage",
            "op": "add",
            "cells": [[c, sa.DEFAULT_FLOOR_ROW] for c in range(sa.DEFAULT_COLS[0], sa.DEFAULT_COLS[1] + 1)],
            "message": out["fixes"][0]["message"],
        }
    ]
    assert all(s["row"] == sa.DEFAULT_FLOOR_ROW - 1 for s in out["spawns"])


def test_classic_stage_has_every_move_type():
    out = analyzed("classic")
    assert out["fixes"] == []
    kinds = {e[2] for e in out["navGraph"]["edges"]}
    assert kinds == EDGE_TYPES
    assert all(s["row"] == 17 for s in out["spawns"])


# --- Robustness -------------------------------------------------------------------


def _degenerate_grids():
    rng = np.random.default_rng(7)
    yield "solid", np.full((ROWS, COLS), physics.SOLID, np.uint8)
    yield "hazard", np.full((ROWS, COLS), physics.HAZARD, np.uint8)
    yield "pass", np.full((ROWS, COLS), physics.PASS, np.uint8)
    yield "checker", (np.indices((ROWS, COLS)).sum(0) % 2).astype(np.uint8)
    stripes = np.zeros((ROWS, COLS), np.uint8)
    stripes[2::3] = physics.PASS
    yield "stripes", stripes
    for i in range(4):
        yield f"noise{i}", rng.integers(0, 4, (ROWS, COLS)).astype(np.uint8)
    for density in (0.1, 0.3):
        mask = rng.random((ROWS, COLS)) < density
        yield f"sparse{density}", (mask * rng.integers(1, 4, (ROWS, COLS))).astype(np.uint8)


DEGENERATE = dict(_degenerate_grids())


@pytest.mark.parametrize("name", list(DEGENERATE))
def test_never_raises_and_stays_valid(name):
    grid = DEGENERATE[name]
    t0 = time.perf_counter()
    out = sa.analyze(grid)
    elapsed = (time.perf_counter() - t0) * 1000
    check_all(grid, out)
    assert elapsed < 1500, f"{name} took {elapsed:.0f} ms"


def test_deterministic():
    grid = np.random.default_rng(3).integers(0, 4, (ROWS, COLS)).astype(np.uint8)
    a, b = sa.analyze(grid), sa.analyze(grid.copy())
    a.pop("timings"), b.pop("timings")
    assert a == b


def test_rejects_wrong_shape():
    with pytest.raises(ValueError):
        sa.analyze(np.zeros((10, 10), np.uint8))


# --- The jump table and the nav edges ----------------------------------------------


def test_pessimistic_physics_scales_jumps_and_speed_only():
    k = GAME["analysis"]["validatorPessimism"]
    p = sa.pessimistic_physics(GAME)
    for key, value in GAME["physics"].items():
        scaled = key in ("jumpVelocity", "doubleJumpVelocity", "runSpeed")
        assert p[key] == (value * k if scaled else value)


def test_jump_table_covers_the_recipe_spread():
    moves = sa.TABLE.moves
    assert {m["type"] for m in moves} == EDGE_TYPES - {"walk"}
    dj = {m["doubleJumpAtMs"] for m in moves if m["type"] == "double_jump"}
    assert dj == set(sa.DOUBLE_JUMP_AT_MS)
    assert {m["holdFromMs"] for m in moves if m["type"] == "jump"} == set(sa.HOLD_FROM_MS)


def covered_cols(b):
    return {math.floor((b["x"] - HALF_W) / T), math.floor((b["x"] + HALF_W - physics.EPS) / T)}


def stands_on(b, node):
    """The landed body's feet are on the node's tile. (A landing exactly on a tile boundary,
    which the analyzer resolved from a trace at another absolute position, still counts.)"""
    return round((b["y"] + HALF_H) / T) - 1 == node[1] and node[0] in covered_cols(b)


def fly(tiles, start, target, recipe, phys, closed_loop):
    """Fly a move from a node; returns the landed body, or why it did not land. Closed loop is
    how the CPU flies it: jump/down per the recipe, no direction before holdFromMs, then steer
    toward the target centre and stop within 3 px."""
    grid = physics.as_grid(tiles)
    b = physics.create_body(GAME, *start)
    target_x = target[0] * T + T / 2
    hold_from = sa.ms_to_step(recipe["holdFromMs"])
    airborne = False
    for step in range(sa.MAX_MOVE_STEPS):
        inp = sa.recipe_input(recipe, step)
        if closed_loop:
            dx = target_x - b["x"]
            inp["dir"] = 0 if step < hold_from or abs(dx) <= 3 else (1 if dx > 0 else -1)
        physics.step_body(b, inp, grid, GAME, phys, sa.DT)
        if b["hazard"] is not None:
            return "hazard"
        if not b["onGround"]:
            airborne = True
        elif airborne:
            return b
    return "never landed"


def sample_edges(out, per_type=30):
    """Up to per_type evenly spread non-walk edges of each type, deterministic."""
    nodes = out["navGraph"]["nodes"]
    picked = []
    for kind in EDGE_TYPES - {"walk"}:
        edges = [e for e in out["navGraph"]["edges"] if e[2] == kind]
        stride = max(1, len(edges) // per_type)
        picked += edges[::stride][:per_type]
    return [(tuple(nodes[a]), tuple(nodes[b]), out["navGraph"]["moves"][m]) for a, b, _, m in picked]


EXECUTABILITY_STAGES = ["classic", "floating", "unrecoverable_edge", "sealed_box"]


@pytest.mark.parametrize("name", EXECUTABILITY_STAGES)
def test_edges_are_executable_by_the_cpu_with_full_physics(name):
    out = analyzed(name)
    tiles = np.array(out["tiles"], np.uint8)
    edges = sample_edges(out)
    assert edges
    failures = []
    for start, target, recipe in edges:
        b = fly(tiles, start, target, recipe, GAME["physics"], closed_loop=True)
        if isinstance(b, str) or not stands_on(b, target):
            failures.append((start, target, recipe, b if isinstance(b, str) else (b["x"], b["y"])))
    assert not failures, failures[:5]


def test_table_lookup_matches_direct_simulation():
    """The event lookup must agree with simulating on the real grid: open loop, the real-physics
    recipe lands on the edge's target and the pessimistic one on the same platform."""
    out = analyzed("classic")
    tiles = np.array(out["tiles"], np.uint8)
    nav = final_nav(out)
    for start, target, recipe in sample_edges(out, per_type=40):
        real = fly(tiles, start, target, recipe, GAME["physics"], closed_loop=False)
        assert not isinstance(real, str) and stands_on(real, target), (start, target, recipe, real)
        weak = fly(tiles, start, target, recipe, sa.PHYS, closed_loop=False)
        assert not isinstance(weak, str), (start, target, recipe, weak)
        row = round((weak["y"] + HALF_H) / T) - 1
        runs = {int(nav.runs[nav.node_grid[row, c]]) for c in covered_cols(weak) if nav.node_grid[row, c] >= 0}
        target_run = int(nav.runs[nav.node_grid[target[1], target[0]]])
        assert target_run in runs, (start, target, recipe, weak)


def test_typical_analysis_is_fast():
    times = []
    for make in HANDCRAFTED.values():
        grid = make()
        t0 = time.perf_counter()
        sa.analyze(grid)
        times.append((time.perf_counter() - t0) * 1000)
    assert statistics.median(times) < 300, times
    assert max(times) < 1000, times
