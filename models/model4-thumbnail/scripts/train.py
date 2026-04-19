#!/usr/bin/env python3
"""
Train / calibrate Model 4 stats from Kaggle YouTube thumbnail dataset layout:
  DATA_ROOT/
    metadata.csv   (columns: id + category + title — id column name flexible)
    images...      (*.jpg / *.png under DATA_ROOT)

Or --init-default to write a placeholder artifact for scoring without data.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
ART_DIR = ROOT / "artifacts"
ART_DIR.mkdir(parents=True, exist_ok=True)
ART_PATH = ART_DIR / "stats.json"

sys.path.insert(0, str(SCRIPT_DIR))
from features import (  # noqa: E402
    FEATURE_NAMES,
    extract_feature_vector,
)


def _find_image(root: Path, vid: str) -> Path | None:
    vid = str(vid).strip()
    for pat in (f"{vid}.jpg", f"{vid}.jpeg", f"{vid}.png", f"{vid}.webp"):
        for p in root.rglob(pat):
            if p.is_file():
                return p
    return None


def _read_metadata(root: Path) -> list[dict[str, str]]:
    for name in ("metadata.csv", "Metadata.csv", "meta.csv"):
        p = root / name
        if p.is_file():
            with p.open(newline="", encoding="utf-8", errors="replace") as f:
                return list(csv.DictReader(f))
    raise FileNotFoundError(f"No metadata.csv under {root}")


def _id_key(row: dict[str, str]) -> str | None:
    for k in row:
        kl = k.lower().strip()
        if kl in ("id", "video_id", "videoid", "video id", "thumbnail_id"):
            v = row.get(k) or ""
            if str(v).strip():
                return str(v).strip()
    return None


def write_default_artifact() -> None:
    """Hand-tuned priors so scoring works before Kaggle calibration."""
    n = len(FEATURE_NAMES)
    _m = {
        "yolo_text_area_ratio": 0.16,
        "yolo_text_box_count_norm": 0.38,
        "yolo_text_center_y_mean": 0.62,
        "yolo_text_bottom_zone_frac": 0.48,
        "text_band_bottom_ratio": 0.12,
        "text_horizontal_edge_ratio": 0.09,
        "bottom_third_edge_density": 0.13,
        "saturation_mean": 0.38,
        "value_std": 0.19,
        "warm_cool_ratio": 1.25,
        "symmetry_lr_diff": 0.18,
        "yolo_person_count": 0.35,
        "yolo_max_box_area_ratio": 0.12,
        "yolo_class_diversity": 2.5,
    }
    _s = {
        "yolo_text_area_ratio": 0.12,
        "yolo_text_box_count_norm": 0.28,
        "yolo_text_center_y_mean": 0.18,
        "yolo_text_bottom_zone_frac": 0.22,
        "text_band_bottom_ratio": 0.14,
        "text_horizontal_edge_ratio": 0.1,
        "bottom_third_edge_density": 0.14,
        "saturation_mean": 0.28,
        "value_std": 0.16,
        "warm_cool_ratio": 0.7,
        "symmetry_lr_diff": 0.14,
        "yolo_person_count": 1.2,
        "yolo_max_box_area_ratio": 0.22,
        "yolo_class_diversity": 1.8,
    }
    mean = [_m.get(name, 0.92) for name in FEATURE_NAMES]
    std = [_s.get(name, 0.45) for name in FEATURE_NAMES]
    if len(mean) != n or len(std) != n:
        raise RuntimeError("default mean/std length mismatch")
    tix = FEATURE_NAMES.index("yolo_text_area_ratio")
    payload = {
        "version": 3,
        "feature_names": FEATURE_NAMES,
        "mean": mean,
        "std": std,
        "text_proxy_index": tix,
        "text_proxy_percentiles": {"p25": 0.08, "p50": 0.15, "p75": 0.28},
        "n_samples": 0,
        "trained_on_dataset": False,
        "notes": "Placeholder stats from --init-default. Run with --data-root for real calibration.",
    }
    ART_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {ART_PATH}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--data-root",
        type=str,
        default="",
        help="Folder containing metadata.csv and image files",
    )
    ap.add_argument(
        "--max-samples",
        type=int,
        default=800,
        help="Max images to scan (random subset if more)",
    )
    ap.add_argument(
        "--init-default",
        action="store_true",
        help="Write placeholder stats.json (no training data)",
    )
    args = ap.parse_args()

    if args.init_default:
        write_default_artifact()
        return

    root = Path(args.data_root).expanduser().resolve()
    if not root.is_dir():
        print("Provide --data-root to a Kaggle extract or use --init-default", file=sys.stderr)
        sys.exit(1)

    rows = _read_metadata(root)
    pairs: list[tuple[str, Path]] = []
    for row in rows:
        vid = _id_key(row)
        if not vid:
            continue
        p = _find_image(root, vid)
        if p:
            pairs.append((str(p), p))

    if not pairs:
        print("No images matched metadata ids. Check filenames vs id column.", file=sys.stderr)
        sys.exit(1)

    if len(pairs) > args.max_samples:
        random.shuffle(pairs)
        pairs = pairs[: args.max_samples]

    feats: list[list[float]] = []
    for i, (s, _) in enumerate(pairs):
        try:
            feats.append(extract_feature_vector(s))
        except Exception as e:
            print(f"skip {s}: {e}", file=sys.stderr)
        if (i + 1) % 50 == 0:
            print(f"... {i + 1}/{len(pairs)}")

    if len(feats) < 10:
        print("Too few usable images.", file=sys.stderr)
        sys.exit(1)

    arr = np.array(feats, dtype=np.float64)
    mean = arr.mean(axis=0).tolist()
    std = np.maximum(arr.std(axis=0), 1e-4).tolist()
    tix = FEATURE_NAMES.index("yolo_text_area_ratio")
    col = arr[:, tix]
    text_proxy_percentiles = {
        "p25": float(np.percentile(col, 25)),
        "p50": float(np.percentile(col, 50)),
        "p75": float(np.percentile(col, 75)),
    }
    payload = {
        "version": 3,
        "feature_names": FEATURE_NAMES,
        "mean": mean,
        "std": std,
        "text_proxy_index": tix,
        "text_proxy_percentiles": text_proxy_percentiles,
        "n_samples": len(feats),
        "trained_on_dataset": True,
        "notes": f"Calibrated from {len(feats)} thumbnails under {root}",
    }
    ART_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {ART_PATH} ({len(feats)} samples)")


if __name__ == "__main__":
    main()
