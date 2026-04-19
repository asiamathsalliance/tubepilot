# Model 8 — YouTube trending view modeling (Rishav dataset)

Offline **EDA** and **regression** on the Kaggle dataset
[YouTube Trending Video Dataset](https://www.kaggle.com/datasets/rsrishav/youtube-trending-video-dataset)
(primary file: `US_youtube_trending_data.csv`).

## What it does

- **EDA** (`scripts/eda.py`): summarizes `view_count`, title length, `category_id`, tag counts, publish-time hour, and delay between publish time and trending date.
- **Train** (`scripts/train.py`): fits `HistGradientBoostingRegressor` on **`log1p(view_count)`** using features derived from:
  - **Title** — character length, word count  
  - **Tags** — count of pipe/comma-separated tags  
  - **category_id** — one-hot (capped categories)  
  - **publish_time** — hour of day, day-of-week  
  - **trending_date − publish_time** — days from publish to trending snapshot  

Artifacts:

- `artifacts/model8.json` — metrics, feature list, target description  
- `artifacts/model8.joblib` — fitted sklearn `Pipeline` (load in Python with `joblib.load`)

Inference is **Python-only** in v1 (no Node API).

## App integration — upload timing (Editor)

The ClipFarm **Editor** calls `POST /api/recommend-upload-dates-model8` (see `server/recommendUploadDatesModel8.js`). It returns a **recommended publish datetime per timeline region**, plus **score100** (0–100) and **estimatedViews** from the same heuristic. **`POST /api/model8-score-at-datetime`** re-scores an arbitrary ISO datetime (manual picker on Review 2). The app uses the project’s **trending region**, **tag count**, **title/description length**, and **category** where available. It does **not** load `model8.joblib` at runtime (no sklearn in Node). Loading the trained regressor in Python for scoring candidate slots is a possible future upgrade.

## Data (not in repo)

1. Download `US_youtube_trending_data.csv` from Kaggle into [`data/raw/`](../../data/raw/).
2. Or use the bundled **fixture** for smoke tests (tiny CSV).

## Run (from repository root)

```bash
pip install -r requirements-train.txt

# EDA (full Kaggle file)
python models/model8-youtube-trending/scripts/eda.py \
  --csv data/raw/US_youtube_trending_data.csv

# Train on Kaggle file
python models/model8-youtube-trending/scripts/train.py --csv data/raw/US_youtube_trending_data.csv

# Smoke: fixture only
python models/model8-youtube-trending/scripts/eda.py \
  --csv models/model8-youtube-trending/tests/fixtures/minimal_us_trending.csv
python models/model8-youtube-trending/scripts/train.py \
  --fixture models/model8-youtube-trending/tests/fixtures/minimal_us_trending.csv
```

Column names are normalized (lowercase, spaces → underscores). Required columns include **`title`**, **`category_id`** (or `category`), **`view_count`** (or `views`), and preferably **`publish_time`**, **`trending_date`**, **`tags`**.
