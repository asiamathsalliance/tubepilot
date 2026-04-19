"""Normalize Rishav / YouTube trending CSV column names."""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd


def read_trending_csv(path: Path) -> pd.DataFrame:
    raw = pd.read_csv(path, encoding="utf-8", on_bad_lines="skip", low_memory=False)
    raw.columns = [
        re.sub(r"\s+", "_", str(c).strip().lower()) for c in raw.columns
    ]
    return raw


def require_any(df: pd.DataFrame, *candidates: str) -> str:
    for c in candidates:
        if c in df.columns:
            return c
    raise SystemExit(
        f"Missing column; need one of {candidates}. Got: {list(df.columns)[:40]}"
    )


def parse_dt(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, utc=True, errors="coerce")


def tag_count(tags: str) -> int:
    if pd.isna(tags) or not str(tags).strip():
        return 0
    parts = re.split(r"[|,]", str(tags))
    return len([p for p in parts if p.strip()])
