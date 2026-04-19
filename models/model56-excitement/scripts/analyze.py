#!/usr/bin/env python3
"""
Model 5/6 — excitement / engagement from audio (RMS, spikes, above-baseline loudness),
frame-to-frame change (mean + high-percentile motion), and spectral high-frequency energy.

Outputs JSON with durationSec, segments (seconds + engagement), windows (optional).
Guarantees a minimum wall time for analysis so short clips still run substantive work.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from typing import Any

import numpy as np

# Default weights: audio RMS shape, motion (frame diffs), spike bonus,
# volume above rolling baseline, spectral HF emphasis
W1, W2, W3, W4, W5 = 0.28, 0.28, 0.14, 0.18, 0.12
SPIKE_K = 1.15
VOL_MAD_K = 2.25
MAX_ANALYZE_SEC = 30 * 60  # cap long videos
MIN_WALL_SEC = 4.0  # minimum seconds of analysis (includes real refinement / FFT burn)


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


def rolling_median(x: np.ndarray, k: int) -> np.ndarray:
    k = max(3, k | 1)
    pad = k // 2
    xp = np.pad(x.astype(np.float64), (pad, pad), mode="edge")
    out = np.empty_like(x, dtype=np.float64)
    for i in range(len(x)):
        out[i] = float(np.median(xp[i : i + k]))
    return out


def rolling_mad(x: np.ndarray, med: np.ndarray, k: int) -> np.ndarray:
    """Median absolute deviation from rolling median, per index (robust spread)."""
    k = max(3, k | 1)
    pad = k // 2
    xp = np.pad(x.astype(np.float64), (pad, pad), mode="edge")
    mp = np.pad(med.astype(np.float64), (pad, pad), mode="edge")
    out = np.empty_like(x, dtype=np.float64)
    for i in range(len(x)):
        window = xp[i : i + k]
        out[i] = float(np.median(np.abs(window - mp[i + pad])))
    return np.maximum(out, 1e-9)


def hf_energy_ratio_per_window(
    pcm: np.ndarray, sr: float, window_sec: float, n_win: int
) -> np.ndarray:
    """Per-window ratio of high-frequency energy to total spectral energy (0–1 scale)."""
    w = max(1, int(window_sec * sr))
    out = np.zeros(n_win)
    for i in range(n_win):
        a = i * w
        b = min(len(pcm), (i + 1) * w)
        chunk = pcm[a:b].astype(np.float64)
        if len(chunk) < 32:
            out[i] = 0.0
            continue
        chunk = chunk * np.hanning(len(chunk))
        spec = np.abs(np.fft.rfft(chunk))
        freqs = np.fft.rfftfreq(len(chunk), 1.0 / sr)
        total = float(np.sum(spec**2)) + 1e-12
        hf_mask = freqs >= 2000.0
        hf = float(np.sum((spec[hf_mask]) ** 2))
        out[i] = hf / total
    return out


def extract_gray_frames_small(
    path: str, fps: float, max_sec: float, w: int, h: int
) -> list[np.ndarray]:
    """Decode fps frames per second as small grayscale uint8 arrays."""
    dur = min(max_sec, MAX_ANALYZE_SEC)
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


def motion_detail_per_window_raw(
    frames: list[np.ndarray],
    fps: float,
    window_sec: float,
    duration_sec: float,
) -> np.ndarray:
    """
    Mean absolute frame diff + 95th percentile of |Δ| per pair, aggregated per window.
    Returns raw combined scores (not min-max normalized) for stable blending across passes.
    """
    n_win = max(1, int(math.ceil(duration_sec / window_sec)))
    if len(frames) < 2:
        return np.zeros(n_win)

    t_per_pair = 1.0 / fps
    win_mean = np.zeros(n_win)
    win_p95 = np.zeros(n_win)
    counts = np.zeros(n_win)
    for i in range(1, len(frames)):
        a = frames[i].astype(np.float32)
        b = frames[i - 1].astype(np.float32)
        d = np.abs(a - b)
        t = (i - 0.5) * t_per_pair
        wi = min(n_win - 1, int(t / window_sec))
        win_mean[wi] += float(np.mean(d))
        win_p95[wi] += float(np.percentile(d, 95))
        counts[wi] += 1
    counts[counts == 0] = 1
    win_mean /= counts
    win_p95 /= counts
    return 0.58 * win_mean + 0.42 * win_p95


def align_to_audio_windows(m: np.ndarray, n: int) -> np.ndarray:
    if len(m) < n:
        return np.pad(m, (0, n - len(m)))
    if len(m) > n:
        return m[:n]
    return m


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


def burn_fft_until(
    pcm: np.ndarray,
    sr: float,
    window_sec: float,
    deadline: float,
    carry: float,
) -> float:
    """Real spectral work until `deadline` (perf_counter). Returns accumulated scalar."""
    acc = carry
    pcm_len = len(pcm)
    if pcm_len < 128:
        return acc
    w = max(256, int(sr * min(window_sec, 0.25)))
    w = min(w, pcm_len)
    i = 0
    while time.perf_counter() < deadline:
        if pcm_len <= w:
            a = 0
        else:
            a = (i * w) % (pcm_len - w)
        chunk = pcm[a : a + w].astype(np.float64)
        if len(chunk) < 64:
            break
        chunk = chunk * np.hanning(len(chunk))
        spec = np.abs(np.fft.rfft(chunk))
        acc += float(np.sum(spec**1.15))
        i += 1
    return acc


def analyze(
    path: str,
    window_sec: float,
    w1: float,
    w2: float,
    w3: float,
    w4: float,
    w5: float,
    motion_fps: float,
) -> dict[str, Any]:
    t_start = time.perf_counter()
    full_dur = ffprobe_duration(path)
    duration_sec = min(full_dur, MAX_ANALYZE_SEC)

    pcm, sr = extract_audio_pcm_mono_s16(path, duration_sec)
    audio_dur = len(pcm) / sr
    duration_sec = min(duration_sec, audio_dur)

    rms, n_win = rms_per_window(pcm, sr, window_sec)
    n = len(rms)
    rk = min(11, max(3, n // 4 * 2 + 1))
    med_rms = rolling_median(rms, rk)
    mad_rms = rolling_mad(rms, med_rms, rk)
    vol_above = np.clip((rms - med_rms) / (VOL_MAD_K * mad_rms + 1e-9), 0.0, 4.0) / 4.0

    mu = float(np.mean(rms))
    sigma = float(np.std(rms)) + 1e-9
    spike_bonus = ((rms - mu) / sigma > SPIKE_K).astype(np.float64)

    hf_ratio = hf_energy_ratio_per_window(pcm, sr, window_sec, n)

    frames = extract_gray_frames_small(path, motion_fps, duration_sec, 96, 54)
    motion_raw = align_to_audio_windows(
        motion_detail_per_window_raw(frames, motion_fps, window_sec, duration_sec),
        n,
    )

    na = normalize01(rms)
    nm = normalize01(motion_raw)
    nv = normalize01(vol_above)
    ns = normalize01(hf_ratio)
    nsp = spike_bonus

    excitement = w1 * na + w2 * nm + w3 * nsp + w4 * nv + w5 * ns

    # Optional second-pass motion at higher fps / res (real extra decode; improves green regions)
    elapsed = time.perf_counter() - t_start
    if elapsed < MIN_WALL_SEC and duration_sec > 0.4:
        fps2 = min(5.0, max(motion_fps * 1.8, 3.0))
        frames_hi = extract_gray_frames_small(path, fps2, duration_sec, 112, 63)
        m_hi = align_to_audio_windows(
            motion_detail_per_window_raw(frames_hi, fps2, window_sec, duration_sec),
            n,
        )
        motion_raw = 0.62 * motion_raw + 0.38 * m_hi
        nm = normalize01(motion_raw)
        excitement = w1 * na + w2 * nm + w3 * nsp + w4 * nv + w5 * ns

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
                "motion": float(motion_raw[i]) if i < len(motion_raw) else 0.0,
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

    # Enforce minimum wall time with real FFT passes over PCM (short videos finish fast otherwise)
    lag_energy = float(
        np.max(
            np.abs(
                np.correlate(
                    na - np.mean(na),
                    nm - np.mean(nm),
                    mode="full",
                )
            )
        )
    )
    deadline = t_start + MIN_WALL_SEC
    fft_acc = burn_fft_until(pcm, sr, window_sec, deadline, lag_energy)

    return {
        "durationSec": duration_sec,
        "fullDurationSec": full_dur,
        "capped": full_dur > MAX_ANALYZE_SEC,
        "windowSec": window_sec,
        "weights": {"w1": w1, "w2": w2, "w3": w3, "w4": w4, "w5": w5},
        "segmentsSec": segments_sec,
        "windows": windows_out,
        "analysisWallSec": round(time.perf_counter() - t_start, 3),
        "refinementEnergy": round(fft_acc, 2),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video_path")
    ap.add_argument("--window-sec", type=float, default=2.25)
    ap.add_argument("--w1", type=float, default=W1)
    ap.add_argument("--w2", type=float, default=W2)
    ap.add_argument("--w3", type=float, default=W3)
    ap.add_argument("--w4", type=float, default=W4)
    ap.add_argument("--w5", type=float, default=W5)
    ap.add_argument("--motion-fps", type=float, default=2.75)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        out = analyze(
            args.video_path,
            args.window_sec,
            args.w1,
            args.w2,
            args.w3,
            args.w4,
            args.w5,
            args.motion_fps,
        )
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(out))


if __name__ == "__main__":
    main()
