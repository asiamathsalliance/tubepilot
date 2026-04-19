#!/usr/bin/env python3
"""
EDA for US_youtube_trending_data.csv (Rishav Kaggle) or compatible CSVs.
Writes JSON summary: distributions, missing rates, feature sanity checks.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from _io_util import parse_dt, read_trending_csv, require_any, tag_count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--csv",
        type=Path,
        default=Path("data/raw/US_youtube_trending_data.csv"),
        help="Path to US_youtube_trending_data.csv",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("models/model8-youtube-trending/artifacts/eda_summary.json"),
    )
    args = ap.parse_args()

    if not args.csv.is_file():
        raise SystemExit(
            f"CSV not found: {args.csv}\n"
            "Download from Kaggle (rsrishav/youtube-trending-video-dataset) "
            "into data/raw/"
        )

    df = read_trending_csv(args.csv)
    n = len(df)

    vc_col = require_any(df, "view_count", "views")
    title_col = require_any(df, "title")
    cat_col = require_any(df, "category_id", "category")
    tags_col = require_any(df, "tags") if "tags" in df.columns else None
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

    views = pd.to_numeric(df[vc_col], errors="coerce").fillna(0)
    summary: dict = {
        "source": str(args.csv),
        "rowCount": int(n),
        "columns": list(df.columns),
        "viewCount": {
            "min": float(views.min()),
            "max": float(views.max()),
            "mean": float(views.mean()),
            "median": float(views.median()),
            "p95": float(views.quantile(0.95)),
        },
        "titleLength": {},
        "categoryId": {},
        "publishTime": {},
        "trendingVsPublish": {},
        "tags": {},
    }

    titles = df[title_col].astype(str)
    summary["titleLength"] = {
        "charMean": float(titles.str.len().mean()),
        "charP95": float(titles.str.len().quantile(0.95)),
        "wordMean": float(titles.str.split().str.len().mean()),
    }

    cats = pd.to_numeric(df[cat_col], errors="coerce")
    summary["categoryId"] = {
        "distinct": int(cats.nunique(dropna=True)),
        "missingRate": float(cats.isna().mean()),
    }

    if tags_col:
        tc = df[tags_col].map(tag_count)
        summary["tags"] = {
            "tagCountMean": float(tc.mean()),
            "tagCountP95": float(tc.quantile(0.95)),
        }

    if pub_col:
        pt = parse_dt(df[pub_col])
        h = pt.dt.hour.dropna()
        summary["publishTime"] = {
            "parseableRate": float(pt.notna().mean()),
            "hourCounts": {str(int(k)): int(v) for k, v in h.value_counts().head(8).items()}
            if len(h)
            else {},
        }
        if trend_col:
            td = parse_dt(df[trend_col])
            delta = (td - pt).dt.total_seconds() / 86400.0
            summary["trendingVsPublish"] = {
                "daysDeltaMean": float(delta.mean())
                if delta.notna().any()
                else None,
                "daysDeltaMedian": float(delta.median())
                if delta.notna().any()
                else None,
                "negativeOrNaShare": float((delta < 0).mean() + delta.isna().mean()),
            }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    def conv(o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        if isinstance(o, dict):
            return {str(k): conv(v) for k, v in o.items()}
        if isinstance(o, list):
            return [conv(x) for x in o]
        return o

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(conv(summary), f, indent=2, ensure_ascii=False)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
