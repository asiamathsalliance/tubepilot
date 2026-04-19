#!/usr/bin/env python3
"""
Model 5/6 — excitement / engagement proxy from audio energy + spikes + motion.

Outputs JSON with durationSec, segments (seconds + engagement), windows (optional).
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from typing import Any

import numpy as np

# Default weights: audio, motion, spike bonus
W1, W2, W3 = 0.45, 0.35, 0.2
SPIKE_K = 1.2
MAX_ANALYZE_SEC = 30 * 60  # cap long videos


def run_cmd(args: list[str], timeout: int = 600) -> bytes:
    p = subprocess.run(args, capture_output=True, timeout=timeout)
    if p.returncode != 0:
        err = (p.stderr or b"").decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Command failed ({args[0]}): {err}")
    return p.stdout


def ffprobe_duration(path: str) -> float:
    out = run_cmd(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        timeout=120,
    )
    return float(out.decode().strip())


def extract_audio_pcm_mono_s16(path: str, max_sec: float) -> tuple[np.ndarray, float]:
    """Returns int16 mono samples and sample rate."""
    dur = min(max_sec, MAX_ANALYZE_SEC)
    out = run_cmd(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-t",
            str(dur),
            "-ac",
            "1",
            "-ar",
            "44100",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "pipe:1",
        ],
        timeout=int(dur) + 120,
    )
    raw = np.frombuffer(out, dtype=np.int16)
    sr = 44100.0
    return raw, sr


def rms_per_window(
    pcm: np.ndarray, sr: float, window_sec: float
) -> tuple[np.ndarray, int]:
    """One RMS value per window; returns (rms_array, n_windows)."""
    w = max(1, int(window_sec * sr))
    n = len(pcm) // w
    if n == 0:
        return np.array([0.0]), 1
    chunks = pcm[: n * w].reshape(n, w).astype(np.float64)
    rms = np.sqrt(np.mean(chunks**2, axis=1))
    return rms, n


def extract_gray_frames_small(path: str, fps: float, max_sec: float, w: int, h: int) -> list[np.ndarray]:
    """Decode fps frames per second as small grayscale uint8 arrays."""
    dur = min(max_sec, MAX_ANALYZE_SEC)
    # rawvideo gray 8-bit
    vf = f"fps={fps},scale={w}:{h},format=gray"
    out = run_cmd(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-t",
            str(dur),
            "-vf",
            vf,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "pipe:1",
        ],
        timeout=int(dur) + 180,
    )
    frame_bytes = w * h
    frames: list[np.ndarray] = []
    buf = out
    while len(buf) >= frame_bytes:
        frames.append(np.frombuffer(buf[:frame_bytes], dtype=np.uint8).reshape(h, w))
        buf = buf[frame_bytes:]
    return frames


def motion_per_window(
    frames: list[np.ndarray], fps: float, window_sec: float, duration_sec: float
) -> np.ndarray:
    """Mean absolute frame diff per window (length = n_audio_windows approx)."""
    if len(frames) < 2:
        n_win = max(1, int(math.ceil(duration_sec / window_sec)))
        return np.zeros(n_win)

    diffs = []
    for i in range(1, len(frames)):
        a = frames[i].astype(np.float32)
        b = frames[i - 1].astype(np.float32)
        diffs.append(float(np.mean(np.abs(a - b))))

    # Map frame-pair diffs to time; aggregate into windows
    n_win = max(1, int(math.ceil(duration_sec / window_sec)))
    t_per_pair = 1.0 / fps
    win_energy = np.zeros(n_win)
    counts = np.zeros(n_win)
    for i, d in enumerate(diffs):
        t = (i + 0.5) * t_per_pair
        wi = min(n_win - 1, int(t / window_sec))
        win_energy[wi] += d
        counts[wi] += 1
    counts[counts == 0] = 1
    return win_energy / counts


def normalize01(x: np.ndarray) -> np.ndarray:
    lo, hi = float(np.min(x)), float(np.max(x))
    if hi <= lo + 1e-12:
        return np.zeros_like(x)
    return (x - lo) / (hi - lo)


def merge_adjacent_windows(
    windows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge consecutive windows with the same engagement."""
    if not windows:
        return []
    merged: list[dict[str, Any]] = [dict(windows[0])]
    for w in windows[1:]:
        if w["engagement"] == merged[-1]["engagement"]:
            merged[-1]["t1"] = w["t1"]
            merged[-1]["score"] = max(merged[-1]["score"], w["score"])
        else:
            merged.append(dict(w))
    return merged


def analyze(
    path: str,
    window_sec: float,
    w1: float,
    w2: float,
    w3: float,
    motion_fps: float,
) -> dict[str, Any]:
    full_dur = ffprobe_duration(path)
    duration_sec = min(full_dur, MAX_ANALYZE_SEC)

    pcm, sr = extract_audio_pcm_mono_s16(path, duration_sec)
    audio_dur = len(pcm) / sr
    duration_sec = min(duration_sec, audio_dur)

    rms, _n_win = rms_per_window(pcm, sr, window_sec)

    mu = float(np.mean(rms))
    sigma = float(np.std(rms)) + 1e-9
    spike = (rms > mu + SPIKE_K * sigma).astype(np.float64)
    spike_bonus = spike  # 0 or 1 per window

    # Motion — align length with audio windows
    frames = extract_gray_frames_small(path, motion_fps, duration_sec, 64, 36)
    motion_w = motion_per_window(frames, motion_fps, window_sec, duration_sec)
    nr = len(rms)
    if len(motion_w) < nr:
        motion_w = np.pad(motion_w, (0, nr - len(motion_w)))
    elif len(motion_w) > nr:
        motion_w = motion_w[:nr]
    n = nr
    spike_bonus = spike_bonus[:n]

    na = normalize01(rms)
    nm = normalize01(motion_w)

    excitement = w1 * na + w2 * nm + w3 * spike_bonus

    # Threshold: median split → high = above median (more exciting)
    med = float(np.median(excitement))
    engagement_flags = excitement >= med

    windows_out: list[dict[str, Any]] = []
    for i in range(n):
        t0 = i * window_sec
        t1 = min(duration_sec, (i + 1) * window_sec)
        eng = "high" if engagement_flags[i] else "low"
        windows_out.append(
            {
                "t0": t0,
                "t1": t1,
                "score": float(excitement[i]),
                "engagement": eng,
                "audio_rms": float(rms[i]),
                "motion": float(motion_w[i]) if i < len(motion_w) else 0.0,
            }
        )

    merged = merge_adjacent_windows(
        [
            {
                "t0": w["t0"],
                "t1": w["t1"],
                "engagement": w["engagement"],
                "score": w["score"],
            }
            for w in windows_out
        ],
    )

    segments_sec = [
        {
            "startSec": m["t0"],
            "endSec": m["t1"],
            "engagement": m["engagement"],
        }
        for m in merged
    ]

    return {
        "durationSec": duration_sec,
        "fullDurationSec": full_dur,
        "capped": full_dur > MAX_ANALYZE_SEC,
        "windowSec": window_sec,
        "weights": {"w1": w1, "w2": w2, "w3": w3},
        "segmentsSec": segments_sec,
        "windows": windows_out,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video_path")
    ap.add_argument("--window-sec", type=float, default=3.0)
    ap.add_argument("--w1", type=float, default=W1)
    ap.add_argument("--w2", type=float, default=W2)
    ap.add_argument("--w3", type=float, default=W3)
    ap.add_argument("--motion-fps", type=float, default=1.0)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        out = analyze(
            args.video_path,
            args.window_sec,
            args.w1,
            args.w2,
            args.w3,
            args.motion_fps,
        )
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
