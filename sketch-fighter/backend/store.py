"""Scanned stages: in memory for speed, on disk so a restart keeps the gallery.

Layout: DATA_DIR/<id>/stage.json, photo.jpg (the upload), warped.jpg (the card,
for Gemini). Sample stages are served from shared/stages/samples.json and
samples/card-*.jpg without copying them.
"""

import json
import logging
import os
import re
import threading
from collections import OrderedDict
from pathlib import Path

log = logging.getLogger("sketch")

ID_RE = re.compile(r"^[a-z0-9-]{3,32}$")


class Store:
    def __init__(self, root, limit=200):
        self.root = Path(root)
        self.limit = limit
        self.lock = threading.Lock()
        self.stages = OrderedDict()  # id -> stage, oldest first
        self.files = {}  # id -> {"photo": Path, "warped": Path}
        self.root.mkdir(parents=True, exist_ok=True)
        self._load()

    def _load(self):
        dirs = [d for d in self.root.iterdir() if ID_RE.match(d.name) and (d / "stage.json").is_file()]
        for d in sorted(dirs, key=lambda d: (d / "stage.json").stat().st_mtime)[-self.limit:]:
            try:
                self._remember(json.loads((d / "stage.json").read_text(encoding="utf-8")), d / "photo.jpg", d / "warped.jpg")
            except (OSError, ValueError) as e:
                log.warning("skipping stored stage %s: %s", d.name, e)

    def _remember(self, stage, photo=None, warped=None):
        sid = stage["id"]
        self.stages[sid] = stage
        self.stages.move_to_end(sid)
        self.files[sid] = {"photo": photo, "warped": warped}
        while len(self.stages) > self.limit:
            old, _ = self.stages.popitem(last=False)
            self.files.pop(old, None)

    def add_sample(self, stage, photo_path):
        with self.lock:
            self._remember(stage, photo_path, None)

    def put(self, stage, photo, warped):
        """Save a new scan: stage JSON plus the uploaded photo and warped card (JPEG bytes)."""
        sid = stage["id"]
        d = self.root / sid
        d.mkdir(parents=True, exist_ok=True)
        (d / "photo.jpg").write_bytes(photo)
        (d / "warped.jpg").write_bytes(warped)
        _write_json(d / "stage.json", stage)
        with self.lock:
            self._remember(stage, d / "photo.jpg", d / "warped.jpg")

    def get(self, sid):
        if not ID_RE.match(sid or ""):
            return None
        with self.lock:
            return self.stages.get(sid)

    def recent(self, n=20, scans_first=True):
        with self.lock:
            newest = list(reversed(self.stages.values()))
        if scans_first:
            newest.sort(key=lambda s: s.get("source") == "sample")  # stable: scans, then samples
        return newest[:n]

    def file(self, sid, kind):
        if not ID_RE.match(sid or ""):
            return None
        with self.lock:
            path = self.files.get(sid, {}).get(kind)
        return path if path and Path(path).is_file() else None

    def set_extras(self, sid, extras):
        with self.lock:
            stage = self.stages.get(sid)
            if stage is None:
                return None
            stage["extras"] = extras
            d = self.root / sid
        if (d / "stage.json").is_file():
            _write_json(d / "stage.json", stage)
        return stage


def _write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)
