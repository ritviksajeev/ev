"""Adversarial API tests: hostile uploads, hostile /debug settings, races, restarts, .env.

Each test here either failed on a real defect when written or locks in an
invariant that a refactor could easily break.
"""

import io
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import cv2
import numpy as np
import pytest

import app as app_module
import config
from app import app
from store import Store

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
CARD = (ROOT / "samples" / "card-01.jpg").read_bytes()
LOCAL = {"REMOTE_ADDR": "127.0.0.1"}


@pytest.fixture
def client():
    app.testing = True
    return app.test_client()


def scan(client, data, query="", **form):
    return client.post(f"/api/scan{query}", data={"image": (io.BytesIO(data), "card.jpg"), **form},
                       content_type="multipart/form-data")


# ---------- /api/scan?debug=1 vision overrides (no auth: anyone can send these) ----------

HOSTILE_OVERRIDES = [
    {"warp": {"width": 1.5}},
    {"warp": {"width": 100000, "height": 100000}},
    {"detect": {"blur": -1}},
    {"normalize": {"flatFieldKernel": 10**9}},
    {"normalize": {"clahe": True, "claheClipLimit": "x"}},
    {"colors": []},
    {"colors": {"solid": {"ranges": [{"hMin": "a", "hMax": 1, "sMin": 0, "sMax": 1, "vMin": 0, "vMax": 1}]}}},
    {"morph": {"openPx": 1e9}},
    {"morph": {"dilatePx": "x"}},
    {"cleanup": None},
]


@pytest.mark.parametrize("override", HOSTILE_OVERRIDES, ids=lambda o: json.dumps(o)[:60])
def test_hostile_debug_overrides_are_a_400_not_a_500(client, override):
    res = scan(client, CARD, query="?debug=1", vision=json.dumps(override))
    assert res.status_code == 400, res.get_json()


def test_debug_override_cannot_kill_the_server_process():
    # claheTileGrid 0 makes OpenCV divide by zero in C: SIGFPE kills the whole
    # gunicorn worker (every in-flight request dies). Run it in a child process.
    code = (
        "import io, json, sys\n"
        "from app import app\n"
        "c = app.test_client()\n"
        f"data = open({str(ROOT / 'samples' / 'card-01.jpg')!r}, 'rb').read()\n"
        "r = c.post('/api/scan?debug=1', data={'image': (io.BytesIO(data), 'c.jpg'),"
        " 'vision': json.dumps({'normalize': {'clahe': True, 'claheTileGrid': 0}})},"
        " content_type='multipart/form-data')\n"
        "print('STATUS', r.status_code)\n"
    )
    env = {**os.environ, "GEMINI_API_KEY": "", "GEMINI_MODEL": ""}
    proc = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, f"process died with {proc.returncode}"
    assert "STATUS 400" in proc.stdout


# ---------- uploads ----------


def test_tiny_png_that_decodes_huge_is_refused(client):
    # 160 KB upload, 12000 x 12000 pixels: decoding takes ~870 MB and ~3 s, so a
    # couple of these OOM the 1 GiB Cloud Run instance. MAX_CONTENT_LENGTH can't
    # catch it; the decoder must check dimensions first.
    bomb = cv2.imencode(".png", np.zeros((12000, 12000), np.uint8))[1].tobytes()
    assert len(bomb) < 1024 * 1024
    assert scan(client, bomb).status_code in (400, 413)


@pytest.mark.parametrize("make", [
    lambda c: c.post("/api/scan", data={"photo": (io.BytesIO(CARD), "c.jpg")}, content_type="multipart/form-data"),
    lambda c: c.post("/api/scan", data=CARD, content_type="image/jpeg"),
    lambda c: c.post("/api/scan", data={"image": "just text"}, content_type="multipart/form-data"),
    lambda c: scan(c, CARD[: len(CARD) // 3]),
    lambda c: scan(c, CARD[:200]),
], ids=["wrong-field", "raw-body", "text-field", "truncated", "header-only"])
def test_bad_uploads_are_400(client, make):
    res = make(client)
    assert res.status_code == 400 and "error" in res.get_json()


# ---------- races ----------


def test_concurrent_enrich_of_one_stage_never_500s(client, monkeypatch):
    # Reveal fires enrich; opening the same stage from the gallery while that is
    # still running fires it again. Both writes share DATA_DIR/<id>/stage.tmp.
    sid = scan(client, CARD).get_json()["id"]
    barrier = threading.Barrier(8, timeout=5)

    def slow_enrich(_jpeg, seed=""):
        try:
            barrier.wait()
        except threading.BrokenBarrierError:
            pass
        return app_module.gemini.fallback(seed)

    monkeypatch.setattr(app_module.gemini, "enrich", slow_enrich)
    codes = []

    def worker():
        with app.test_client() as c:
            codes.append(c.post(f"/api/stages/{sid}/enrich").status_code)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes == [200] * 8
    saved = json.loads((Path(os.environ["DATA_DIR"]) / sid / "stage.json").read_text())
    assert saved["extras"]["source"] == "fallback"


def test_concurrent_vision_saves_never_500(client, monkeypatch, tmp_path):
    current = client.get("/api/debug/vision").get_json()
    monkeypatch.setattr(app_module, "SHARED_DIR", tmp_path)
    monkeypatch.delenv("DEBUG_TOKEN", raising=False)
    (tmp_path / "vision.json").write_text(json.dumps(current))
    codes = []

    def worker():
        with app.test_client() as c:
            for _ in range(5):
                codes.append(c.post("/api/debug/vision", json=current, environ_base=LOCAL).status_code)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes == [200] * 40
    assert json.loads((tmp_path / "vision.json").read_text()) == current


# ---------- POST /api/debug/vision validation ----------


def _save(client, body):
    return client.post("/api/debug/vision", data=body, content_type="application/json", environ_base=LOCAL)


@pytest.fixture
def vision_sandbox(client, monkeypatch, tmp_path):
    current = client.get("/api/debug/vision").get_json()
    monkeypatch.setattr(app_module, "SHARED_DIR", tmp_path)
    monkeypatch.delenv("DEBUG_TOKEN", raising=False)
    (tmp_path / "vision.json").write_text(json.dumps(current))
    return current, tmp_path


def test_save_rejects_nan(client, vision_sandbox):
    # json.dumps writes NaN, which browsers' JSON.parse (the /debug page) rejects.
    current, tmp = vision_sandbox
    body = json.dumps(current).replace('"minContrast": 25', '"minContrast": NaN')
    assert "NaN" in body
    assert _save(client, body).status_code == 400
    assert "NaN" not in (tmp / "vision.json").read_text()


@pytest.mark.parametrize("section,key,value", [
    ("normalize", "claheTileGrid", 0),  # with clahe on: SIGFPE on every later scan
    ("warp", "width", 1000.5),  # every later scan: 500 (cv2 dsize must be int)
    ("detect", "blur", -1),
])
def test_save_rejects_values_that_break_every_scan(client, vision_sandbox, section, key, value):
    current, tmp = vision_sandbox
    bad = json.loads(json.dumps(current))
    bad[section][key] = value
    if key == "claheTileGrid":
        bad["normalize"]["clahe"] = True
    assert _save(client, json.dumps(bad)).status_code == 400
    assert json.loads((tmp / "vision.json").read_text()) == current


@pytest.mark.parametrize("body", ["{nope", "null", "[]", '"x"', ""])
def test_save_malformed_json_is_400(client, vision_sandbox, body):
    current, tmp = vision_sandbox
    assert _save(client, body).status_code == 400
    assert json.loads((tmp / "vision.json").read_text()) == current


@pytest.mark.parametrize("addr", ["10.0.0.5", "127.0.0.2", "::ffff:127.0.0.1"])
def test_save_without_token_is_loopback_only_even_with_forwarded_headers(client, vision_sandbox, addr):
    current, _ = vision_sandbox
    headers = {"X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1", "Forwarded": "for=127.0.0.1"}
    res = client.post("/api/debug/vision", json=current, headers=headers, environ_base={"REMOTE_ADDR": addr})
    assert res.status_code == 403


# ---------- store ----------


def test_store_skips_malformed_stage_files(tmp_path):
    # A stage.json without an id (or not an object) must not stop the server starting.
    for name, text in [("aaa", "{}"), ("bbb", "[1]"), ("ccc", "not json")]:
        (tmp_path / name).mkdir()
        (tmp_path / name / "stage.json").write_text(text)
    good = {"id": "ddd", "source": "scan"}
    (tmp_path / "ddd").mkdir()
    (tmp_path / "ddd" / "stage.json").write_text(json.dumps(good))
    assert list(Store(tmp_path).stages) == ["ddd"]


def test_samples_are_not_evicted_by_scans(tmp_path):
    # The gallery cap must count scans only: after `limit` scans the samples
    # (and /api/stages/sample-xx/photo) must still be there.
    store = Store(tmp_path, limit=5)
    store.add_sample({"id": "sample-01", "source": "sample"}, ROOT / "samples" / "card-01.jpg")
    for i in range(6):
        store.put({"id": f"scan{i:04d}", "source": "scan"}, b"p", b"w")
    assert store.get("sample-01") is not None
    assert store.file("sample-01", "photo") is not None
    assert sum(1 for s in store.recent(100) if s["source"] == "scan") == 5


def test_store_reload_keeps_newest_and_files(tmp_path):
    first = Store(tmp_path, limit=3)
    for i in range(5):
        first.put({"id": f"scan{i:04d}", "source": "scan"}, b"photo%d" % i, b"w")
        os.utime(tmp_path / f"scan{i:04d}" / "stage.json", (1000 + i, 1000 + i))
    again = Store(tmp_path, limit=3)
    assert [s["id"] for s in again.recent(10)] == ["scan0004", "scan0003", "scan0002"]
    assert again.file("scan0004", "photo").read_bytes() == b"photo4"
    assert again.get("../scan0004") is None and again.file("..", "photo") is None


# ---------- .env ----------


@pytest.fixture
def clean_env(monkeypatch):
    for k in ("SKF_A", "SKF_B", "SKF_C"):
        monkeypatch.delenv(k, raising=False)
    yield
    for k in list(os.environ):
        if "SKF_" in k:
            del os.environ[k]


def _dotenv(tmp_path, raw):
    p = tmp_path / ".env"
    p.write_bytes(raw)
    config._load_dotenv(p)


def test_dotenv_basics(tmp_path, clean_env, monkeypatch):
    monkeypatch.setenv("SKF_C", "from-shell")
    _dotenv(tmp_path, b'# comment\r\nSKF_A="a=b==c"\r\n  SKF_B = plain  \r\nSKF_C=from-file\r\n')
    assert os.environ["SKF_A"] == "a=b==c"
    assert os.environ["SKF_B"] == "plain"
    assert os.environ["SKF_C"] == "from-shell"  # existing env wins


def test_dotenv_with_utf8_bom(tmp_path, clean_env):
    # Windows editors (older Notepad, "UTF-8 with BOM") put EF BB BF first; the
    # first key then silently becomes "﻿SKF_A" and the Gemini key is lost.
    _dotenv(tmp_path, b"\xef\xbb\xbfSKF_A=key\nSKF_B=model\n")
    assert os.environ.get("SKF_A") == "key"
