"""Stage analysis: turns a scanned tile grid into a fair, playable stage.

Standable nodes are connected by walking and by moves from a jump table that is
simulated once at import with physics.step_body (real and pessimistic physics).
On top of that nav graph run the checks with automatic fixes from docs/SPEC.md
(main stage, unreachable platforms, recovery, enclosed pockets), then fair spawns.
"""

import itertools
import logging
import math
import time
from collections import deque

import cv2
import numpy as np

import physics
from config import GAME
from physics import EMPTY, FIX, HAZARD, PASS, SOLID

log = logging.getLogger("sketch")

COLS = GAME["cols"]
ROWS = GAME["rows"]
T = GAME["tileSize"]
FPS = GAME["physics"]["fps"]
DT = 1 / FPS
HALF_W = GAME["fighter"]["width"] / 2
HALF_H = GAME["fighter"]["height"] / 2


def pessimistic_physics(game):
    """The analyzer's physics: jumps and run speed scaled down by validatorPessimism."""
    k = game["analysis"]["validatorPessimism"]
    phys = dict(game["physics"])
    for key in ("jumpVelocity", "doubleJumpVelocity", "runSpeed"):
        phys[key] = phys[key] * k
    return phys


FULL_PHYS = GAME["physics"]
PHYS = pessimistic_physics(GAME)

EDGE_TYPES = ("walk", "fall", "drop", "jump", "double_jump")
HOLD_FROM_MS = (0, 100, 200, 300)
HOLD_UNTIL_MS = (None, 150, 300, 450, 600)
FALL_HOLD_UNTIL_MS = (None, 100, 150, 300, 450, 600)  # 100: step off into a one-tile hole
DOUBLE_JUMP_AT_MS = (150, 250, 350, 450)
MAX_MOVE_STEPS = round(2.5 * FPS)

# Move outcomes besides a landed node index.
INVALID = -1
OFF_STAGE = -2

MIN_GROUND = 6
MAX_CANDIDATES = 10
MAX_ROUNDS = 3
# Traces evaluated (starts x traces) before the checks stop searching for fixes. Realistic
# stages use a few percent of it; noise grids hit it, which bounds the worst case.
MAX_WORK = 1_000_000
DEFAULT_FLOOR_ROW = ROWS * 2 // 3 + 1
DEFAULT_COLS = (COLS // 6, COLS - COLS // 6 - 1)
RECOVERY_POINTS = ((3, 2), (4, 3), (5, 4))  # (tiles out, tiles below) from an outer edge
RECOVERY_JUMP_MS = (0, 100, 200)
RECOVERY_STEPS = round(1.5 * FPS)
MAX_LEDGE_CANDIDATES = 12  # physics-prechecked per edge; each one that passes costs a rebuild


def _blocking(codes):
    return (codes == SOLID) | (codes == HAZARD) | (codes == FIX)


def ms_to_step(ms):
    return math.floor(ms * FPS / 1000 + 0.5)


def recipe_input(recipe, step):
    """Open-loop input for `step` of a move recipe: what the analyzer simulated."""
    hold_from = ms_to_step(recipe["holdFromMs"])
    until = recipe["holdUntilMs"]
    held = step >= hold_from and (until is None or step < ms_to_step(until))
    jumps = recipe["type"] in ("jump", "double_jump") and step == 0
    if recipe["type"] == "double_jump" and step == ms_to_step(recipe["doubleJumpAtMs"]):
        jumps = True
    down = recipe["type"] == "drop" and step == 0
    return {"dir": recipe["dir"] if held else 0, "down": down, "jump": jumps}


def _recipe(kind, d, hold_from=0, until=None, dj_at=None):
    return {"type": kind, "dir": d, "holdFromMs": hold_from, "holdUntilMs": until, "doubleJumpAtMs": dj_at}


def _recipes():
    """All move recipes, simplest first, so dedupe and edge selection keep the simplest."""
    out = [_recipe("fall", d, until=until) for until in FALL_HOLD_UNTIL_MS for d in (1, -1)]
    for kind in ("drop", "jump", "double_jump"):
        for dj in DOUBLE_JUMP_AT_MS if kind == "double_jump" else (None,):
            out.append(_recipe(kind, 0, dj_at=dj))
            for hold_from in HOLD_FROM_MS:
                for until in HOLD_UNTIL_MS:
                    if until is None or until > hold_from:
                        out += [_recipe(kind, d, hold_from, until, dj) for d in (1, -1)]
    return out


# --- Jump table ---------------------------------------------------------------
#
# Every move is simulated once from a standing start on a template grid that
# holds only the support tile, and stored as an ordered event list relative to
# the start node:
#   cell     the hitbox overlaps (dc, dr) for the first time; a blocking tile there
#            makes the move invalid (pessimistic: bonks and wall hits are rejected)
#   crossing the hitbox bottom crosses the top of row dr while descending, over
#            columns dc0..dc1; a tile there that the body would stand on is the landing
# Order within a step follows integrate(): X-move cells, the crossing, Y-move cells.
#
# The template is flown from one absolute position, but the game flies the move from every
# node, and the CPU starts it anywhere within START_SLACK px of the node centre (amendment 16).
# So cells are those of the hitbox widened by START_SLACK on both sides (every start the CPU
# may use), and a crossing lists the columns any of those starts may cover; the columns that
# every start covers are "sure". Positions reached by integration are also only known to float
# precision: a side lying exactly on a tile boundary in the template may cover the next tile by
# 1e-12 px elsewhere, so integrated positions are widened by BOUNDARY_TOL as well. A landing
# counts only on a sure column; one that only some starts would make (a pass-through corner
# cleared by under 3 px) makes the move invalid.
#
# Each recipe is traced twice: with the real physics the game and CPU use, and with
# the pessimistic physics as a safety margin. A move counts only where both traces
# are valid and land on the same platform (same row, connected by walking); the edge
# goes to the node the real trace lands on. A CPU that holds the recipe's direction
# and stops at that node's centre then flies the real trace (holding a direction
# until a target x is reached is what holdUntilMs encodes), and a stronger jump that
# would bonk a ceiling or land on a higher pass-through platform is caught.

CELL, CROSS_LAND_PASS, CROSS_DROPPING = 0, 1, 2
START_SLACK = 3.0
BOUNDARY_TOL = 1e-7  # far above float error (~1e-11 px), far below physics.EPS and any real step
_TC, _TR = 40, 12
_TEMPLATE_SIZE = (_TR + ROWS + 6, 2 * _TC)


def _hitbox_cells(x, y):
    c0 = math.floor((x - HALF_W) / T)
    c1 = math.floor((x + HALF_W - physics.EPS) / T)
    r0 = math.floor((y - HALF_H) / T)
    r1 = math.floor((y + HALF_H - physics.EPS) / T)
    return [(c, r) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]


def _span(lo, hi, tol):
    """First and last tile index a box side-to-side [lo, hi) may cover, with tol of slack."""
    return math.floor((lo - tol) / T), math.floor((hi - physics.EPS + tol) / T)


def _trace(recipe, phys):
    """Events of one recipe: (kind, dc, dr, crossing) with crossing = (dc1, dcc, dx px, sure0, sure1)
    or None; columns are relative to the start node."""
    tiles = [[EMPTY] * _TEMPLATE_SIZE[1] for _ in range(_TEMPLATE_SIZE[0])]
    tiles[_TR + 1][_TC] = PASS if recipe["type"] == "drop" else SOLID
    grid = physics.Grid(_TEMPLATE_SIZE[1], _TEMPLATE_SIZE[0], tiles)
    b = physics.create_body(GAME, _TC, _TR)
    x_start, y_start = b["x"], b["y"]
    slack = 0.0 if recipe["type"] == "fall" else START_SLACK
    half_w = HALF_W + slack
    events, seen = [], set()

    def enter(x, y):
        tx = BOUNDARY_TOL if x != x_start else 0.0
        ty = BOUNDARY_TOL if y != y_start else 0.0
        c0, c1 = _span(x - half_w, x + half_w, tx)
        r0, r1 = _span(y - HALF_H, y + HALF_H, ty)
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                if (c, r) not in seen:
                    seen.add((c, r))
                    events.append((CELL, c - _TC, r - _TR, None))

    enter(b["x"], b["y"])
    airborne = False
    for step in range(MAX_MOVE_STEPS):
        y0 = b["y"]
        physics.step_body(b, recipe_input(recipe, step), grid, GAME, phys, DT)
        x1, y1 = b["x"], b["y"]
        enter(x1, y0)

        # Same test as physics._resolve_y; a landing snaps y exactly onto the row top.
        row = None
        if b["onGround"]:
            row = round((y1 + HALF_H) / T)
        elif b["vy"] > 0:
            row = math.floor((y1 + HALF_H - physics.EPS) / T)
            if y0 + HALF_H > row * T + physics.EPS:
                row = None
        # While still walking on the support the real grid behaves exactly like the template.
        if row is not None and (airborne or not b["onGround"]):
            kind = CROSS_DROPPING if b["dropTimer"] > 0 else CROSS_LAND_PASS
            tx = BOUNDARY_TOL if x1 != x_start else 0.0
            c0, c1 = _span(x1 - half_w, x1 + half_w, tx)  # any start may cover these
            s0, s1 = _span(x1 - HALF_W + slack, x1 + HALF_W - slack, -tx)  # every start
            assert c1 - c0 <= 1 and c0 <= s0 <= s1 <= c1
            centre = math.floor(x1 / T)
            events.append((kind, c0 - _TC, row - _TR, (c1 - _TC, centre - _TC, x1 - x_start, s0 - _TC, s1 - _TC)))

        if b["onGround"]:
            if airborne:
                break
        else:
            airborne = True
        enter(x1, y1)
        if math.floor((y1 - HALF_H) / T) - _TR > ROWS:
            break
    return events


class _JumpTable:
    """All deduped moves, flattened into numpy arrays for vectorized checks.

    Segment s < n_moves is the pessimistic trace of move s, segment n_moves + s its
    real-physics trace."""

    def __init__(self):
        t0 = time.perf_counter()
        recipes = _recipes()
        self.moves, pessimistic, real, keys = [], [], [], set()
        for recipe in recipes:
            p, f = _trace(recipe, PHYS), _trace(recipe, FULL_PHYS)
            key = (recipe["type"], tuple(p), tuple(f))
            if key in keys:
                continue
            keys.add(key)
            self.moves.append(recipe)
            pessimistic.append(p)
            real.append(f)
        self.recipes_total = len(recipes)
        self.n_moves = len(self.moves)
        self.type_id = np.array([EDGE_TYPES.index(m["type"]) for m in self.moves], np.int8)
        self.is_drop = np.array([m["type"] == "drop" for m in self.moves])
        self._flatten(pessimistic + real)
        self.build_ms = (time.perf_counter() - t0) * 1000

    def _flatten(self, traces):
        events = []  # (kind, dc, dr, crossing id or -1, segment)
        crossings = []  # (dr, dc0, dc1, dcc, dx, dropping, segment, index of its first event, sure0, sure1)
        starts = []
        for s, trace in enumerate(traces):
            starts.append(len(events))
            for k, c, r, extra in trace:
                if k == CELL:
                    events.append((k, c, r, -1, s))
                    continue
                c1, cc, dx, s0, s1 = extra
                crossings.append((r, c, c1, cc, dx, k == CROSS_DROPPING, s, len(events), s0, s1))
                events += [(k, col, r, len(crossings) - 1, s) for col in sorted({c, c1})]
        self.seg_end = np.array(starts[1:] + [len(events)], np.int64)
        kind, dc, dr, cross, seg = zip(*events)
        self.kind = np.array(kind, np.uint8)
        self.dc = np.array(dc, np.int32)
        self.dr = np.array(dr, np.int32)
        self.cross = np.array(cross, np.int32)
        self.seg = np.array(seg, np.int32)
        keys = ("dr", "dc0", "dc1", "dcc", "dx", "drop", "seg", "event", "sure0", "sure1")
        dtypes = {"drop": bool, "dx": np.float64}
        self.cr = {k: np.array(v, dtypes.get(k, np.int32)) for k, v in zip(keys, zip(*crossings))}

        # Padding so every event offset stays inside one flat array.
        self.pad_top = int(max(1, -self.dr.min()))
        self.pad_left = int(max(1, -self.dc.min()))
        self.pad_right = int(max(1, self.dc.max()))
        self.width = self.pad_left + COLS + self.pad_right
        offset = self.dr.astype(np.int64) * self.width + self.dc

        # Events below the grid can never trigger, so a start on row r only needs
        # events with dr <= ROWS - 1 - r. One selection per depth.
        # Candidate searches use the real traces only (verification checks both).
        self.by_depth = {}
        for real_only in (False, True):
            first_seg = self.n_moves if real_only else 0
            for depth in range(1, ROWS):
                sel = np.nonzero((self.dr <= depth) & (self.seg >= first_seg))[0]
                seg_starts = np.searchsorted(self.seg[sel], np.arange(first_seg, len(traces)))
                bit = _EVENT_BIT[self.kind[sel]]
                self.by_depth[real_only, depth] = (sel, offset[sel].astype(np.int32), bit, seg_starts)

    def pad(self, grid, fill):
        out = np.full((self.pad_top + ROWS + 1, self.width), fill, grid.dtype)
        out[self.pad_top:self.pad_top + ROWS, self.pad_left:self.pad_left + COLS] = grid
        return out

    def first_triggers(self, tiles_pad, cols, rows, work, real_only=False):
        """Global index of the first event that stops each trace from each start, -1 if none.
        Columns are segments: all 2 * n_moves, or with real_only the n_moves real traces.
        work: a one-item list counting traces evaluated, the analysis' deterministic cost."""
        bits = _TRIGGER_BITS[tiles_pad].ravel()
        out = np.full((len(cols), (1 if real_only else 2) * self.n_moves), -1, np.int64)
        work[0] += out.size
        depths = ROWS - 1 - rows
        for depth in np.unique(depths):
            idx = np.nonzero(depths == depth)[0]
            sel, off, bit, seg_starts = self.by_depth[real_only, int(depth)]
            n_events = len(sel)
            positions = np.arange(n_events, dtype=np.int32)
            for chunk in np.array_split(idx, max(1, len(idx) // 32)):
                base = (rows[chunk] + self.pad_top) * self.width + cols[chunk] + self.pad_left
                base = base.astype(np.int32)
                trig = (np.take(bits, base[:, None] + off[None, :]) & bit).astype(bool)
                first = np.minimum.reduceat(np.where(trig, positions, n_events), seg_starts, axis=1)
                out[chunk] = np.where(first < n_events, sel[np.minimum(first, n_events - 1)], -1)
        return out


# Bit 1: the tile stops a cell or dropping-crossing event (it blocks). Bit 2: it stops a
# crossing that lands on pass-through tiles too.
_TRIGGER_BITS = np.zeros(5, np.uint8)
_TRIGGER_BITS[[SOLID, HAZARD, FIX]] |= 1
_TRIGGER_BITS[[SOLID, PASS, HAZARD, FIX]] |= 2
_EVENT_BIT = np.array([1, 2, 1], np.uint8)  # by event kind: CELL, CROSS_LAND_PASS, CROSS_DROPPING

TABLE = _JumpTable()
log.info("jump table: %d moves from %d recipes, %d events, built in %.0f ms",
         TABLE.n_moves, TABLE.recipes_total, len(TABLE.kind), TABLE.build_ms)


# --- Nav graph ------------------------------------------------------------------


def standable(tiles):
    """Empty tile, solid/pass/fix below, and the tile above leaves room for the hitbox."""
    below = np.zeros_like(tiles)
    below[:-1] = tiles[1:]
    above = np.zeros_like(tiles)
    above[1:] = tiles[:-1]
    support = (below == SOLID) | (below == PASS) | (below == FIX)
    return (tiles == EMPTY) & support & ~_blocking(above)


def _open_air(tiles):
    """Cells connected to open air (the grid border counts as open) through empty/pass tiles."""
    passable = np.pad((tiles == EMPTY) | (tiles == PASS), 1, constant_values=True).astype(np.uint8)
    _, labels = cv2.connectedComponents(passable, connectivity=4)
    return (labels == labels[0, 0])[1:-1, 1:-1]


def _landed(first, tiles_pad, node_pad, cols, rows):
    """Decode first triggers: landed node index, INVALID or OFF_STAGE, and the landing dx in px."""
    node = np.full(first.shape, OFF_STAGE, np.int32)
    dx = np.zeros(first.shape)
    ni, si = np.nonzero(first >= 0)
    f = first[ni, si]
    res = np.full(len(f), INVALID, np.int32)
    is_cross = TABLE.kind[f] != CELL
    k = TABLE.cross[f[is_cross]]
    c0 = cols[ni[is_cross]]
    r = rows[ni[is_cross]] + TABLE.cr["dr"][k] + TABLE.pad_top
    a = c0 + TABLE.cr["dc0"][k] + TABLE.pad_left
    b = c0 + TABLE.cr["dc1"][k] + TABLE.pad_left
    cc = c0 + TABLE.cr["dcc"][k] + TABLE.pad_left
    other = np.where(cc == a, b, a)
    dropping = TABLE.cr["drop"][k]

    s0 = c0 + TABLE.cr["sure0"][k] + TABLE.pad_left
    s1 = c0 + TABLE.cr["sure1"][k] + TABLE.pad_left

    def lands(col):
        t = tiles_pad[r, col]
        return (t == SOLID) | (t == FIX) | ((t == PASS) & ~dropping)

    def sure(col):  # every start the CPU may use covers this column (see _trace)
        return (col >= s0) & (col <= s1)

    centre_node = node_pad[r - 1, cc]
    other_node = node_pad[r - 1, other]
    picked = np.where(lands(other) & sure(other) & (other_node >= 0), other_node, INVALID)
    picked = np.where(lands(cc) & sure(cc) & (centre_node >= 0), centre_node, picked)
    # A column only some starts cover lands those starts and not the others: ambiguous.
    maybe = (lands(a) & ~sure(a)) | (lands(b) & ~sure(b))
    sure_landing = (lands(a) & sure(a)) | (lands(b) & sure(b))
    hazard = (tiles_pad[r, a] == HAZARD) | (tiles_pad[r, b] == HAZARD)
    res[is_cross] = np.where(hazard | (maybe & ~sure_landing), INVALID, picked)
    node[ni, si] = res
    dx[ni[is_cross], si[is_cross]] = TABLE.cr["dx"][k]
    return node, dx


def _outcomes(tiles_pad, node_pad, runs, cols, rows, work):
    """Per start and move: the real-physics landing node (when the pessimistic trace lands on
    the same platform), INVALID or OFF_STAGE; and the real landing dx in px."""
    first = TABLE.first_triggers(tiles_pad, cols, rows, work)
    node, dx = _landed(first, tiles_pad, node_pad, cols, rows)
    m = TABLE.n_moves
    weak, real = node[:, :m], node[:, m:]
    run = np.append(runs, -1)  # index -1 (INVALID) and -2 (OFF_STAGE) land on -1 / last run
    same = (weak >= 0) & (real >= 0) & (run[np.maximum(weak, -1)] == run[np.maximum(real, -1)])
    out = np.where(same, real, np.where((weak == OFF_STAGE) & (real == OFF_STAGE), OFF_STAGE, INVALID))
    # Drops only start from a node standing on a pass-through tile.
    below = tiles_pad[rows + 1 + TABLE.pad_top, cols + TABLE.pad_left]
    out[np.ix_(below != PASS, TABLE.is_drop)] = INVALID
    return out, dx[:, m:]


class Nav:
    """Standable nodes, edges and strongly connected groups for one tile grid."""

    def __init__(self, tiles, work=None):
        self.tiles = tiles
        self.work = [0] if work is None else work
        stand = standable(tiles)
        self.rows, self.cols = np.nonzero(stand)
        self.n = len(self.rows)
        self.node_grid = np.full((ROWS, COLS), -1, np.int32)
        self.node_grid[self.rows, self.cols] = np.arange(self.n, dtype=np.int32)
        self.tiles_pad = TABLE.pad(tiles, EMPTY)
        self.node_pad = TABLE.pad(self.node_grid, -1)
        # Platform runs: node ids are row-major, so a run breaks where the row or column jumps.
        breaks = (np.diff(self.rows) != 0) | (np.diff(self.cols) != 1)
        self.runs = np.cumsum(np.r_[True, breaks]) if self.n else np.zeros(0, int)
        self.outcomes, self.land_dx = _outcomes(
            self.tiles_pad, self.node_pad, self.runs, self.cols, self.rows, self.work
        )
        self._edges()
        self.open = _open_air(tiles)[self.rows, self.cols]
        self.comp = _scc(self.n, self.adj)
        self.main = self._main_stage()
        self.main_spots = None  # cache for _main_landing_spots

    def _edges(self):
        both = (self.node_grid[:, :-1] >= 0) & (self.node_grid[:, 1:] >= 0)
        left = self.node_grid[:, :-1][both]
        right = self.node_grid[:, 1:][both]
        w_from = np.concatenate([left, right])
        w_to = np.concatenate([right, left])

        ni, mi = np.nonzero(self.outcomes >= 0)
        to = self.outcomes[ni, mi]
        # Self-landings are no-ops; landings on a horizontal neighbour duplicate walking.
        same_row = self.rows[ni] == self.rows[to]
        keep = (to != ni) & ~(same_row & (np.abs(self.cols[ni] - self.cols[to]) == 1))
        ni, mi, to = ni[keep], mi[keep], to[keep]
        types = TABLE.type_id[mi]
        key = (ni.astype(np.int64) * max(self.n, 1) + to) * len(EDGE_TYPES) + types
        # The CPU steers toward the target in closed loop, so prefer the recipe whose
        # open-loop landing is closest to the target centre; then the simplest.
        miss = np.round(np.abs(self.land_dx[ni, mi] - (self.cols[to] - self.cols[ni]) * T))
        order = np.lexsort((mi, miss, key))
        _, first = np.unique(key[order], return_index=True)
        pick = order[first]
        self.edge_from = np.concatenate([w_from, ni[pick]]).astype(np.int32)
        self.edge_to = np.concatenate([w_to, to[pick]]).astype(np.int32)
        self.edge_type = np.concatenate([np.zeros(len(w_from), np.int8), types[pick]])
        self.edge_move = np.concatenate([np.full(len(w_from), -1, np.int32), mi[pick]]).astype(np.int32)

        self.adj = [[] for _ in range(self.n)]
        self.radj = [[] for _ in range(self.n)]
        for a, b in set(zip(self.edge_from.tolist(), self.edge_to.tolist())):
            self.adj[a].append(b)
            self.radj[b].append(a)
        for lst in self.adj + self.radj:
            lst.sort()

    def _main_stage(self):
        # Main stage = largest strongly connected component in open air. Mutual
        # reachability is the property that matters: a fighter must be able to get
        # anywhere on the main stage and back. A one-way set (a pit you can drop into
        # but never leave) would pass a plain "reachable from" test.
        best, best_key = [], None
        groups = {}
        for i in range(self.n):
            if self.open[i]:
                groups.setdefault(self.comp[i], []).append(i)
        for members in groups.values():
            key = (len(members), max(self.rows[members]), -min(members))
            if best_key is None or key > best_key:
                best, best_key = members, key
        return sorted(best)

    def reach(self, sources, backward=False):
        adj = self.radj if backward else self.adj
        seen = set(sources)
        queue = deque(sources)
        while queue:
            for w in adj[queue.popleft()]:
                if w not in seen:
                    seen.add(w)
                    queue.append(w)
        return seen

    def cells(self, ids):
        return {(int(self.cols[i]), int(self.rows[i])) for i in ids}

    def export(self):
        used = sorted({int(m) for m in self.edge_move if m >= 0})
        remap = {m: i for i, m in enumerate(used)}
        edges = [
            [int(a), int(b), EDGE_TYPES[t], None if m < 0 else remap[int(m)]]
            for a, b, t, m in zip(self.edge_from, self.edge_to, self.edge_type, self.edge_move)
        ]
        return {
            "nodes": [[int(c), int(r)] for c, r in zip(self.cols, self.rows)],
            "edges": edges,
            "moves": [dict(TABLE.moves[m]) for m in used],
        }


def _scc(n, adj):
    """Iterative Tarjan. Returns the component id of every node."""
    index = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    comp = [-1] * n
    stack, counter, n_comp = [], 0, 0
    for root in range(n):
        if index[root] != -1:
            continue
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack[root] = True
        work = [(root, 0)]
        while work:
            v, i = work[-1]
            if i < len(adj[v]):
                work[-1] = (v, i + 1)
                w = adj[v][i]
                if index[w] == -1:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on_stack[w] = True
                    work.append((w, 0))
                elif on_stack[w]:
                    low[v] = min(low[v], index[w])
                continue
            work.pop()
            if work:
                u = work[-1][0]
                low[u] = min(low[u], low[v])
            if low[v] == index[v]:
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    comp[w] = n_comp
                    if w == v:
                        break
                n_comp += 1
    return comp


# --- Checks and fixes -----------------------------------------------------------


class _Stage:
    """Tiles under repair, the fixes applied so far, and a lazily rebuilt nav graph."""

    def __init__(self, tiles):
        self.tiles = tiles
        self.fixes = []
        self.default_added = False
        self.given_up = set()
        self.bridged = set()
        self.doored = set()
        self.added = set()  # cells an "add" fix set; later fixes leave them alone (except a dead end)
        self.work = [0]
        self._nav = None

    def busy(self):
        """Out of work budget: stop searching for fixes (keeps the worst case bounded)."""
        return self.work[0] > MAX_WORK

    @property
    def nav(self):
        if self._nav is None:
            self._nav = Nav(self.tiles, self.work)
        return self._nav

    def apply(self, kind, op, cells, message):
        """Set cells to FIX (add) or EMPTY (remove); solid ground is left as is by add.
        Records only the cells that changed. Returns an undo token, or None if nothing changed."""
        value = FIX if op == "add" else EMPTY
        changed = []
        for c, r in cells:
            code = self.tiles[r, c]
            if code == value or (op == "add" and code == SOLID) or (c, r) in changed:
                continue
            changed.append((c, r))
        if not changed:
            return None
        undo = (self.tiles, self._nav, self.added)
        self.tiles = self.tiles.copy()
        for c, r in changed:
            self.tiles[r, c] = value
        self._nav = None
        cells = [[int(c), int(r)] for c, r in changed]
        self.fixes.append({"type": kind, "op": op, "cells": cells, "message": message})
        if op == "add":
            self.added = self.added | set(changed)
        return undo

    def revert(self, undo):
        self.tiles, self._nav, self.added = undo
        self.fixes.pop()


def _check_ground(stage):
    """Almost no ground: add a default flat stage across the bottom third."""
    nav = stage.nav
    if stage.default_added or int(nav.open.sum()) >= MIN_GROUND:
        return
    stage.default_added = True
    c0, c1 = DEFAULT_COLS
    row = DEFAULT_FLOOR_ROW
    room = [(c, r) for r in (row - 2, row - 1) for c in range(c0, c1 + 1)]
    stage.apply("default_stage", "remove", room, "Cleared room for a default stage")
    floor = [(c, row) for c in range(c0, c1 + 1)]
    stage.apply("default_stage", "add", floor, "Added a default stage: there was almost no ground")


def _check_unreachable(stage):
    """Groups not mutually reachable with the main stage get a stepping platform (or two), else a
    doorway through the wall between, else are removed. Candidate searches, verifications (nav
    rebuilds) and removals all draw on one budget."""
    budget = [MAX_CANDIDATES]
    while budget[0] > 0 and not stage.busy():
        nav = stage.nav
        if not nav.main:
            return
        group = _next_bad_group(nav, stage.given_up)
        if group is None:
            return
        cells = nav.cells(group)
        key = frozenset(cells)
        need_in = group[0] not in nav.reach(nav.main)
        if need_in:
            src, dst, message = nav.main, group, "Added a step so you can reach a platform"
        else:
            src, dst, message = group, nav.main, "Added a step so you can get back up"
        joined = lambda new, step: _joined(new, cells, need_in) and _no_dead_end(new, step, cells)  # noqa: E731
        budget[0] -= 1
        result = _try_steps(stage, _step_candidates(nav, src, dst), joined, message, budget)
        if result is None:
            return
        if result:
            continue
        if key not in stage.doored:
            # Out of jumping range behind a wall (or a walled-in pit): cut a doorway through it.
            # Few candidates (only run ends that face a wall), so no search unit is charged.
            stage.doored.add(key)
            result = _doorway(stage, cells, need_in, budget)
            if result is None:
                return
            if result:
                continue
        if (key, need_in) not in stage.bridged:
            # Too far for one step: two, the mirror image for the way back up.
            stage.bridged.add((key, need_in))
            budget[0] -= 1
            message = "Added steps so you can reach a platform" if need_in else "Added steps so you can get back up"
            result = _bridge(stage, cells, need_in, message, budget)
            if result is None:
                return
            if result:
                continue
        # Every candidate failed: remove the platform (the reserved unit of budget).
        budget[0] -= 1
        protected = set(nav.main) | {i for i in range(nav.n) if not nav.open[i]}
        # A fix never undoes another, except to clear a dead end (worse than a removed step).
        added = stage.added if need_in else frozenset()
        if _remove_platform(stage, nav, group, protected, added):
            continue
        # The platform is drawn in one piece with the main stage. A dead end you can drop into but
        # never leave is worse than none: take away just the ground under it.
        if need_in or not _remove_under(stage, nav, group, added):
            stage.given_up.add(key)


def _bridge(stage, cells, need_in, message, budget):
    """Too far for one step: two steps (a stepping stone and a step), verified together."""
    nav = stage.nav
    group = _ids(nav, cells)
    src, dst = (nav.main, group) if need_in else (group, nav.main)
    joined = lambda new, step: _joined(new, cells, need_in) and _no_dead_end(new, step, cells)  # noqa: E731
    return _try_steps(stage, _two_step_candidates(nav, src, dst), joined, message, budget)


def _doorway(stage, cells, need_in, budget):
    """Cut through the wall beside one end of the group's platforms, fighter-high, so it joins the
    main stage by walking (or a short hop). Kept only if the group joins and the main stage loses
    nothing."""
    nav = stage.nav
    main_before = nav.cells(nav.main)

    def ok(new, door):
        if not _joined(new, cells, need_in):
            return False
        return (main_before - set(door)) - {(c, r - 1) for c, r in door} <= new.cells(new.main)

    message = "Opened a doorway so you can reach a platform" if need_in else "Opened a doorway so you can get back"
    candidates = _doorway_candidates(nav, _ids(nav, cells), stage.added)
    return _try_fixes(stage, candidates, ok, "opened_pocket", "remove", message, budget)


MAX_DOOR_DEPTH = 3  # tiles of wall a doorway may cut through


def _doorway_candidates(nav, group, protected, limit=4):
    """Cells to clear beside each end of the group's platform runs: the two rows a standing fighter
    fills, column by column through the wall, until the head row beyond it is clear. Fewest first."""
    tiles = nav.tiles
    out = set()
    for i in group:
        c, r = int(nav.cols[i]), int(nav.rows[i])
        for d in (-1, 1):
            x = c + d
            if not 0 <= x < COLS or nav.node_grid[r, x] >= 0 or not _blocking(tiles[r - 1:r + 1, x]).any():
                continue  # not a run end facing a wall
            door = []
            for _ in range(MAX_DOOR_DEPTH):
                door += [(x, rr) for rr in (r - 1, r) if rr >= 0 and _blocking(tiles[rr, x])]
                x += d
                if not 0 <= x < COLS or not _blocking(tiles[r - 1, x]):
                    break
            else:
                continue  # wall too thick
            if 0 <= x < COLS and door and not set(door) & protected:
                out.add(tuple(sorted(door)))
    return [list(door) for door in sorted(out, key=lambda d: (len(d), d))][:limit]


def _ids(nav, cells):
    return [int(nav.node_grid[r, c]) for c, r in sorted(cells) if nav.node_grid[r, c] >= 0]


def _try_steps(stage, candidates, ok, message, budget):
    return _try_fixes(stage, candidates, ok, "added_step", "add", message, budget)


def _try_fixes(stage, candidates, ok, kind, op, message, budget):
    """Apply candidates in order until ok(new_nav, step) holds: True. False when every candidate
    failed, None when out of budget first. Each rebuild costs one unit of budget; one unit stays
    in reserve so the platform can still be removed instead."""
    for step in candidates:
        if budget[0] <= 1 or stage.busy():
            return None
        undo = stage.apply(kind, op, step, message)
        if undo is None:
            continue
        budget[0] -= 1
        if ok(stage.nav, step):
            return True
        stage.revert(undo)
    return False


def _next_bad_group(nav, given_up):
    groups = {}
    main = set(nav.main)
    for i in range(nav.n):
        if nav.open[i] and i not in main:
            groups.setdefault(nav.comp[i], []).append(i)
    ordered = sorted(groups.values(), key=lambda g: (-len(g), g[0]))
    for group in ordered:
        if frozenset(nav.cells(group)) not in given_up:
            return group
    return None


def _no_dead_end(nav, step, cells):
    """Every node standing on the new step tiles leads on: back to the main stage or into the group."""
    on_step = [int(nav.node_grid[r - 1, c]) for c, r in step if r >= 1 and nav.node_grid[r - 1, c] >= 0]
    if not on_step:
        return True
    leads_on = nav.reach(nav.main, backward=True) | nav.reach(_ids(nav, cells), backward=True)
    return all(i in leads_on for i in on_step)


def _joined(nav, cells, need_in):
    """Most of the group now reaches the main stage (need_in) or gets back to it. Most, not all: a
    stray one-tile speck in the group must not veto a step that frees the rest; whatever stays
    behind is a smaller group of its own, fixed or removed on a later pass."""
    if not nav.main:
        return False
    ids = [int(nav.node_grid[r, c]) for c, r in cells]
    reach = nav.reach(nav.main) if need_in else nav.reach(nav.main, backward=True)
    return 2 * sum(i >= 0 and i in reach for i in ids) > len(ids)


def _main_landing_spots(nav):
    if nav.main_spots is None:
        nav.main_spots = _landing_spots(nav, nav.cols[nav.main], nav.rows[nav.main])
    return nav.main_spots


def _landing_spots(nav, cols, rows):
    """For starts (cols, rows), the empty cells where a step tile would be landed on: the real
    trace of a move crosses that row top there before anything stops it. Returns (start
    index, flat cell index) pairs. A search heuristic; candidates are verified by a rebuild."""
    m = TABLE.n_moves
    first = TABLE.first_triggers(nav.tiles_pad, cols, rows, nav.work, real_only=True)
    real = TABLE.cr["seg"] >= m
    seg, event = TABLE.cr["seg"][real] - m, TABLE.cr["event"][real]
    ok = event[None, :] < np.where(first >= 0, first, TABLE.seg_end[m:][None, :])[:, seg]
    support = nav.tiles_pad[rows + 1 + TABLE.pad_top, cols + TABLE.pad_left]
    ok &= ~(TABLE.is_drop[seg][None, :] & (support != PASS)[:, None])
    ni, ki = np.nonzero(ok)
    c = cols[ni] + TABLE.cr["dcc"][real][ki]
    r = rows[ni] + TABLE.cr["dr"][real][ki]
    inside = (c >= 0) & (c < COLS) & (r >= 1) & (r < ROWS)
    ni, flat = ni[inside], (r * COLS + c)[inside]
    keep = _step_spots(nav).ravel()[flat]
    return ni[keep], flat[keep]


def _step_spots(nav):
    """Cells where a step tile may go: empty, with an empty cell above to stand in, headroom
    above that, and not taking a cell an existing node stands in or needs as headroom."""
    tiles = nav.tiles
    ok = np.zeros((ROWS, COLS), bool)
    ok[1:] = (tiles[1:] == EMPTY) & (tiles[:-1] == EMPTY)
    ok[2:] &= ~_blocking(tiles[:-2])
    ok &= nav.node_grid < 0
    ok[:-1] &= nav.node_grid[1:] < 0
    return ok


def _leaving(nav, flat, dst):
    """How many moves from a step at each flat cell land on a dst node (real traces only)."""
    rows, cols = np.divmod(flat, COLS)
    first = TABLE.first_triggers(nav.tiles_pad, cols, rows - 1, nav.work, real_only=True)
    out, _ = _landed(first, nav.tiles_pad, nav.node_pad, cols, rows - 1)
    out[:, TABLE.is_drop] = INVALID  # a step is never pass-through
    is_dst = np.zeros(nav.n + 1, bool)
    is_dst[np.asarray(dst)] = True
    return is_dst[np.where(out >= 0, out, nav.n)].sum(axis=1)


def _step_candidates(nav, src, dst, spots=60, limit=4):
    """Up to `limit` steps (lists of cells) that moves reach from src and leave toward dst, best
    first, judged from the `spots` most landed-on cells."""
    if src is nav.main:
        _, flat = _main_landing_spots(nav)
    else:
        _, flat = _landing_spots(nav, nav.cols[src], nav.rows[src])
    if len(flat) == 0:
        return []
    cells, counts = np.unique(flat, return_counts=True)
    top = np.argsort(-counts, kind="stable")[:spots]
    cells, counts = cells[top], counts[top]
    score = counts * _leaving(nav, cells, dst)
    order = np.lexsort((cells, -score))
    steps = (_step_cells(nav.tiles, *_cell(cells[i])) for i in order if score[i] > 0)
    return list(itertools.islice((step for step in steps if step), limit))


def _two_step_candidates(nav, src, group, stones=20, seconds=80, limit=3):
    """Pairs of steps src -> stone -> step -> group for groups too far for one step, best first.
    src is the main stage (to reach a group) or the group (to get back up to the main stage)."""
    if src is nav.main:
        _, flat = _main_landing_spots(nav)
    else:
        _, flat = _landing_spots(nav, nav.cols[src], nav.rows[src])
    if len(flat) == 0:
        return []
    spots, counts = np.unique(flat, return_counts=True)
    pick = _nearest(nav, spots, group, stones)
    si, flat2 = _landing_spots(nav, (spots[pick] % COLS), (spots[pick] // COLS) - 1)
    stone = spots[pick][si]
    apart = (flat2 // COLS != stone // COLS) | (np.abs(flat2 % COLS - stone % COLS) > 2)
    stone, flat2 = stone[apart], flat2[apart]
    second = np.unique(flat2)
    second = np.sort(second[_nearest(nav, second, group, seconds)])
    known = np.isin(flat2, second)
    stone, flat2 = stone[known], flat2[known]
    if len(flat2) == 0:
        return []
    second_leaving = _leaving(nav, second, group)
    lv = second_leaving[np.searchsorted(second, flat2)]
    pairs, n_ways = np.unique(np.stack([stone, flat2], axis=1)[lv > 0], axis=0, return_counts=True)
    if len(pairs) == 0:
        return []
    score = counts[np.searchsorted(spots, pairs[:, 0])] * n_ways
    score *= second_leaving[np.searchsorted(second, pairs[:, 1])]
    out = []
    for i in np.lexsort((pairs[:, 1], pairs[:, 0], -score)):
        a, b = _step_cells(nav.tiles, *_cell(pairs[i, 0])), _step_cells(nav.tiles, *_cell(pairs[i, 1]))
        if a and b and not set(a) & set(b):
            out.append(a + b)
            if len(out) >= limit:
                break
    return out


def _nearest(nav, spots, group, k):
    """Indices of the k step spots nearest to the group's nodes."""
    rows, cols = np.divmod(spots, COLS)
    gc, gr = nav.cols[group], nav.rows[group]
    dist = ((cols[:, None] - gc[None, :]) ** 2 + (rows[:, None] - 1 - gr[None, :]) ** 2).min(axis=1)
    # A step right under the group would be in the way of the jump up to it.
    under = (cols >= gc.min() - 1) & (cols <= gc.max() + 1) & (rows - 1 > gr.max())
    return np.lexsort((spots, dist, under))[:k]


def _cell(flat):
    r, c = divmod(int(flat), COLS)
    return c, r


def _step_cells(tiles, c, r):
    """A 2-3 tile step at row r around column c, or None if there is no room."""
    cells = [(c, r)]
    cells += [(x, r) for x in (c - 1, c + 1) if 0 <= x < COLS and tiles[r, x] == EMPTY == tiles[r - 1, x]]
    return cells if len(cells) >= 2 else None


def _remove_platform(stage, nav, group, protected, added=frozenset()):
    """Remove the tile blob under an unreachable group, unless it also holds up a protected node
    or holds tiles an earlier fix added (a fix never undoes another)."""
    tiles = nav.tiles
    ground = ((tiles == SOLID) | (tiles == PASS) | (tiles == FIX)).astype(np.uint8)
    _, labels = cv2.connectedComponents(ground, connectivity=4)
    blob = np.isin(labels, list({int(labels[nav.rows[i] + 1, nav.cols[i]]) for i in group}))
    holds = blob[nav.rows + 1, nav.cols]
    if any(holds[i] for i in protected):
        return False
    cells = [(int(c), int(r)) for r, c in np.argwhere(blob)]
    if added & set(cells):
        return False
    message = "Removed a platform nobody could reach"
    return stage.apply("removed_platform", "remove", cells, message) is not None


def _remove_under(stage, nav, group, added):
    """Remove the tiles straight under a group's nodes, down to the first gap, stopping at a tile
    that holds up any other node. False if that would touch a tile an earlier fix added."""
    tiles = nav.tiles
    members = set(group)
    cells = []
    for i in group:
        c, r = int(nav.cols[i]), int(nav.rows[i]) + 1
        while r < ROWS and tiles[r, c] != EMPTY:
            above = int(nav.node_grid[r - 1, c])
            if above >= 0 and above not in members:
                break
            if (c, r) in added:
                return False
            cells.append((c, r))
            r += 1
    message = "Removed a dead end you could not get back from"
    return stage.apply("removed_platform", "remove", cells, message) is not None


def _check_recovery(stage):
    """From off-stage points near each outer edge a double-jump recovery must land; else add a ledge."""
    tried = 0
    for side in (-1, 1):
        nav = stage.nav
        if not nav.main:
            return
        edge = _outer_edge(nav, side)
        main_cells = nav.cells(nav.main)
        if (edge, side) in stage.given_up or _edge_recovers(nav.tiles, main_cells, edge, side):
            continue
        for ledge in itertools.islice(_ledge_candidates(nav, edge, side), MAX_LEDGE_CANDIDATES):
            if tried >= MAX_CANDIDATES or stage.busy():
                return
            trial = nav.tiles.copy()
            for c, r in ledge:
                trial[r, c] = FIX
            ledge_nodes = {(c, r - 1) for c, r in ledge}
            if not _edge_recovers(trial, main_cells | ledge_nodes, edge, side):
                continue  # cheap physics pre-check before rebuilding the nav graph
            tried += 1
            undo = stage.apply("added_ledge", "add", ledge, "Added a ledge so you can recover")
            new = stage.nav
            new_main = new.cells(new.main)
            if ledge_nodes <= new_main and _edge_recovers(new.tiles, new_main, edge, side):
                break
            stage.revert(undo)
        else:
            stage.given_up.add((edge, side))


def _outer_edge(nav, side):
    main = nav.main
    key = (lambda i: (nav.cols[i], -nav.rows[i])) if side < 0 else (lambda i: (-nav.cols[i], -nav.rows[i]))
    i = min(main, key=key)
    return int(nav.cols[i]), int(nav.rows[i])


def _overlaps_blocking(tiles, col, row):
    b = physics.create_body(GAME, col, row)
    for c, r in _hitbox_cells(b["x"], b["y"]):
        if 0 <= r < ROWS and 0 <= c < COLS and tiles[r, c] in (SOLID, HAZARD, FIX):
            return True
    return False


def _edge_recovers(tiles, main_cells, edge, side):
    grid = physics.as_grid(tiles)
    lowest_y = (max(r for _, r in main_cells) + 1) * T
    started = False
    for out, below in RECOVERY_POINTS:
        col, row = edge[0] + side * out, edge[1] + below
        if _overlaps_blocking(tiles, col, row):
            continue
        started = True
        target = min(main_cells, key=lambda n: ((n[0] - col) ** 2 + (n[1] - row) ** 2, n[1], n[0]))
        for jump_ms in RECOVERY_JUMP_MS:
            if _recovers(grid, main_cells, lowest_y, col, row, target, ms_to_step(jump_ms)):
                return True
    return not started


def _recovers(grid, main_cells, lowest_y, col, row, target, jump_step):
    """Airborne at (col, row) with one air jump: steer toward target, jump once, land on the main stage?
    lowest_y: feet level of the lowest main-stage node; below it the body can no longer land there."""
    b = physics.create_body(GAME, col, row)
    b["onGround"] = False
    target_x = target[0] * T + T / 2
    for step in range(RECOVERY_STEPS):
        dx = target_x - b["x"]
        d = 0 if abs(dx) <= 2 else (1 if dx > 0 else -1)
        physics.step_body(b, {"dir": d, "down": False, "jump": step == jump_step}, grid, GAME, PHYS, DT)
        if b["hazard"] is not None:
            return False
        if b["onGround"]:
            r = round((b["y"] + HALF_H) / T) - 1
            x = b["x"]
            covered = (x / T, (x - HALF_W) / T, (x + HALF_W - physics.EPS) / T)
            return any((math.floor(c), r) in main_cells for c in covered)
        if step > jump_step and b["vy"] > 0 and b["y"] + HALF_H > lowest_y:
            return False  # jump spent, falling, already below every main-stage node
    return False


def _ledge_candidates(nav, edge, side):
    """3-tile ledges beside and below an outer edge that the main stage can reach and leave
    (judged on the current nav graph; the caller verifies)."""
    ec, er = edge
    spots = set(_main_landing_spots(nav)[1].tolist())
    for k in range(1, 5):
        r = er + k
        if r >= ROWS:
            return
        for dist in range(1, 8):
            cells = [(ec + side * (dist + i), r) for i in range(3)]
            if not all(_ledge_cell_ok(nav.tiles, c, r) for c, r in cells):
                continue
            flat = np.array([r * COLS + c for c, r in cells])
            if spots.isdisjoint(flat.tolist()) or not _leaving(nav, flat, nav.main).any():
                continue
            yield cells


def _ledge_cell_ok(tiles, c, r):
    if not (0 <= c < COLS and 2 <= r < ROWS):
        return False
    return tiles[r, c] == EMPTY and tiles[r - 1, c] == EMPTY and tiles[r - 2, c] not in (SOLID, HAZARD, FIX)


def _check_pockets(stage):
    """Empty regions sealed off from open air are opened by removing the fewest tiles.

    Where the fewest is one tile, it matters which: a hole in the roof of a tall box makes a pit you
    can drop into and never leave. So when the pocket has room for a fighter, a few one-tile
    openings (in its floor, low in a side wall, high in a side wall, in its roof) and a doorway
    through a side wall at its floor are tried, in that order; the first that leaves every node in
    the pocket reachable and escapable is kept, else the one that traps fewest (then strands fewest).
    Only pockets with room for a platform (MIN_POCKET_ROOM nodes) are judged, at most
    MAX_POCKETS_JUDGED per pass: each option costs a nav rebuild, and noise is full of tiny pockets."""
    judged = 0
    for _ in range(MAX_CANDIDATES):
        tiles = stage.tiles
        open_air = _open_air(tiles)
        pockets = ((tiles == EMPTY) | (tiles == PASS)) & ~open_air
        if not pockets.any():
            return
        _, labels = cv2.connectedComponents(pockets.astype(np.uint8), connectivity=4)
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        pocket = labels == int(np.argmax(sizes))
        cheapest = _cheapest_opening(tiles, pocket, open_air)
        options = [(cheapest, "Opened a sealed pocket")]
        room = int((standable(tiles) & pocket).sum())
        if room >= MIN_POCKET_ROOM and judged < MAX_POCKETS_JUDGED and not stage.busy():
            judged += 1
            if len(cheapest) == 1:
                options = [([cell], "Opened a sealed pocket") for cell in _one_tile_openings(tiles, pocket, open_air)]
                options = options or [(cheapest, "Opened a sealed pocket")]
            door = _pocket_doorway(tiles, pocket, stage.added)
            if door:
                options.append((door, "Opened a doorway into a sealed pocket"))
        best = None
        for i, (cells, message) in enumerate(options):
            undo = stage.apply("opened_pocket", "remove", cells, message)
            if undo is None:
                continue
            if len(options) == 1:
                break
            score = (_trapped(stage.nav, pocket), _stranded(stage.nav, pocket), i)
            if score[:2] == (0, 0):
                best = None
                break
            stage.revert(undo)
            best = min(best or score, score)
        if best is not None:
            stage.apply("opened_pocket", "remove", *options[best[2]])


MIN_POCKET_ROOM = 3
MAX_POCKETS_JUDGED = 3


def _one_tile_openings(tiles, pocket, open_air):
    """Single wall tiles between the pocket and open air (or the card edge): the one most central
    in the pocket's floor, the lowest and the highest in a side wall, the most central in its roof."""
    wall = _blocking(tiles)
    outside = np.pad(open_air, 1, constant_values=True)
    inside = np.pad(pocket, 1, constant_values=False)
    centre = np.nonzero(pocket)[1].mean()
    floor, side, roof = [], [], []
    for r, c in zip(*np.nonzero(wall)):
        r, c = int(r), int(c)
        pr, pc = r + 1, c + 1  # padded
        if inside[pr - 1, pc] and outside[pr + 1, pc]:
            floor.append((abs(c - centre), c, r))
        if (inside[pr, pc - 1] and outside[pr, pc + 1]) or (inside[pr, pc + 1] and outside[pr, pc - 1]):
            side.append((r, c))
        if inside[pr + 1, pc] and outside[pr - 1, pc]:
            roof.append((abs(c - centre), c, r))
    picks = []
    if floor:
        picks.append(min(floor)[1:])
    if side:
        picks += [max(side)[::-1], min(side)[::-1]]
    if roof:
        picks.append(min(roof)[1:])
    out = []
    for cell in picks:
        if cell not in out:
            out.append(cell)
    return out


def _stranded(nav, region):
    """How many open-air nodes in region (a cell mask) the main stage cannot reach."""
    if not nav.main:
        return 0
    fwd = nav.reach(nav.main)
    return sum(1 for i in range(nav.n) if region[nav.rows[i], nav.cols[i]] and i not in fwd)


def _trapped(nav, region):
    """How many nodes in region (a cell mask) the main stage can reach but not get back from."""
    if not nav.main:
        return 0
    inside = [i for i in range(nav.n) if region[nav.rows[i], nav.cols[i]]]
    if not inside:
        return 0
    fwd = nav.reach(nav.main)
    back = nav.reach(nav.main, backward=True)
    return sum(i in fwd and i not in back for i in inside)


def _pocket_doorway(tiles, pocket, protected):
    """The fewest wall tiles to clear, two rows tall (a standing fighter), sideways from the end of a
    floor inside the pocket until the head row and the foot row beyond are open air on the card."""
    stand = standable(tiles) & pocket
    open_out = ~_blocking(tiles) & ~pocket
    best = None
    for r, c in zip(*np.nonzero(stand)):
        r, c = int(r), int(c)
        for d in (-1, 1):
            x = c + d
            if not 0 <= x < COLS or stand[r, x] or not _blocking(tiles[r - 1:r + 1, x]).any():
                continue
            door = []
            for _ in range(MAX_DOOR_DEPTH):
                door += [(x, rr) for rr in (r - 1, r) if rr >= 0 and _blocking(tiles[rr, x])]
                x += d
                if not 0 <= x < COLS or (open_out[r - 1, x] and open_out[r, x]):
                    break
            if not 0 <= x < COLS or not (open_out[r - 1, x] and open_out[r, x]) or set(door) & protected:
                continue
            key = (len(door), -r, sorted(door))
            if best is None or key < best[0]:
                best = (key, door)
    return None if best is None else best[1]


def _cheapest_opening(tiles, pocket, open_air):
    """0-1 BFS from the pocket to open air (or off the grid): wall tiles on the cheapest path."""
    wall = _blocking(tiles)
    dist = np.full((ROWS, COLS), ROWS * COLS, np.int32)
    parent = {}
    queue = deque()
    for r, c in np.argwhere(pocket):
        dist[r, c] = 0
        queue.append((int(r), int(c)))
    done = np.zeros((ROWS, COLS), bool)
    end = None
    while queue:
        r, c = queue.popleft()
        if done[r, c]:
            continue
        done[r, c] = True
        if open_air[r, c] or r in (0, ROWS - 1) or c in (0, COLS - 1):
            end = (r, c)
            break
        for nr, nc in ((r - 1, c), (r, c - 1), (r, c + 1), (r + 1, c)):
            w = int(wall[nr, nc])
            if dist[r, c] + w < dist[nr, nc]:
                dist[nr, nc] = dist[r, c] + w
                parent[(nr, nc)] = (r, c)
                if w:
                    queue.append((nr, nc))
                else:
                    queue.appendleft((nr, nc))
    cells = []
    while end is not None:
        if wall[end]:
            cells.append((end[1], end[0]))
        end = parent.get(end)
    return cells[::-1]


CHECKS = (_check_ground, _check_unreachable, _check_recovery, _check_pockets)


# --- Spawns and entry point ------------------------------------------------------


def _edge_distances(nav, ids):
    """Tiles from each node to the nearer end of its walkable run."""
    out = []
    for i in ids:
        c, r = int(nav.cols[i]), int(nav.rows[i])
        left = c
        while left > 0 and nav.node_grid[r, left - 1] >= 0:
            left -= 1
        right = c
        while right < COLS - 1 and nav.node_grid[r, right + 1] >= 0:
            right += 1
        out.append(min(c - left, right - c))
    return np.array(out, float)


MIN_SPAWN_GAP = 8  # tiles between the spawns, or half the main stage's width if that is less


def _spawns(nav):
    """Two distinct main-stage nodes: mirrored around the stage centre, far apart, similar edge distance.
    Far apart is a hard floor (MIN_SPAWN_GAP), not just a cost: a platform hanging past the end of
    the floor shifts the centre, and mirroring about it must never put the fighters side by side."""
    ids = nav.main if len(nav.main) >= 2 else list(range(nav.n))
    if len(ids) < 2:
        c0, c1 = DEFAULT_COLS
        return [{"col": c0 + 4, "row": DEFAULT_FLOOR_ROW - 1}, {"col": c1 - 4, "row": DEFAULT_FLOOR_ROW - 1}]
    ids = np.array(ids)
    cols = nav.cols[ids].astype(float)
    rows = nav.rows[ids].astype(float)
    edge = _edge_distances(nav, ids)
    centre = (cols.min() + cols.max()) / 2
    target = max(4.0, (cols.max() - cols.min()) / 2)
    a, b = np.meshgrid(np.arange(len(ids)), np.arange(len(ids)), indexing="ij")
    cost = (
        2 * np.abs(cols[a] + cols[b] - 2 * centre)
        + 3 * np.abs(rows[a] - rows[b])
        + 2 * np.abs(edge[a] - edge[b])
        + np.abs(cols[b] - cols[a] - target)
        + 6 * ((edge[a] < 2).astype(float) + (edge[b] < 2))
        + 0.1 * (2 * rows.max() - rows[a] - rows[b])  # tie-break: lower platforms (the ground)
    )
    gap = min(MIN_SPAWN_GAP, (cols.max() - cols.min()) // 2)
    cost[cols[b] - cols[a] < max(gap, 1)] = np.inf
    i, j = np.unravel_index(int(np.argmin(cost)), cost.shape)
    if not np.isfinite(cost[i, j]):
        i, j = 0, len(ids) - 1
    return [{"col": int(nav.cols[ids[k]]), "row": int(nav.rows[ids[k]])} for k in (i, j)]


def analyze(grid):
    """grid: [rows, cols] tile codes 0-3 (4 accepted). Returns tiles, spawns, fixes, navGraph and
    timings as in stage.schema.json."""
    t0 = time.perf_counter()
    tiles = np.asarray(grid)
    if tiles.shape != (ROWS, COLS):
        raise ValueError(f"expected a {ROWS}x{COLS} grid, got {tiles.shape}")
    tiles = np.where((tiles >= EMPTY) & (tiles <= FIX), tiles, EMPTY).astype(np.uint8)

    stage = _Stage(tiles)
    for _ in range(MAX_ROUNDS):
        before = len(stage.fixes)
        for check in CHECKS:
            check(stage)
        if len(stage.fixes) == before:
            break
    nav = stage.nav
    spawns = _spawns(nav)
    graph = nav.export()

    ms = (time.perf_counter() - t0) * 1000
    n_edges, n_fixes = len(graph["edges"]), len(stage.fixes)
    log.info("analysis: %d nodes, %d edges, %d fixes in %.1f ms", nav.n, n_edges, n_fixes, ms)
    return {
        "tiles": stage.tiles.tolist(),
        "spawns": spawns,
        "fixes": stage.fixes,
        "navGraph": graph,
        "timings": {"analysis": round(ms, 1)},
    }
