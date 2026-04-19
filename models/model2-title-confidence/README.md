# Model 2 — Title confidence (Kaggle-derived)

## How training works

1. **Load CSVs** from `data/raw/`. Supported layouts:
   - **datasnaek / youtube-new style:** `USvideos.csv`, `GBvideos.csv`, … → region from filename.
   - **Rishav trending:** `US_youtube_trending_data.csv`, … (`categoryId`, `view_count`, `tags`, `title`).
   - Any CSV with mappable **`title`** + **`views`** (aliases: `view_count`, etc.) + optional **`tags`**, **`category_id`** / **`categoryId`**.
   - Extra files (e.g. [bsthere/youtube-trending-videos-stats-2026](https://www.kaggle.com/datasets/bsthere/youtube-trending-videos-stats-2026)) can be dropped in `data/raw/` if columns normalize; unknown files are skipped.
   - Optional: run `scripts/download_kaggle_model2.sh` (requires [Kaggle API](https://www.kaggle.com/docs/api)) to fetch [rsrishav/youtube-trending-video-dataset](https://www.kaggle.com/datasets/rsrishav/youtube-trending-video-dataset) and related zips.
2. **Per `(region, category_id)`**, take **high-view** rows (top quartile of `views` in that slice, with a minimum row count).
3. From those rows, compute:
   - **Tag weights** — each tag accumulates `log1p(views)` so frequent high-view tags rank higher (`topTags`, `tagImportance`).
   - **Trending lexical profile** — `TfidfVectorizer` on titles → **mean TF–IDF vector** (`centroidTf`) and term **IDF** (for scoring new titles with the same vocabulary).
   - **Title length** — mean/STD of character length and word count.
   - **Language structure** — mean/STD of punctuation ratio, digit ratio, and uppercase-letter ratio (language-agnostic surface cues).
4. Each bucket also gets **`llmTrendContext`**: a short text summary of tags, example titles, length stats, and hot TF–IDF terms for **Model 3** prompts.
5. All of the above is written to **`artifacts/model2.json`** (version **5**). Nothing is trained online in Node; inference only loads JSON.

## At scoring time (inference)

The API blends four **0–100** sub-scores (weights in JSON, default 0.28 each pair):

- **Tags + category** — Jaccard overlap between user tags and `topTags`, boosted by `tagImportance` (same `category_id` bucket).
- **Trending lexical similarity** — cosine similarity between the user title’s TF–IDF vector and the stored centroid (word / bigram overlap with high-view titles).
- **Title length** — how close character length and word count are to the bucket mean (via z-scores).
- **Language structure** — how close punctuation / digits / uppercase ratios are to the bucket stats.

Final **confidence** is the weighted sum, rounded to **two decimals**.

Offline-trained **title confidence** score (0–100) combining:

- **Tag alignment** — overlap with high-view tags in the same YouTube `category_id` (and region when available).
- **Trending similarity** — cosine similarity of the title’s TF–IDF vector to a **centroid** of high-view titles in that bucket.
- **Length and structure** — length vs bucket; punctuation/digit/case ratios vs bucket.

## Data (not in repo)

1. Recommended: [YouTube Trending Video Dataset (Rishav)](https://www.kaggle.com/datasets/rsrishav/youtube-trending-video-dataset) — place `US_youtube_trending_data.csv` (and other regions) under [`data/raw/`](../../data/raw/).
2. Also works: [youtube-new (datasnaek)](https://www.kaggle.com/datasets/datasnaek/youtube-new) `XXvideos.csv` files.
3. Optional merge: [youtube-trending-videos-stats-2026 (bsthere)](https://www.kaggle.com/datasets/bsthere/youtube-trending-videos-stats-2026) — unzip into `data/raw/` if columns map to `title` / `view_count` / `category_id` / `tags`.

## Train

**Always run `pip` and `python` from the repository root** (`INFO_CLIPFARM`), where the `models/` folder exists. If you see `Could not open requirements file`, you are in the wrong directory (or use the root file below).

```bash
cd /path/to/INFO_CLIPFARM
python -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements-train.txt
# or: pip install -r models/model2-title-confidence/requirements-train.txt

# Full data (from repo root)
npm run train:model2
# equivalent: python models/model2-title-confidence/scripts/train.py --data-dir data/raw

# Or fixture only (CI / default bundled artifact)
npm run train:model2:fixture
```

Artifacts are written to [`artifacts/model2.json`](artifacts/model2.json).

## EDA report

```bash
python models/model2-title-confidence/scripts/analyze_eda.py --data-dir data/raw --out models/model2-title-confidence/reports/eda.md
```

## Inference

The Node server loads `artifacts/model2.json` and exposes `POST /api/score-title` (see [`server/scoreTitle.js`](../../server/scoreTitle.js)).

### Test the score from the terminal

With the dev app running (`npm run dev` from the repo root), Vite serves on e.g. `http://localhost:5173`. Example (category **20** = Gaming, matches the bundled fixture):

```bash
curl -s -X POST http://localhost:5173/api/score-title \
  -H "Content-Type: application/json" \
  -d '{"title":"Fortnite tutorial epic wins daily","tags":["gaming","fortnite","tips"],"categoryId":20}'
```

You should get JSON like `{"score":72,"breakdown":{"tagScore":...}}`.

Check that the artifact loads:

```bash
curl -s http://localhost:5173/api/health
```

Look for `"model2Artifact":true`. If `false`, ensure `models/model2-title-confidence/artifacts/model2.json` exists (run `train.py --fixture` once).
