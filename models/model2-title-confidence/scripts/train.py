#!/usr/bin/env python3
"""
Build Model 2 JSON artifact from Kaggle-style CSVs:

- Classic: XXvideos.csv (datasnaek/youtube-new style)
- Rishav: XX_youtube_trending_data.csv (rsrishav/youtube-trending-video-dataset)
- Any CSV in data/raw/ with mappable title / views / category / tags columns

Optional merge with additional trending CSVs (e.g. bsthere/youtube-trending-videos-stats-2026):
drop those files into data/raw/ as long as columns normalize; unknown layouts are skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer

# Final score = weighted blend of four explainable signals (sum = 1)
WEIGHTS = {
    "tagAndCategory": 0.28,
    "trendingLexical": 0.28,
    "titleLength": 0.22,
    "languageStructure": 0.22,
}
MAX_FEATURES = 3000
HIGH_VIEW_QUANTILE = 0.75
ARTIFACT_VERSION = 5


def norm_col_key(name: str) -> str:
    s = str(name).strip().lower()
    s = re.sub(r"[\s\-]+", "_", s)
    return s


def region_from_filename(name: str) -> str:
    base = os.path.basename(name)
    m = re.match(r"^([A-Z]{2})videos\.csv$", base, re.I)
    if m:
        return m.group(1).upper()
    m = re.match(r"^([A-Z]{2})_youtube_trending_data\.csv$", base, re.I)
    if m:
        return m.group(1).upper()
    m = re.match(r"^([A-Z]{2})_trending.*\.csv$", base, re.I)
    if m:
        return m.group(1).upper()
    return "GLOBAL"


def column_map(df: pd.DataFrame) -> dict[str, str]:
    return {norm_col_key(c): c for c in df.columns}


def pick_col(df: pd.DataFrame, cm: dict[str, str], *candidates: str):
    for cand in candidates:
        k = norm_col_key(cand)
        if k in cm:
            return df[cm[k]]
    return None


def normalize_df(df: pd.DataFrame, region: str) -> pd.DataFrame | None:
    cm = column_map(df)
    title = pick_col(df, cm, "title", "video_title", "name", "video name")
    views = pick_col(
        df,
        cm,
        "views",
        "view_count",
        "viewcount",
        "number_of_views",
        "total_views",
        "video_views",
        "views_count",
    )
    if title is None or views is None:
        return None
    tags = pick_col(df, cm, "tags", "tag", "keywords", "video_tags")
    cat = pick_col(df, cm, "category_id", "categoryid", "category")
    vid = pick_col(df, cm, "video_id", "videoid", "id")
    out = pd.DataFrame(
        {
            "title": title.astype(str).fillna(""),
            "tags": tags.astype(str).fillna("") if tags is not None else "",
            "views": pd.to_numeric(views, errors="coerce").fillna(0),
            "category_id": pd.to_numeric(cat, errors="coerce").fillna(-1).astype(int)
            if cat is not None
            else -1,
            "region": region,
        }
    )
    if vid is not None:
        out["video_id"] = vid.astype(str).fillna("")
    return out


def load_all_csvs(data_dir: Path) -> pd.DataFrame | None:
    frames: list[pd.DataFrame] = []
    for p in sorted(data_dir.glob("*.csv")):
        try:
            raw = pd.read_csv(
                p, encoding="utf-8", on_bad_lines="skip", low_memory=False
            )
        except Exception:
            try:
                raw = pd.read_csv(
                    p, encoding="latin1", on_bad_lines="skip", low_memory=False
                )
            except Exception:
                continue
        reg = region_from_filename(str(p))
        n = normalize_df(raw, reg)
        if n is not None and len(n) > 0:
            frames.append(n)
    if not frames:
        return None
    combined = pd.concat(frames, ignore_index=True)
    if "video_id" in combined.columns and combined["video_id"].str.len().sum() > 0:
        combined = combined.sort_values("views", ascending=False)
        combined = combined.drop_duplicates(
            subset=["video_id", "region"], keep="first"
        )
    return combined


def parse_tags(s: str) -> list[str]:
    if not s or pd.isna(s):
        return []
    parts = re.split(r"[|,]", str(s))
    return [p.strip().lower() for p in parts if p and str(p).strip()]


def title_structure_ratios(s: str) -> dict[str, float]:
    """Language-agnostic structure proxies (keep in sync with server/scoreTitle.js)."""
    if not s:
        return {"punctRatio": 0.0, "digitRatio": 0.0, "upperRatio": 0.0}
    n = len(s)
    punct = digit = upper = 0
    for c in s:
        if c.isdigit():
            digit += 1
        if c.isupper() and c != c.lower():
            upper += 1
        if not c.isalnum() and not c.isspace():
            punct += 1
    return {
        "punctRatio": float(punct / max(n, 1)),
        "digitRatio": float(digit / max(n, 1)),
        "upperRatio": float(upper / max(n, 1)),
    }


def build_llm_trend_context(bucket: dict) -> str:
    """Short paragraph for Model 3 prompts (dataset-derived, no PII)."""
    parts: list[str] = []
    tt = bucket.get("topTags") or []
    if tt:
        parts.append(
            "Strong tags in this bucket: "
            + ", ".join(str(x) for x in tt[:14])
        )
    st = bucket.get("sampleTitles") or []
    if st:
        parts.append(
            "Trending title examples (structure/voice only): "
            + " | ".join(str(x) for x in st[:5])
        )
    tlm = bucket.get("titleLenMean")
    wcm = bucket.get("wordCountMean")
    if tlm is not None and wcm is not None:
        parts.append(
            f"Typical winning title shape: ~{float(tlm):.0f} characters, "
            f"~{float(wcm):.1f} words."
        )
    cent = bucket.get("centroidTf") or {}
    if cent:
        top_terms = sorted(cent.keys(), key=lambda k: cent[k], reverse=True)[:14]
        parts.append(
            "Hot terms in trending titles: " + ", ".join(top_terms)
        )
    return " ".join(parts) if parts else ""


def build_region_stats(df: pd.DataFrame, region_key: str) -> dict[str, dict] | None:
    if region_key == "GLOBAL":
        sub = df
    else:
        sub = df[df["region"] == region_key]
    if len(sub) < 3:
        return None

    out: dict[str, dict] = {}
    for cat_id, g in sub.groupby("category_id"):
        if int(cat_id) < 0:
            continue
        g = g.sort_values("views", ascending=False)
        thresh = g["views"].quantile(HIGH_VIEW_QUANTILE)
        high = g[g["views"] >= thresh]
        if len(high) < 2:
            high = g.head(max(2, len(g) // 3))

        titles = high["title"].tolist()
        high_sorted = high.sort_values("views", ascending=False)
        seen_sample: set[str] = set()
        sample_titles: list[str] = []
        for _, row in high_sorted.iterrows():
            t = str(row["title"]).strip()
            if not t or len(t) > 120:
                continue
            low = t.lower()
            if low in seen_sample:
                continue
            seen_sample.add(low)
            sample_titles.append(t)
            if len(sample_titles) >= 25:
                break

        tag_weights: dict[str, float] = defaultdict(float)
        for _, row in high.iterrows():
            w = float(row["views"]) + 1.0
            for t in parse_tags(str(row["tags"])):
                tag_weights[t] += float(np.log1p(w))

        top_tags = sorted(
            tag_weights.keys(), key=lambda x: tag_weights[x], reverse=True
        )[:80]
        tag_imp = {t: float(tag_weights[t]) for t in top_tags}

        min_df = 1 if len(high) < 8 else min(2, max(1, len(high) // 10))

        def fit_tfidf_to_dicts(
            doc_list: list[str], use_bigrams: bool
        ) -> tuple[dict[str, float], dict[str, float]]:
            cent: dict[str, float] = {}
            idf_out: dict[str, float] = {}
            ng = (1, 2) if use_bigrams else (1, 1)
            vec_local = TfidfVectorizer(
                max_features=min(MAX_FEATURES, max(50, len(doc_list) * 20)),
                min_df=1,
                max_df=0.95,
                ngram_range=ng,
                token_pattern=r"(?u)\b\w\w+\b",
            )
            try:
                Xloc = vec_local.fit_transform(doc_list)
                centroid_loc = np.asarray(Xloc.mean(axis=0)).ravel()
                vocab_loc = vec_local.get_feature_names_out()
                idf_arr_loc = vec_local.idf_
                for i in range(len(vocab_loc)):
                    if centroid_loc[i] > 1e-12:
                        cent[str(vocab_loc[i])] = float(centroid_loc[i])
                    idf_out[str(vocab_loc[i])] = float(idf_arr_loc[i])
            except Exception:
                pass
            return cent, idf_out

        cent_dict: dict[str, float] = {}
        idf_dict: dict[str, float] = {}
        try:
            vec = TfidfVectorizer(
                max_features=min(MAX_FEATURES, max(50, len(high) * 20)),
                min_df=min_df,
                max_df=0.95,
                ngram_range=(1, 2),
                token_pattern=r"(?u)\b\w\w+\b",
            )
            X = vec.fit_transform(titles)
            centroid = np.asarray(X.mean(axis=0)).ravel()
            vocab = vec.get_feature_names_out()
            idf_arr = vec.idf_
            for i in range(len(vocab)):
                if centroid[i] > 1e-12:
                    cent_dict[str(vocab[i])] = float(centroid[i])
                idf_dict[str(vocab[i])] = float(idf_arr[i])
        except Exception:
            pass

        if len(idf_dict) == 0 and len(titles) >= 1:
            cent_dict, idf_dict = fit_tfidf_to_dicts(
                [str(t) for t in titles], use_bigrams=True
            )
        if len(idf_dict) == 0 and len(titles) >= 1:
            cent_dict, idf_dict = fit_tfidf_to_dicts(
                [str(t) for t in titles], use_bigrams=False
            )

        lens = high["title"].str.len()
        words = high["title"].str.split().str.len()
        struct_rows = [title_structure_ratios(t) for t in titles]
        pr = [r["punctRatio"] for r in struct_rows]
        dr = [r["digitRatio"] for r in struct_rows]
        ur = [r["upperRatio"] for r in struct_rows]
        blob: dict = {
            "sampleTitles": sample_titles,
            "topTags": top_tags[:50],
            "tagImportance": {k: tag_imp[k] for k in top_tags[:50] if k in tag_imp},
            "idf": idf_dict,
            "centroidTf": cent_dict,
            "titleLenMean": float(lens.mean()) if len(lens) else 40.0,
            "titleLenStd": max(float(lens.std()) if len(lens) > 1 else 10.0, 1.0),
            "wordCountMean": float(words.mean()) if len(words) else 8.0,
            "wordCountStd": max(float(words.std()) if len(words) > 1 else 3.0, 0.5),
            "punctRatioMean": float(np.mean(pr)) if pr else 0.05,
            "punctRatioStd": max(float(np.std(pr)) if len(pr) > 1 else 0.05, 0.01),
            "digitRatioMean": float(np.mean(dr)) if dr else 0.05,
            "digitRatioStd": max(float(np.std(dr)) if len(dr) > 1 else 0.05, 0.01),
            "upperRatioMean": float(np.mean(ur)) if ur else 0.05,
            "upperRatioStd": max(float(np.std(ur)) if len(ur) > 1 else 0.05, 0.01),
            "sampleSize": int(len(high)),
        }
        blob["llmTrendContext"] = build_llm_trend_context(blob)
        out[str(int(cat_id))] = blob
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=Path("data/raw"))
    ap.add_argument("--fixture", type=Path, default=None)
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("models/model2-title-confidence/artifacts/model2.json"),
    )
    args = ap.parse_args()

    if args.fixture and args.fixture.is_file():
        raw = pd.read_csv(args.fixture, encoding="utf-8", on_bad_lines="skip")
        df = normalize_df(raw, "GLOBAL")
        if df is None:
            raise SystemExit("Fixture missing title/views columns")
    else:
        df = load_all_csvs(args.data_dir)
        if df is None or len(df) == 0:
            raise SystemExit(
                f"No usable CSV in {args.data_dir}. Add Kaggle CSVs "
                f"(e.g. US_youtube_trending_data.csv, USvideos.csv) or use --fixture."
            )

    regions_to_build = ["GLOBAL"]
    for r in sorted(df["region"].unique()):
        if r and r != "GLOBAL" and len(df[df["region"] == r]) >= 20:
            regions_to_build.append(str(r))

    artifact: dict = {
        "version": ARTIFACT_VERSION,
        "weights": WEIGHTS,
        "trainingNotes": {
            "highViewQuantile": HIGH_VIEW_QUANTILE,
            "perCategory": "TF-IDF centroid + tag log-weights from high-view rows; length & structure stats; sampleTitles; llmTrendContext for Model 3 prompts.",
            "sources": "Kaggle-friendly: rsrishav/youtube-trending-video-dataset (XX_youtube_trending_data.csv), datasnaek/youtube-new (XXvideos.csv), plus optional extra CSVs in data/raw/.",
        },
        "categories": {},
    }

    for reg in regions_to_build:
        stats = build_region_stats(df, reg)
        if not stats:
            continue
        for cat_id, blob in stats.items():
            if cat_id not in artifact["categories"]:
                artifact["categories"][cat_id] = {"regions": {}}
            artifact["categories"][cat_id]["regions"][reg] = blob

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(artifact, f, ensure_ascii=False)
    print(
        f"Wrote {args.out} — {len(artifact['categories'])} category buckets, "
        f"regions: {regions_to_build}"
    )


if __name__ == "__main__":
    main()
