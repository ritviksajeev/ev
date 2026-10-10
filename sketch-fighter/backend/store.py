"""Scanned stages: in memory for speed, on disk so a restart keeps the gallery.

Layout: DATA_DIR/<id>/stage.json, photo.jpg (the upload), warped.jpg (the card,
for Gemini). Sample stages are served from shared/stages/samples.json and
samples/card-*.jpg without copying them; they are kept apart from scans, so the
gallery cap (which counts scans only) never evicts them.
"""

import json
import logging
import os
import re
import shutil
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

log = logging.getLogger("sketch")

ID_RE = re.compile(r"^[a-z0-9-]{3,32}$")


def _valid_id(sid):
    return isinstance(sid, str) and ID_RE.fullmatch(sid) is not None


class Store:
    def __init__(self, root, limit=200):
        self.root = Path(root)
        self.limit = limit
        self.lock = threading.Lock()
        self.stages = OrderedDict()  # scanned stages: id -> stage, oldest first
        self.samples = OrderedDict()  # sample stages: id -> stage, never evicted
        self.files = {}  # id -> {"photo": Path, "warped": Path}
        self.root.mkdir(parents=True, exist_ok=True)
        self._load()

    def _load(self):
        dirs = [d for d in self.root.iterdir() if _valid_id(d.name) and (d / "stage.json").is_file()]
        for d in sorted(dirs, key=lambda d: (d / "stage.json").stat().st_mtime)[-self.limit:]:
            try:
                stage = json.loads((d / "stage.json").read_text(encoding="utf-8"))
                if not isinstance(stage, dict) or stage.get("id") != d.name:
                    raise ValueError("not a stage for this folder")
                self._remember(stage, d / "photo.jpg", d / "warped.jpg")
            except (OSError, ValueError, KeyError, TypeError) as e:
                log.warning("skipping stored stage %s: %s", d.name, e)

    def _remember(self, stage, photo=None, warped=None):
        """Returns the ids evicted to keep the cap (their folders can then be deleted)."""
        sid = stage["id"]
        self.stages[sid] = stage
        self.stages.move_to_end(sid)
        self.files[sid] = {"photo": photo, "warped": warped}
        evicted = []
        while len(self.stages) > self.limit:
            old, _ = self.stages.popitem(last=False)
            self.files.pop(old, None)
            evicted.append(old)
        return evicted

    def add_sample(self, stage, photo_path):
        with self.lock:
            self.samples[stage["id"]] = stage
            self.files[stage["id"]] = {"photo": photo_path, "warped": None}

    def put(self, stage, photo, warped):
        """Save a new scan: stage JSON plus the uploaded photo and warped card (JPEG bytes)."""
        sid = stage["id"]
        d = self.root / sid
        d.mkdir(parents=True, exist_ok=True)
        (d / "photo.jpg").write_bytes(photo)
        (d / "warped.jpg").write_bytes(warped)
        _write_json(d / "stage.json", stage)
        with self.lock:
            evicted = self._remember(stage, d / "photo.jpg", d / "warped.jpg")
        for old in evicted:
            # The disk copy goes too, or DATA_DIR grows forever (on Cloud Run the disk is memory).
            if _valid_id(old):
                shutil.rmtree(self.root / old, ignore_errors=True)

    def get(self, sid):
        if not _valid_id(sid):
            return None
        with self.lock:
            return self.stages.get(sid) or self.samples.get(sid)

    def recent(self, n=20):
        """Newest scans first, then the samples."""
        with self.lock:
            return (list(reversed(self.stages.values())) + list(reversed(self.samples.values())))[:n]

    def file(self, sid, kind):
        if not _valid_id(sid):
            return None
        with self.lock:
            path = self.files.get(sid, {}).get(kind)
        return path if path and Path(path).is_file() else None

    def set_extras(self, sid, extras):
        with self.lock:
            stage = self.stages.get(sid) or self.samples.get(sid)
            if stage is None:
                return None
            stage["extras"] = extras
            scanned = sid in self.stages
            d = self.root / sid
            if scanned and (d / "stage.json").is_file():
                # Under the lock: two enrich calls for one stage must not interleave their writes.
                _write_json(d / "stage.json", stage)
        return stage


def _write_json(path, data):
    """Atomic write through a uniquely named temp file (concurrent writers never share one)."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(data, separators=(",", ":")))
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
