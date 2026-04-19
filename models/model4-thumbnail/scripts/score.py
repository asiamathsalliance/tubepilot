#!/usr/bin/env python3
"""Score one thumbnail JSON to stdout."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
ART_PATH = ROOT / "artifacts" / "stats.json"

sys.path.insert(0, str(SCRIPT_DIR))
from features import extract_feature_vector, FEATURE_NAMES  # noqa: E402


def _load_stats():
    data = json.loads(ART_PATH.read_text(encoding="utf-8"))
    return data


def _typicality_score(vec: list[float], mean: list[float], std: list[float]) -> float:
    z2 = 0.0
    for x, m, s in zip(vec, mean, std, strict=True):
        z = (x - m) / s
        z2 += z * z
    z2 /= len(vec)
    return float(100.0 * math.exp(-0.5 * z2))


def _text_alignment_score(
    text_proxy: float, pct: dict[str, float]
) -> float:
    p25 = pct.get("p25", 0.06)
    p50 = pct.get("p50", 0.11)
    p75 = pct.get("p75", 0.17)
    # Reward being near the middle of the dataset text-band distribution
    if text_proxy < p25:
        d = (p25 - text_proxy) / (p25 + 1e-6)
    elif text_proxy > p75:
        d = (text_proxy - p75) / (1.0 - p75 + 1e-6)
    else:
        d = abs(text_proxy - p50) / (p75 - p25 + 1e-6)
    return float(max(0.0, 100.0 * (1.0 - 0.65 * min(1.5, d))))


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: score.py <image_path>", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    if not ART_PATH.is_file():
        print(json.dumps({"error": f"missing {ART_PATH}"}))
        sys.exit(2)

    stats = _load_stats()
    mean = stats["mean"]
    std = stats["std"]
    tix = int(stats.get("text_proxy_index", 0))
    pct = stats.get("text_proxy_percentiles") or {"p25": 0.06, "p50": 0.11, "p75": 0.17}

    vec = extract_feature_vector(path)

    def ix(name: str) -> int:
        return FEATURE_NAMES.index(name)

    typ = _typicality_score(vec, mean, std)
    text_proxy = vec[tix] if 0 <= tix < len(vec) else vec[0]
    text_align = _text_alignment_score(text_proxy, pct)

    combined = 0.52 * typ + 0.48 * text_align

    # Penalize thumbnails with no / tiny detected text (YOLO-World text area).
    yolo_area = vec[ix("yolo_text_area_ratio")]
    p25 = float(pct.get("p25", 0.06))
    text_visibility_penalty = 0.0
    if yolo_area < 0.012:
        text_visibility_penalty = 42.0
    elif yolo_area < 0.028:
        text_visibility_penalty = 28.0
    elif yolo_area < 0.045:
        text_visibility_penalty = 16.0
    elif yolo_area < p25:
        text_visibility_penalty = 9.0

    combined = max(0.0, min(100.0, combined - text_visibility_penalty))

    breakdown = {
        "typicalityVsDataset": round(typ, 2),
        "textBandVsDataset": round(text_align, 2),
        "textBandProxy": round(text_proxy, 4),
        "yoloWorldTextAreaRatio": round(vec[ix("yolo_text_area_ratio")], 4),
        "yoloWorldTextBoxCountNorm": round(vec[ix("yolo_text_box_count_norm")], 4),
        "yoloWorldTextCenterY": round(vec[ix("yolo_text_center_y_mean")], 4),
        "yoloWorldTextBottomZoneFrac": round(
            vec[ix("yolo_text_bottom_zone_frac")], 4
        ),
        "yoloPersonsApprox": round(vec[ix("yolo_person_count")], 2),
        "yoloMaxBoxAreaRatio": round(vec[ix("yolo_max_box_area_ratio")], 4),
        "colorSaturationMean": round(vec[ix("saturation_mean")], 4),
        "edgeDensityBottomThird": round(
            vec[ix("bottom_third_edge_density")], 4
        ),
        "heuristicTextBandBottom": round(vec[ix("text_band_bottom_ratio")], 4),
        "textVisibilityPenalty": round(text_visibility_penalty, 2),
    }

    out = {
        "score": round(combined, 2),
        "model": "model4-thumbnail",
        "trainedOnDataset": bool(
            stats.get("trained_on_dataset", stats.get("trainedOnDataset", False))
        ),
        "nCalibrationSamples": int(stats.get("n_samples", stats.get("nSamples", 0))),
        "breakdown": breakdown,
        "featureNames": FEATURE_NAMES,
        "features": [round(x, 5) for x in vec],
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
