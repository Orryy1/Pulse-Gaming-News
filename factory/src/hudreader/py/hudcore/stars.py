"""The wanted level: star shapes in the wanted box, found by shape (template IoU against a drawn five-point star, or
the star the calibration tool cut from a real frame) rather than by OCR, which reads stars badly. Filled bright stars
are the level; dim stars are the empty slots GTA draws beside them. Flashing (the search phase) is told apart later,
from the alternation over samples (src/hudreader/telemetry.ts)."""

import math

import cv2
import numpy as np

from .profile import crop

_TEMPLATES = {}


def star_template(size, inner=0.5):
    """A filled five-point star, point up, in a size x size mask (0/1)."""
    key = (size, inner)
    if key in _TEMPLATES:
        return _TEMPLATES[key]
    s = size * 4
    pts = []
    for i in range(10):
        r = (s / 2 - 2) * (1 if i % 2 == 0 else inner)
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((s / 2 + r * math.cos(a), s / 2 + r * math.sin(a) + s * 0.04))
    m = np.zeros((s, s), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    m = cv2.resize(m, (size, size), interpolation=cv2.INTER_AREA)
    m = (m > 0).astype(np.uint8)
    _TEMPLATES[key] = m
    return m


def _iou(a, b):
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter) / float(union) if union else 0.0


def _stars_in(mask, star_px, min_score, template=None, value=None, edge_drop=0):
    """Star-shaped blobs in a binary mask: [(x, y, size, score)]. With `value` (the V channel) and edge_drop, a blob
    also needs a darker rim (GTA outlines its stars), which scenery rarely has."""
    n, lab, stats, cents = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    found = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        side = max(w, h)
        if side < star_px * 0.6 or side > star_px * 1.6:
            continue
        if min(w, h) < side * 0.75:
            continue
        sub = (lab[y:y + h, x:x + w] == i).astype(np.uint8)
        pad = np.zeros((side, side), np.uint8)
        pad[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = sub
        t = template if template is not None else star_template(side)
        if t.shape != pad.shape:
            t = (cv2.resize(t.astype(np.uint8), (side, side), interpolation=cv2.INTER_NEAREST) > 0).astype(np.uint8)
        score = _iou(pad > 0, t > 0)
        if score >= min_score and value is not None and edge_drop > 0:
            y0, x0 = max(0, y - 2), max(0, x - 2)
            y1, x1 = min(lab.shape[0], y + h + 2), min(lab.shape[1], x + w + 2)
            win = lab[y0:y1, x0:x1]
            ring = cv2.dilate((win == i).astype(np.uint8), np.ones((3, 3), np.uint8)) - (win == i).astype(np.uint8)
            inside = value[y:y + h, x:x + w][sub > 0]
            rim = value[y0:y1, x0:x1][ring > 0]
            if not rim.size or float(np.median(inside)) - float(np.median(rim)) < edge_drop:
                continue
        if score >= min_score:
            found.append((int(x + w / 2), int(y + h / 2), int(side), round(score, 3)))
    return found


def read_wanted(frame, profile, template=None):
    """{'stars': filled count, 'dim': empty slots, 'score': mean shape score, 'xs': star centres} or zeros."""
    box = profile.get("wanted", "box")
    if not box:
        return {"stars": 0, "dim": 0, "score": 0.0}
    c = crop(frame, box)
    if c.size == 0:
        return {"stars": 0, "dim": 0, "score": 0.0}
    H = frame.shape[0]
    star_px = max(6, int(round(profile.get("wanted", "starHeight", default=0.03) * H)))
    min_score = profile.get("wanted", "minScore", default=0.55)
    level = profile.get("wanted", "filledLevel", default=150)
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.int16)
    grey = hsv[..., 1] < 70
    # Judged against the region's own background, so a bright sky behind the HUD is not read as stars.
    med = int(np.median(v))
    lit = max(level, med + 35)
    bright = grey & (v >= lit)
    dim = grey & (v >= 55) & (v < lit) & (np.abs(v - med) > 25)
    edge = profile.get("wanted", "edgeDrop", default=50)
    filled = _stars_in(bright.astype(np.uint8), star_px, min_score, template, v, edge)
    empty = _stars_in(dim.astype(np.uint8), star_px, min_score, template, v, edge // 2)
    # Stars sit in one row: keep the row the filled stars (or, with none, the empty ones) are on.
    row = filled or empty
    if row:
        ys = sorted(s[1] for s in row)
        mid = ys[len(ys) // 2]
        filled = [s for s in filled if abs(s[1] - mid) <= star_px * 0.6]
        empty = [s for s in empty if abs(s[1] - mid) <= star_px * 0.6]
    mx = profile.get("wanted", "max", default=5)
    filled = sorted(filled)[-mx:]
    scores = [s[3] for s in filled + empty]
    return {
        "stars": len(filled),
        "dim": min(len(empty), mx),
        "score": round(float(np.mean(scores)), 3) if scores else 0.0,
        "xs": [s[0] for s in filled],
    }
