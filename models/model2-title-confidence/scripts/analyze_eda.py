#!/usr/bin/env python3
"""Lightweight EDA: per-region / per-category counts and view stats from raw CSVs."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path


def _load_train():
    p = Path(__file__).resolve().parent / "train.py"
    spec = importlib.util.spec_from_file_location("train_mod", p)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=Path("data/raw"))
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("models/model2-title-confidence/reports/eda.md"),
    )
    args = ap.parse_args()

    train = _load_train()
    df = train.load_all_csvs(args.data_dir)
    if df is None or len(df) == 0:
        print(f"No data in {args.data_dir}")
        return

    lines = [
        "# EDA — YouTube trending CSVs",
        "",
        f"- Rows: **{len(df)}**",
        "",
        "## By region",
        "",
    ]
    for r, g in df.groupby("region"):
        lines.append(f"- **{r}**: {len(g)} rows, views sum {g['views'].sum():,.0f}")
    lines.extend(["", "## By category_id (top 15 by count)", ""])
    vc = df.groupby("category_id").size().sort_values(ascending=False).head(15)
    for cid, n in vc.items():
        lines.append(f"- `{int(cid)}`: {n} rows")
    lines.extend(["", "## Views describe", "", "```", str(df["views"].describe()), "```", ""])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
