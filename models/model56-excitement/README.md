# Model 5/6 — excitement / engagement proxy

Signal-based segmentation (no ML training): **audio RMS + volume spikes** plus **frame-difference motion** in sliding windows, combined with fixed weights, then median split into `high` / `low` engagement.

## Requirements

- **Python 3** with `numpy` (`pip install -r requirements.txt`)
- **ffmpeg** and **ffprobe** on `PATH` (same as Whisper / Model 1)

## CLI

```bash
python3 scripts/analyze.py /path/to/video.mp4 --window-sec 3
```

Prints one JSON object to stdout: `durationSec`, `fullDurationSec`, `segmentsSec` (times in seconds), `windows` (per-window scores), `weights`, `capped` (true if video longer than 30 min — only first 30 min analyzed).

### Weights (defaults)

- `w1` (audio energy): 0.45  
- `w2` (motion): 0.35  
- `w3` (spike bonus when RMS > μ + 1.2σ): 0.2  

Override: `--w1`, `--w2`, `--w3`, `--motion-fps` (default 1.0).

## Interpretation

- **high** engagement → green in the ClipFarm editor (exciting / above-median score).
- **low** engagement → red (not exciting / below median).

This is a baseline; tune `--window-sec` and weights for your content.
