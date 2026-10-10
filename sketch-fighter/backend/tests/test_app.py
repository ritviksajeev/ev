import json

import pytest

import config
from app import app


@pytest.fixture
def client():
    app.testing = True
    return app.test_client()


def test_fnv1a_matches_reference_vectors():
    # Same vectors as frontend/src/config.js; keeps the two hash functions in step.
    assert config.fnv1a32("") == "811c9dc5"
    assert config.fnv1a32("a") == "e40c292c"
    assert config.fnv1a32("foobar") == "bf9cf968"


def test_health_reports_config_hash(client):
    body = client.get("/api/health").get_json()
    assert body["ok"] is True
    raw = (config.SHARED_DIR / "game.json").read_text(encoding="utf-8").replace("\r", "")
    assert body["configHash"] == config.fnv1a32(raw)


def test_game_config_matches_spec():
    g = config.GAME
    p = g["physics"]
    assert g["cols"] * g["tileSize"] == 960 and g["rows"] * g["tileSize"] == 576
    apex_px = p["jumpVelocity"] ** 2 / (2 * p["gravity"])
    assert 105 < apex_px < 112  # about 4.5 x 24 px
    assert p["stepUpPx"] <= g["tileSize"]  # climbing is one tile at most
    # Fast knockback must not move more than one tile per physics step (no tunnelling).
    assert p["maxLaunchSpeed"] / p["fps"] < g["tileSize"]
    assert p["maxFallSpeed"] / p["fps"] < g["tileSize"]


def test_vision_config_loads():
    v = config.load_vision()
    assert set(v["colors"]) == {"solid", "pass", "hazard"}


def test_stage_schema_is_valid_json():
    schema = json.loads((config.SHARED_DIR / "stage.schema.json").read_text(encoding="utf-8"))
    assert schema["properties"]["tiles"]["items"]["items"]["enum"] == list(config.GAME["tileCodes"].values())


def test_index_responds(client):
    assert client.get("/").status_code == 200
