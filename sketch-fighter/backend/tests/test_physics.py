"""physics.py must reproduce the JS reference trajectories in shared/fixtures/physics.json to 1e-9."""

import json

import pytest

import physics
from config import GAME, SHARED_DIR

FIXTURE = json.loads((SHARED_DIR / "fixtures" / "physics.json").read_text(encoding="utf-8"))
TOL = 1e-9


@pytest.mark.parametrize("scenario", FIXTURE["scenarios"], ids=lambda s: s["name"])
def test_matches_js_reference(scenario):
    grid = physics.as_grid(FIXTURE["grid"])
    dt = 1 / GAME["physics"]["fps"]
    b = physics.create_body(GAME, *scenario["start"])
    kick = scenario.get("kick")
    if kick:
        b.update(vx=kick["vx"], vy=kick["vy"], hitstun=kick["hitstun"], onGround=False)

    assert len(scenario["inputs"]) == len(scenario["frames"]) > 0
    for i, (inp, frame) in enumerate(zip(scenario["inputs"], scenario["frames"])):
        controls = {"dir": inp[0], "down": bool(inp[1]), "jump": bool(inp[2])}
        physics.step_body(b, controls, grid, GAME, GAME["physics"], dt)
        x, y, vx, vy, on_ground, air_jumps, hazard = frame
        got = (b["x"], b["y"], b["vx"], b["vy"])
        assert got == pytest.approx((x, y, vx, vy), abs=TOL, rel=0), f"step {i}"
        assert int(b["onGround"]) == on_ground, f"step {i}"
        assert b["airJumps"] == air_jumps, f"step {i}"
        assert b["hazard"] == hazard, f"step {i}"


def test_fixture_covers_every_collision_case():
    names = {s["name"] for s in FIXTURE["scenarios"]}
    assert {"bonk_ceiling", "drop_through_pass", "touch_hazard", "coyote_jump", "knockback"} <= names
    assert {"walk_up_and_down_stairs", "walk_down_stairs_left", "walk_onto_pass_step"} <= names
    hazards = [f[6] for s in FIXTURE["scenarios"] for f in s["frames"] if f[6] is not None]
    assert hazards, "fixture never touches a hazard"


def test_numpy_grid_adapter():
    import numpy as np

    tiles = np.zeros((GAME["rows"], GAME["cols"]), dtype=np.uint8)
    tiles[40, :] = physics.SOLID
    grid = physics.as_grid(tiles)
    b = physics.create_body(GAME, 20, 39)
    dt = 1 / GAME["physics"]["fps"]
    for _ in range(GAME["physics"]["fps"] // 2):
        physics.step_body(b, {"dir": 1, "down": False, "jump": False}, grid, GAME, GAME["physics"], dt)
    assert b["onGround"] and b["y"] == 40 * GAME["tileSize"] - b["h"] / 2


def test_on_pass_only():
    T = GAME["tileSize"]
    grid = physics.as_grid(FIXTURE["grid"])
    assert physics.on_pass_only(physics.create_body(GAME, 26, 31), grid, T)
    assert not physics.on_pass_only(physics.create_body(GAME, 16, 39), grid, T)
