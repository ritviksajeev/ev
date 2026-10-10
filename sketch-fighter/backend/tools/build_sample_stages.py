"""Builds shared/stages/samples.json from samples/card-*.jpg with the real pipeline.

The static web build bundles that file, so "Play a sample stage" and the CPU's
nav graph work with no server. Run from backend/:  python -m tools.build_sample_stages
"""

import json

import enrich
from config import APP_DIR, SHARED_DIR
from pipeline import build_stage

MIN_NODES = 20  # card-04 (one short line) is a test of near-empty cards, not a stage to play


def main():
    stages = []
    for path in sorted((APP_DIR / "samples").glob("card-*.jpg")):
        sid = f"sample-{path.stem.split('-')[-1]}"
        stage, _ = build_stage(path.read_bytes(), stage_id=sid, source="sample")
        if len(stage["navGraph"]["nodes"]) < MIN_NODES:
            print(f"{sid}: skipped, too small to be fun as a sample")
            continue
        # Keep the file stable between runs: no timestamps or timings.
        del stage["createdAt"]
        stage.update(photoUrl=None, timings={}, extras=enrich.fallback(sid))
        stages.append(stage)
        print(f"{sid}: {len(stage['navGraph']['nodes'])} nodes, {len(stage['fixes'])} fixes")
    out = SHARED_DIR / "stages" / "samples.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(stages, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(stages)} stages)")


if __name__ == "__main__":
    main()
