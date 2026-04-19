"""
Thumbnail features: YOLO-World (open-vocab) text boxes, YOLOv8n COCO objects,
heuristic text bands, color/layout, ResNet18 chunks.
"""
from __future__ import annotations

import os
from typing import Any

import cv2
import numpy as np

FEATURE_NAMES = (
    [
        "yolo_text_area_ratio",
        "yolo_text_box_count_norm",
        "yolo_text_center_y_mean",
        "yolo_text_bottom_zone_frac",
        "text_band_bottom_ratio",
        "text_horizontal_edge_ratio",
        "bottom_third_edge_density",
        "saturation_mean",
        "value_std",
        "warm_cool_ratio",
        "symmetry_lr_diff",
        "yolo_person_count",
        "yolo_max_box_area_ratio",
        "yolo_class_diversity",
    ]
    + [f"cnn_chunk_{i}" for i in range(8)]
)

CNN_CHUNKS = 8

_WORLD_WEIGHTS = ("yolov8s-worldv2.pt", "yolov8s-world.pt")


def _skip_yolo_world() -> bool:
    return os.environ.get("MODEL4_SKIP_YOLO_WORLD") == "1"


def _skip_yolo_coco() -> bool:
    # Legacy: MODEL4_SKIP_YOLO=1 skips COCO detector only (text world still runs).
    return os.environ.get("MODEL4_SKIP_YOLO") == "1"


def _skip_all_yolo() -> bool:
    return os.environ.get("MODEL4_SKIP_ALL_YOLO") == "1"


def _read_bgr(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(path)
    return img


def _resize(img: np.ndarray, w: int = 320, h: int = 180) -> np.ndarray:
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)


def text_and_layout_feats(img_bgr: np.ndarray) -> tuple[float, float, float]:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    mag_n = mag / (np.median(mag) + 1e-6)
    band = (mag_n > 2.2).astype(np.uint8) * 255
    band = cv2.morphologyEx(band, cv2.MORPH_CLOSE, np.ones((3, 11), np.uint8))
    h, w = band.shape
    bottom = band[int(h * 0.58) :, :]
    text_band_bottom_ratio = float(np.mean(bottom > 0))
    horiz = np.abs(gx)
    horiz_n = horiz / (np.percentile(horiz, 95) + 1e-6)
    text_horizontal_edge_ratio = float(np.mean(horiz_n > 0.55))
    edges = cv2.Canny(gray, 55, 155)
    b3 = edges[int(h * 0.66) :, :]
    bottom_third_edge_density = float(np.mean(b3 > 0))
    return text_band_bottom_ratio, text_horizontal_edge_ratio, bottom_third_edge_density


def color_feats(img_bgr: np.ndarray) -> tuple[float, float, float]:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    s = hsv[:, :, 1] / 255.0
    v = hsv[:, :, 2] / 255.0
    saturation_mean = float(np.mean(s))
    value_std = float(np.std(v))
    b, g, r = cv2.split(img_bgr.astype(np.float32))
    warm = r + g
    cool = b + g * 0.2
    warm_cool_ratio = float(np.mean(warm) / (np.mean(cool) + 1e-6))
    return saturation_mean, value_std, warm_cool_ratio


def symmetry_lr_diff(img_bgr: np.ndarray) -> float:
    h, w, _ = img_bgr.shape
    mid = w // 2
    left = img_bgr[:, :mid, :]
    right = cv2.flip(img_bgr[:, mid : mid + mid, :], 1)
    if right.shape[1] != left.shape[1]:
        right = right[:, : left.shape[1], :]
    d = np.mean(np.abs(left.astype(np.float32) - right.astype(np.float32)))
    return float(d / 255.0)


_yolo_world_model: Any = None


def yolo_world_text_layout(path: str) -> tuple[float, float, float, float]:
    """
    YOLO-World open-vocabulary boxes for thumbnail / on-image text.
    Returns area_ratio, count_norm, weighted_center_y (0=top), bottom_zone_frac.
    """
    global _yolo_world_model
    if _skip_all_yolo() or _skip_yolo_world():
        return 0.0, 0.0, 0.55, 0.0
    try:
        from ultralytics import YOLO
    except Exception:
        return 0.0, 0.0, 0.55, 0.0

    try:
        if _yolo_world_model is None:
            last = None
            for w in _WORLD_WEIGHTS:
                try:
                    m = YOLO(w)
                    m.set_classes(
                        [
                            "text or title lettering on a video thumbnail",
                            "subtitle text on image",
                            "words and letters on screen",
                            "",
                        ]
                    )
                    _yolo_world_model = m
                    break
                except Exception as e:
                    last = e
            if _yolo_world_model is None and last:
                raise last

        res = _yolo_world_model.predict(
            path, verbose=False, imgsz=640, conf=0.12, iou=0.45
        )[0]
        boxes = res.boxes
        ih, iw = res.orig_shape
        frame = float(iw * ih) + 1e-6
        if boxes is None or len(boxes) == 0:
            return 0.0, 0.0, 0.55, 0.0

        areas: list[float] = []
        centers_y: list[float] = []
        bottom_areas: list[float] = []
        for i in range(len(boxes)):
            b = boxes.xyxy[i].cpu().numpy()
            bw = max(0.0, float(b[2] - b[0]))
            bh = max(0.0, float(b[3] - b[1]))
            a = bw * bh
            areas.append(a)
            cy = float((b[1] + b[3]) * 0.5 / ih)
            centers_y.append(cy)
            if cy >= 0.52:
                bottom_areas.append(a)

        raw_area_ratio = min(1.0, sum(areas) / frame)
        count_norm = min(1.0, len(areas) / 10.0)
        wsum = sum(areas) + 1e-6
        cyme = sum(c * a for c, a in zip(centers_y, areas)) / wsum
        bot_share = sum(bottom_areas) / (sum(areas) + 1e-6)
        return raw_area_ratio, count_norm, float(cyme), float(bot_share)
    except Exception:
        return 0.0, 0.0, 0.55, 0.0


_yolo_coco: Any = None


def yolo_coco_feats(path: str) -> tuple[float, float, float]:
    global _yolo_coco
    if _skip_all_yolo() or _skip_yolo_coco():
        return 0.0, 0.0, 0.0
    try:
        from ultralytics import YOLO
    except Exception:
        return 0.0, 0.0, 0.0
    try:
        if _yolo_coco is None:
            _yolo_coco = YOLO("yolov8n.pt")
        res = _yolo_coco.predict(path, verbose=False, imgsz=320)[0]
        boxes = res.boxes
        if boxes is None or len(boxes) == 0:
            return 0.0, 0.0, 0.0
        areas = []
        cls_set: set[int] = set()
        for i in range(len(boxes)):
            b = boxes.xyxy[i].cpu().numpy()
            cls = int(boxes.cls[i].item())
            cls_set.add(cls)
            bw = max(0.0, float(b[2] - b[0]))
            bh = max(0.0, float(b[3] - b[1]))
            areas.append(bw * bh)
        ih, iw = res.orig_shape
        frame = float(iw * ih) + 1e-6
        max_area_ratio = max(a / frame for a in areas) if areas else 0.0
        person = 0
        for i in range(len(boxes)):
            if int(boxes.cls[i].item()) == 0:
                person += 1
        return float(person), float(max_area_ratio), float(len(cls_set))
    except Exception:
        return 0.0, 0.0, 0.0


_cnn: tuple[Any, Any] | None = None


def cnn_chunk_feats(img_bgr: np.ndarray) -> list[float]:
    global _cnn
    try:
        import torch
        from torchvision import models, transforms
    except Exception:
        return [0.0] * CNN_CHUNKS

    if _cnn is None:
        weights = models.ResNet18_Weights.IMAGENET1K_V1
        net = models.resnet18(weights=weights)
        net.eval()
        children = list(net.children())[:-1]
        body = torch.nn.Sequential(*children)
        body.eval()
        tfm = transforms.Compose(
            [
                transforms.ToPILImage(),
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]
                ),
            ]
        )
        _cnn = (body, tfm)

    body, tfm = _cnn
    import torch

    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    t = tfm(rgb).unsqueeze(0)
    with torch.no_grad():
        feat = body(t).squeeze().numpy()
    k = CNN_CHUNKS
    n = len(feat)
    chunk = n // k
    out: list[float] = []
    for i in range(k):
        s = i * chunk
        e = (i + 1) * chunk if i < k - 1 else n
        out.append(float(np.mean(feat[s:e])))
    return out


def extract_feature_vector(image_path: str) -> list[float]:
    img = _read_bgr(image_path)
    img_small = _resize(img)
    tw_ar, tw_cn, tw_cy, tw_bot = yolo_world_text_layout(image_path)
    t1, t2, t3 = text_and_layout_feats(img_small)
    s1, s2, s3 = color_feats(img_small)
    sym = symmetry_lr_diff(img_small)
    y1, y2, y3 = yolo_coco_feats(image_path)
    c = cnn_chunk_feats(img_small)
    vec = [tw_ar, tw_cn, tw_cy, tw_bot, t1, t2, t3, s1, s2, s3, sym, y1, y2, y3] + c
    if len(vec) != len(FEATURE_NAMES):
        raise RuntimeError("feature length mismatch")
    return vec
