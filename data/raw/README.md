Place Kaggle CSV exports here (not committed).

1. [Trending YouTube Statistics](https://www.kaggle.com/datasets/datasnaek/youtube-new) — e.g. `USvideos.csv`, `CAvideos.csv`, …
2. [YouTube title / tag dataset](https://www.kaggle.com/datasets/eaterofspirits/youtube-title-and-taf-data-set) — any CSV with recognizable `title` / `tags` / `views` columns.

Then run:

```bash
python models/model2-title-confidence/scripts/train.py --data-dir data/raw
```
