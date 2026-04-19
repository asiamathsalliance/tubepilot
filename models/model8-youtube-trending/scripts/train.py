#!/usr/bin/env python3
"""
Model 8 — predict log1p(view_count) from publish/time/title/category/tags/trending date.
Trains HistGradientBoostingRegressor; saves joblib model + metrics JSON.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from _io_util import parse_dt, read_trending_csv, require_any, tag_count


def build_features(df: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
    vc_col = require_any(df, "view_count", "views")
    title_col = require_any(df, "title")
    cat_col = require_any(df, "category_id", "category")
    tags_col = "tags" if "tags" in df.columns else None

    y = np.log1p(pd.to_numeric(df[vc_col], errors="coerce").fillna(0).clip(lower=0))

    titles = df[title_col].astype(str)
    char_len = titles.str.len().clip(0, 500)
    word_c = titles.str.split().str.len().fillna(0).clip(0, 80)
    cat = pd.to_numeric(df[cat_col], errors="coerce").fillna(-1).astype(int)

    tc = (
        df[tags_col].map(tag_count)
        if tags_col
        else pd.Series(0, index=df.index)
    )

    pub_col = None
    for cand in ("publish_time", "publishedat", "publish_date"):
        if cand in df.columns:
            pub_col = cand
            break
    trend_col = None
    for cand in ("trending_date", "trendingdate"):
        if cand in df.columns:
            trend_col = cand
            break

    if pub_col:
        pt = parse_dt(df[pub_col])
        hour = pt.dt.hour.fillna(12)
        dow = pt.dt.dayofweek.fillna(3)
    else:
        hour = pd.Series(12, index=df.index)
        dow = pd.Series(3, index=df.index)

    if pub_col and trend_col:
        pt = parse_dt(df[pub_col])
        td = parse_dt(df[trend_col])
        delta_days = (td - pt).dt.total_seconds() / 86400.0
        delta_days = delta_days.fillna(delta_days.median()).clip(-1, 3650)
    else:
        delta_days = pd.Series(0.0, index=df.index)

    X = pd.DataFrame(
        {
            "title_char_len": char_len,
            "title_word_count": word_c,
            "tag_count": tc,
            "publish_hour": hour.astype(float),
            "publish_dow": dow.astype(float),
            "days_publish_to_trending": delta_days.astype(float),
            "category_id": cat,
        }
    )
    return X, y


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Default: data/raw/US_youtube_trending_data.csv",
    )
    ap.add_argument(
        "--fixture",
        type=Path,
        default=None,
        help="Small CSV for CI (overrides --csv)",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=Path("models/model8-youtube-trending/artifacts"),
    )
    args = ap.parse_args()

    if args.fixture and args.fixture.is_file():
        csv_path = args.fixture
    else:
        csv_path = args.csv or Path("data/raw/US_youtube_trending_data.csv")
    if not csv_path.is_file():
        raise SystemExit(
            f"CSV not found: {csv_path}\n"
            "Use --fixture models/model8-youtube-trending/tests/fixtures/minimal_us_trending.csv "
            "or download Kaggle data into data/raw/"
        )

    df = read_trending_csv(csv_path)
    if len(df) < 10:
        pass

    X, y = build_features(df)
    feature_names = list(X.columns)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    # One-hot category_id as high-cardinality categorical
    cat_idx = [feature_names.index("category_id")]
    num_idx = [i for i in range(len(feature_names)) if i not in cat_idx]

    pre = ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore", max_categories=40), cat_idx),
            ("num", StandardScaler(), num_idx),
        ]
    )

    model = Pipeline(
        [
            ("prep", pre),
            (
                "reg",
                HistGradientBoostingRegressor(
                    max_depth=8,
                    max_iter=200,
                    learning_rate=0.08,
                    random_state=42,
                ),
            ),
        ]
    )

    model.fit(X_train, y_train)
    pred = model.predict(X_test)
    mae_log = mean_absolute_error(y_test, pred)
    r2 = r2_score(y_test, pred)
    mae_views = mean_absolute_error(np.expm1(y_test), np.expm1(pred))
    r2_out = float(r2) if not (math.isnan(r2) or math.isinf(r2)) else None

    args.out_dir.mkdir(parents=True, exist_ok=True)
    joblib_path = args.out_dir / "model8.joblib"
    json_path = args.out_dir / "model8.json"

    joblib.dump(model, joblib_path)

    payload = {
        "version": 1,
        "target": "log1p(view_count)",
        "features": feature_names,
        "metrics": {
            "valMaeLog": float(mae_log),
            "valR2Log": r2_out,
            "valMaeViewsApprox": float(mae_views),
        },
        "trainingNotes": {
            "source": str(csv_path),
            "rows": int(len(df)),
        },
        "modelPath": str(joblib_path.name),
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Wrote {json_path} and {joblib_path}")


if __name__ == "__main__":
    main()
