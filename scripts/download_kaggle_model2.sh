#!/usr/bin/env bash
# Optional: download public Kaggle CSVs into data/raw for Model 2 training.
# Requires: pip install kaggle, ~/.kaggle/kaggle.json (API token)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/data/raw"
mkdir -p "$DEST"
cd "$DEST"

if ! command -v kaggle >/dev/null 2>&1; then
  echo "kaggle CLI not found. Install: pip install kaggle"
  echo "Then add API credentials: https://www.kaggle.com/docs/api"
  echo "Or manually place CSVs in: $DEST"
  exit 1
fi

echo "Downloading rsrishav/youtube-trending-video-dataset (US file)..."
kaggle datasets download -d rsrishav/youtube-trending-video-dataset -f US_youtube_trending_data.csv --force
unzip -o US_youtube_trending_data.csv.zip 2>/dev/null || true
rm -f US_youtube_trending_data.csv.zip

echo "Downloading bsthere/youtube-trending-videos-stats-2026 (full zip)..."
kaggle datasets download -d bsthere/youtube-trending-videos-stats-2026 --force || true
for z in *.zip; do
  [ -f "$z" ] && unzip -o "$z" && rm -f "$z" || true
done

echo "Done. CSVs in $DEST — run: npm run train:model2"
