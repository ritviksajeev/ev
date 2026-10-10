"""Fighter movement and tile collision: a line-for-line port of frontend/src/sim/physics.js.

The JS module is the reference. Keep the order of floating-point operations
identical so both produce the same doubles; tests/test_physics.py replays
shared/fixtures/physics.json (recorded from the JS module) and checks 1e-9.

Coordinates are stage-local pixels, (0, 0) is the top-left corner of tile
(col 0, row 0) and a body's (x, y) is the centre of its hitbox. Outside the
grid everything is empty.
"""

import math

EMPTY = 0
SOLID = 1
PASS = 2
HAZARD = 3
FIX = 4

EPS = 1e-6


class Grid:
    """cols, rows and tiles[row][col]. as_grid() builds one from a dict, a list of rows or a numpy array."""

    __slots__ = ("cols", "rows", "tiles")

    def __init__(self, cols, rows, tiles):
        self.cols = cols
        self.rows = rows
        self.tiles = tiles


def as_grid(src):
    if isinstance(src, Grid):
        return src
    if isinstance(src, dict):
        return Grid(src["cols"], src["rows"], src["tiles"])
    if hasattr(src, "shape"):  # numpy array [rows, cols]
        return Grid(int(src.shape[1]), int(src.shape[0]), src.tolist())
    if isinstance(src, list):
        return Grid(len(src[0]) if src else 0, len(src), src)
    return Grid(src.cols, src.rows, src.tiles)


def _sign(v):
    return (v > 0) - (v < 0)


def blocks(code):
    return code == SOLID or code == HAZARD or code == FIX


def tile_at(grid, col, row):
    if row < 0 or row >= grid.rows or col < 0 or col >= grid.cols:
        return EMPTY
    return grid.tiles[row][col]


def create_body(game, col, row):
    """A body standing with its feet on the top edge of row `row + 1`, centred on `col`."""
    T = game["tileSize"]
    w = game["fighter"]["width"]
    h = game["fighter"]["height"]
    return {
        "x": col * T + T / 2,
        "y": (row + 1) * T - h / 2,
        "vx": 0,
        "vy": 0,
        "w": w,
        "h": h,
        "onGround": True,
        "airJumps": 1,
        "coyote": 0,
        "jumpBuffer": 0,
        "dropTimer": 0,
        "hitstun": 0,
        "hazard": None,  # [col, row] of a hazard tile touched this step
    }


def step_body(b, inp, grid, game, phys, dt):
    """inp: {"dir": -1|0|1, "down": bool, "jump": bool (pressed this step)}.
    phys: game["physics"], or the analyzer's copy scaled by validatorPessimism."""
    grid = as_grid(grid)
    b["hazard"] = None
    b["coyote"] = phys["coyoteMs"] / 1000 if b["onGround"] else max(0, b["coyote"] - dt)
    b["jumpBuffer"] = phys["jumpBufferMs"] / 1000 if inp["jump"] else max(0, b["jumpBuffer"] - dt)
    b["dropTimer"] = phys["dropThroughMs"] / 1000 if inp["down"] else max(0, b["dropTimer"] - dt)

    if b["hitstun"] > 0:
        b["hitstun"] = max(0, b["hitstun"] - dt)
        _decay_x(b, phys, dt, 0)
    elif abs(b["vx"]) > phys["runSpeed"]:
        _decay_x(b, phys, dt, phys["runSpeed"])
    else:
        b["vx"] = inp["dir"] * phys["runSpeed"]

    if b["hitstun"] <= 0 and b["jumpBuffer"] > 0:
        if b["onGround"] or b["coyote"] > 0:
            b["vy"] = -phys["jumpVelocity"]
            b["onGround"] = False
            b["coyote"] = 0
            b["jumpBuffer"] = 0
        elif b["airJumps"] > 0:
            b["vy"] = -phys["doubleJumpVelocity"]
            b["airJumps"] -= 1
            b["jumpBuffer"] = 0

    integrate(b, grid, game, phys, dt)


def _decay_x(b, phys, dt, floor):
    """Knockback speed bleeds off toward `floor` (0 in hitstun, runSpeed after)."""
    speed = abs(b["vx"])
    if speed <= floor:
        return
    nxt = max(floor, speed - phys["knockbackDecay"] * dt)
    b["vx"] = _sign(b["vx"]) * nxt


def integrate(b, grid, game, phys, dt):
    """Semi-implicit Euler: velocity, then X moved and resolved, then Y.

    Per step a body moves less than one tile, so at most one tile boundary is crossed. A grounded
    body walks up and down steps of at most stepUpPx, so a hand-drawn slanted line plays as a
    slope rather than a staircase of walls."""
    grid = as_grid(grid)
    T = game["tileSize"]
    step = phys.get("stepUpPx", 0)
    grounded = b["onGround"]  # from the previous step
    b["vy"] = min(b["vy"] + phys["gravity"] * dt, phys["maxFallSpeed"])

    b["x"] += b["vx"] * dt
    _resolve_x(b, grid, T, step if grounded else 0)

    prev_top = b["y"] - b["h"] / 2
    prev_bottom = b["y"] + b["h"] / 2
    b["y"] += b["vy"] * dt
    _resolve_y(b, grid, T, prev_top, prev_bottom)
    if grounded and step > 0 and not b["onGround"] and b["vy"] >= 0:
        _snap_down(b, grid, T, step)


def _resolve_x(b, grid, T, step):
    if b["vx"] == 0:
        return
    r0 = math.floor((b["y"] - b["h"] / 2) / T)
    r1 = math.floor((b["y"] + b["h"] / 2 - EPS) / T)
    if b["vx"] > 0:
        c = math.floor((b["x"] + b["w"] / 2 - EPS) / T)
    else:
        c = math.floor((b["x"] - b["w"] / 2) / T)
    hit = -1  # topmost blocking row in the leading column
    for r in range(r0, r1 + 1):
        if blocks(tile_at(grid, c, r)):
            hit = r
            break
    if hit < 0:
        # Walking into a pass-through tile at foot level: climb onto it.
        if step > 0 and b["vy"] >= 0 and b["dropTimer"] <= 0 and tile_at(grid, c, r1) == PASS:
            _step_up(b, grid, T, step, r1)
        return
    if step > 0 and b["vy"] >= 0 and _step_up(b, grid, T, step, hit):
        return
    b["x"] = c * T - b["w"] / 2 if b["vx"] > 0 else (c + 1) * T + b["w"] / 2
    b["vx"] = 0
    if tile_at(grid, c, hit) == HAZARD:
        b["hazard"] = [c, hit]


def _step_up(b, grid, T, step, top):
    """Lift the body onto row `top` if that is at most `step` px above its feet and it fits there."""
    lift = b["y"] + b["h"] / 2 - top * T
    if lift <= EPS or lift > step + EPS:
        return False
    y = top * T - b["h"] / 2
    if _overlaps_blocking(grid, T, b["x"], y, b["w"], b["h"]):
        return False
    b["y"] = y
    return True


def _snap_down(b, grid, T, step):
    """Just walked off a step no taller than `step`: stay on the ground below it."""
    bottom = b["y"] + b["h"] / 2
    r = math.ceil(bottom / T - EPS)
    if r * T - bottom > step + EPS:
        return
    c0 = math.floor((b["x"] - b["w"] / 2) / T)
    c1 = math.floor((b["x"] + b["w"] / 2 - EPS) / T)
    for c in range(c0, c1 + 1):
        t = tile_at(grid, c, r)
        if blocks(t) or (t == PASS and b["dropTimer"] <= 0):
            b["y"] = r * T - b["h"] / 2
            b["vy"] = 0
            b["onGround"] = True
            b["airJumps"] = 1
            if t == HAZARD:
                b["hazard"] = [c, r]
            return


def _overlaps_blocking(grid, T, x, y, w, h):
    c0 = math.floor((x - w / 2) / T)
    c1 = math.floor((x + w / 2 - EPS) / T)
    r0 = math.floor((y - h / 2) / T)
    r1 = math.floor((y + h / 2 - EPS) / T)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if blocks(tile_at(grid, c, r)):
                return True
    return False


def _resolve_y(b, grid, T, prev_top, prev_bottom):
    b["onGround"] = False
    c0 = math.floor((b["x"] - b["w"] / 2) / T)
    c1 = math.floor((b["x"] + b["w"] / 2 - EPS) / T)
    if b["vy"] > 0:
        r = math.floor((b["y"] + b["h"] / 2 - EPS) / T)
        if prev_bottom > r * T + EPS:
            return  # already below that row's top
        for c in range(c0, c1 + 1):
            t = tile_at(grid, c, r)
            if blocks(t) or (t == PASS and b["dropTimer"] <= 0):
                b["y"] = r * T - b["h"] / 2
                b["vy"] = 0
                b["onGround"] = True
                b["airJumps"] = 1
                if t == HAZARD:
                    b["hazard"] = [c, r]
                return
    elif b["vy"] < 0:
        r = math.floor((b["y"] - b["h"] / 2) / T)
        if prev_top < (r + 1) * T - EPS:
            return  # already inside that row
        for c in range(c0, c1 + 1):
            t = tile_at(grid, c, r)
            if blocks(t):
                b["y"] = (r + 1) * T + b["h"] / 2
                b["vy"] = 0
                if t == HAZARD:
                    b["hazard"] = [c, r]
                return


def on_pass_only(b, grid, T):
    """True when the body stands only on pass-through tiles (it can drop through)."""
    grid = as_grid(grid)
    if not b["onGround"]:
        return False
    # Math.round, not Python's banker's rounding.
    r = math.floor((b["y"] + b["h"] / 2) / T + 0.5)
    c0 = math.floor((b["x"] - b["w"] / 2) / T)
    c1 = math.floor((b["x"] + b["w"] / 2 - EPS) / T)
    any_pass = False
    for c in range(c0, c1 + 1):
        t = tile_at(grid, c, r)
        if blocks(t):
            return False
        if t == PASS:
            any_pass = True
    return any_pass
