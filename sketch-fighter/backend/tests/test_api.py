import io
import json
import threading
from pathlib import Path

import pytest

import app as app_module
from app import app

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = sorted((ROOT / "samples").glob("card-*.jpg"))
SCHEMA = json.loads((ROOT / "shared" / "stage.schema.json").read_text())


@pytest.fixture
def client():
    app.testing = True
    return app.test_client()


def scan(client, data, query="", **form):
    return client.post(f"/api/scan{query}", data={"image": (io.BytesIO(data), "card.jpg"), **form},
                       content_type="multipart/form-data")


def check_stage(stage):
    for key in SCHEMA["required"]:
        assert key in stage, key
    assert stage["version"] == 1
    assert len(stage["tiles"]) == stage["rows"] and all(len(r) == stage["cols"] for r in stage["tiles"])
    assert all(c in (0, 1, 2, 3, 4) for r in stage["tiles"] for c in r)
    assert len(stage["spawns"]) == 2
    nodes = stage["navGraph"]["nodes"]
    for a, b, kind, move in stage["navGraph"]["edges"]:
        assert 0 <= a < len(nodes) and 0 <= b < len(nodes)
        assert (move is None) == (kind == "walk")


@pytest.mark.parametrize("path", SAMPLES, ids=lambda p: p.stem)
def test_scan_sample(client, path):
    res = scan(client, path.read_bytes())
    assert res.status_code == 200
    stage = res.get_json()
    check_stage(stage)
    assert stage["source"] == "scan" and stage["extras"] is None and stage["cardDetected"] is True
    assert set(stage["timings"]) >= {"decode", "warp", "masks", "grid", "analysis", "total"}
    assert stage["timings"]["total"] < 1500
    assert stage["photoUrl"] == f"/api/stages/{stage['id']}/photo"

    assert client.get(f"/api/stages/{stage['id']}").get_json()["id"] == stage["id"]
    photo = client.get(stage["photoUrl"])
    assert photo.status_code == 200 and photo.mimetype == "image/jpeg"
    assert any(s["id"] == stage["id"] for s in client.get("/api/stages").get_json()["stages"])


def test_bad_uploads(client):
    assert client.post("/api/scan").status_code == 400
    assert scan(client, b"").status_code == 400
    res = scan(client, b"not a photo at all")
    assert res.status_code == 400 and "photo" in res.get_json()["error"]
    big = client.post("/api/scan", data={"image": (io.BytesIO(b"x" * (11 * 1024 * 1024)), "big.jpg")},
                      content_type="multipart/form-data")
    assert big.status_code == 413 and "error" in big.get_json()


@pytest.mark.parametrize("sid", ["nope1234", "..", "../../etc", "a" * 40, "UPPER"])
def test_unknown_or_invalid_ids(client, sid):
    # Ids with ".." are resolved away by the URL normaliser before routing
    # (so a POST can land on a GET-only route: 405). Never a 200 or a 500.
    for url in (f"/api/stages/{sid}", f"/api/stages/{sid}/photo"):
        assert client.get(url).status_code == 404
    assert client.post(f"/api/stages/{sid}/enrich").status_code in (404, 405)


def test_enrich_without_gemini_uses_fallback(client):
    stage = scan(client, SAMPLES[0].read_bytes()).get_json()
    extras = client.post(f"/api/stages/{stage['id']}/enrich").get_json()["extras"]
    assert extras["source"] == "fallback" and extras["stageName"]
    # Stored: asking again returns the same extras.
    assert client.post(f"/api/stages/{stage['id']}/enrich").get_json()["extras"] == extras
    assert client.get(f"/api/stages/{stage['id']}").get_json()["extras"] == extras


def test_debug_scan_returns_images_and_is_not_stored(client):
    before = {s["id"] for s in client.get("/api/stages").get_json()["stages"]}
    res = scan(client, SAMPLES[0].read_bytes(), query="?debug=1", vision=json.dumps({"colors": {"solid": {"coverage": 0.5}}}))
    stage = res.get_json()
    assert res.status_code == 200 and stage["photoUrl"] is None
    assert stage["debug"]["warped"].startswith("data:image/") and set(stage["debug"]["masks"]) == {"solid", "pass", "hazard"}
    assert {s["id"] for s in client.get("/api/stages").get_json()["stages"]} == before
    assert scan(client, SAMPLES[0].read_bytes(), query="?debug=1", vision="{nope").status_code == 400
    assert scan(client, SAMPLES[0].read_bytes(), query="?debug=1", vision="[1, 2]").status_code == 400


def test_cors(client):
    ok = client.get("/api/health", headers={"Origin": "https://evzero.org"})
    assert ok.headers["Access-Control-Allow-Origin"] == "https://evzero.org"
    other = client.get("/api/health", headers={"Origin": "https://example.com"})
    assert "Access-Control-Allow-Origin" not in other.headers
    pre = client.options("/api/scan", headers={"Origin": "https://evzero.org", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 200 and pre.headers["Access-Control-Allow-Origin"] == "https://evzero.org"


def test_debug_vision_save_rules(client, monkeypatch, tmp_path):
    current = client.get("/api/debug/vision").get_json()
    monkeypatch.setattr(app_module, "SHARED_DIR", tmp_path)
    (tmp_path / "vision.json").write_text(json.dumps(current))

    # No token configured: localhost only.
    monkeypatch.delenv("DEBUG_TOKEN", raising=False)
    remote = {"REMOTE_ADDR": "10.0.0.5"}
    assert client.post("/api/debug/vision", json=current, environ_base=remote).status_code == 403
    spoofed = {"X-Forwarded-For": "127.0.0.1"}
    assert client.post("/api/debug/vision", json=current, environ_base=remote, headers=spoofed).status_code == 403
    assert client.post("/api/debug/vision", json=current, environ_base={"REMOTE_ADDR": "127.0.0.1"}).status_code == 200

    # Token configured: header required, X-Forwarded-For is irrelevant.
    monkeypatch.setenv("DEBUG_TOKEN", "s3cret")
    assert client.post("/api/debug/vision", json=current, headers=spoofed).status_code == 403
    assert client.post("/api/debug/vision", json=current, headers={"X-Debug-Token": "s3cret"}).status_code == 200

    broken = {**current, "colors": "nope"}
    assert client.post("/api/debug/vision", json=broken, headers={"X-Debug-Token": "s3cret"}).status_code == 400
    assert json.loads((tmp_path / "vision.json").read_text()) == current


def test_samples_seeded(client):
    ids = {s["id"] for s in client.get("/api/stages").get_json()["stages"]}
    seeded = json.loads((ROOT / "shared" / "stages" / "samples.json").read_text())
    if seeded:
        sid = seeded[0]["id"]
        assert client.get(f"/api/stages/{sid}").status_code == 200
        assert client.get(f"/api/stages/{sid}/photo").mimetype == "image/jpeg"
        assert ids  # gallery is never empty


def test_concurrent_scans(client):
    data = SAMPLES[1].read_bytes()
    results = []

    def worker():
        with app.test_client() as c:
            results.append(scan(c, data).status_code)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [200] * 6


def test_store_survives_restart(client, tmp_path):
    from store import Store

    s = Store(tmp_path)
    stage = scan(client, SAMPLES[2].read_bytes()).get_json()
    s.put(stage, b"photo", b"warped")
    again = Store(tmp_path)
    assert again.get(stage["id"])["id"] == stage["id"]
    assert again.file(stage["id"], "photo").read_bytes() == b"photo"
