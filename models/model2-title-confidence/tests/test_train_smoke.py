"""Smoke test: train from fixture and assert artifact shape."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = (
    ROOT
    / "models"
    / "model2-title-confidence"
    / "tests"
    / "fixtures"
    / "sample_trending.csv"
)
OUT = (
    ROOT
    / "models"
    / "model2-title-confidence"
    / "tests"
    / "_smoke_artifact.json"
)


def main() -> None:
    script = ROOT / "models" / "model2-title-confidence" / "scripts" / "train.py"
    subprocess.run(
        [
            sys.executable,
            str(script),
            "--fixture",
            str(FIXTURE),
            "--out",
            str(OUT),
        ],
        check=True,
        cwd=ROOT,
    )
    data = json.loads(OUT.read_text(encoding="utf-8"))
    assert data.get("version") == 5, data
    assert "categories" in data
    assert len(data["categories"]) >= 1
    found = False
    for cat in data["categories"].values():
        glob = cat.get("regions", {}).get("GLOBAL")
        if glob and isinstance(glob.get("sampleTitles"), list):
            assert len(glob["sampleTitles"]) >= 1
            assert isinstance(glob.get("llmTrendContext"), str)
            assert len(glob["llmTrendContext"]) >= 1
            found = True
            break
    assert found, "expected sampleTitles on at least one GLOBAL bucket"
    print("test_train_smoke: ok")


if __name__ == "__main__":
    main()
