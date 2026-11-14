"""The wanted level: star shapes in the wanted box, found by shape rather than by OCR, which reads stars badly.

GTA V draws the level as filled stars side by side, touching, with the empty slots as thin outlines:
  - white filled stars: the police can see you (the level);
  - grey filled stars: the search phase (the same level, flashing between white and grey);
  - outlines: empty slots, never counted.
Touching stars make one blob, so stars are found by sliding a drawn five-point star over each mask and keeping the
peaks (template matching with non-maximum suppression), at a few sizes around the profile's star height. A white star
must also have a darker rim (GTA outlines its stars), which bright scenery rarely has."""

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


def _peaks(mask, size, min_score, template=None):
    """Star-shaped places in a 0/1 mask: [(cx, cy, score)] after non-maximum suppression."""
    t = template if template is not None else star_template(size)
    if t.shape[0] != size:
        t = (cv2.resize(t.astype(np.uint8), (size, size), interpolation=cv2.INTER_NEAREST) > 0).astype(np.uint8)
    if mask.shape[0] < size or mask.shape[1] < size:
        return []
    # Correlation of a zero-mean star with the mask: high only where the mask looks like a star (its points and the
    # gaps between them), not merely where it is filled.
    tf = t.astype(np.float32) * 2 - 1
    score = cv2.matchTemplate(mask.astype(np.float32), tf, cv2.TM_CCOEFF_NORMED)
    out = []
    sc = score.copy()
    gap = max(2, int(size * 0.75))
    while True:
        _, mx, _, (x, y) = cv2.minMaxLoc(sc)
        if mx < min_score:
            break
        out.append((x + size / 2, y + size / 2, float(mx)))
        sc[max(0, y - gap):y + gap + 1, max(0, x - gap):x + gap + 1] = -1
        if len(out) > 12:
            break
    return out


def _has_rim(v, cx, cy, size, drop):
    """A darker ring just outside the star than inside it."""
    t = star_template(size)
    x0, y0 = int(round(cx - size / 2)), int(round(cy - size / 2))
    if x0 < 2 or y0 < 2 or x0 + size + 2 > v.shape[1] or y0 + size + 2 > v.shape[0]:
        return False
    big = np.zeros((size + 4, size + 4), np.uint8)
    big[2:-2, 2:-2] = t
    ring = cv2.dilate(big, np.ones((3, 3), np.uint8)) - big
    win = v[y0 - 2:y0 + size + 2, x0 - 2:x0 + size + 2]
    inside = win[2:-2, 2:-2][t > 0]
    rim = win[ring > 0]
    return rim.size > 0 and float(np.median(inside)) - float(np.median(rim)) >= drop


def _row(found, size):
    """The stars that share one row (the wanted row): the largest group on a common line."""
    if not found:
        return []
    best = []
    for _, cy, _ in found:
        grp = [f for f in found if abs(f[1] - cy) <= size * 0.4]
        if len(grp) > len(best):
            best = grp
    return sorted(best)


def _slot_score(c, cx, cy, size, jitter):
    """How star-like the slot at (cx, cy) is: (white score, grey score). The star's own colour is taken from the
    slot's middle, and a star pixel is one of that colour that differs from what surrounds the slot, so white,
    grey (and a new game's coloured) stars all read, whatever the picture behind them."""
    half = size // 2 + jitter + 4
    x0, y0 = int(round(cx)) - half, int(round(cy)) - half
    x1, y1 = x0 + 2 * half, y0 + 2 * half
    if x0 < 0 or y0 < 0 or x1 > c.shape[1] or y1 > c.shape[0]:
        return 0.0, 0.0
    win = c[y0:y1, x0:x1]
    hsv = cv2.cvtColor(win, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.int16)
    k = max(2, size // 8)
    core = v[half - k:half + k + 1, half - k:half + k + 1]
    centre = int(np.median(core))
    border = np.concatenate([v[:3].ravel(), v[-3:].ravel(), v[:, :3].ravel(), v[:, -3:].ravel()])
    # What surrounds the slot: the border values least like the middle.
    far = border[np.argsort(-np.abs(border - centre))][: max(8, border.size // 3)]
    bg = int(np.median(far))
    if abs(centre - bg) < 30 or centre < 55:
        return 0.0, 0.0
    m = ((np.abs(v - centre) < 28) & (hsv[..., 1] < 90)).astype(np.float32)
    t = star_template(size).astype(np.float32) * 2 - 1
    score = float(cv2.matchTemplate(m, t, cv2.TM_CCOEFF_NORMED).max())
    return (score, 0.0) if centre >= 200 else (0.0, score)


def read_slots(frame, profile):
    """The level from the profile's fixed star slots (GTA V draws the five slots in the same place every time). `y`
    may list more than one row (GTA V moves the stars down while the cash is shown); the row with most stars wins."""
    sl = profile.get("wanted", "slots")
    H, W = frame.shape[:2]
    size = max(8, int(round(sl["size"] * H)))
    thr = profile.get("wanted", "minScore", default=0.7)
    jitter = max(2, size // 8)
    rows = sl["y"] if isinstance(sl["y"], list) else [sl["y"]]
    best = {"stars": 0, "dim": 0, "score": 0.0, "slots": "-" * len(sl["x"])}
    for fy in rows:
        marks = []
        for fx in sl["x"]:
            w, g = _slot_score(frame, fx * W, fy * H, size, jitter)
            marks.append("w" if w >= thr and w >= g else ("g" if g >= thr else "-"))
        # Filled stars run from the first slot; a lone "star" further along is scenery.
        lead = 0
        for m in marks:
            if m == "-":
                break
            lead += 1
        if lead <= best["stars"] + best["dim"]:
            continue
        whites = marks[:lead].count("w")
        greys = lead - whites
        best = {"stars": lead if whites >= greys else 0, "dim": lead if greys > whites else 0, "score": 1.0,
                "slots": "".join(marks), "row": round(fy, 4)}
    return best


def read_wanted(frame, profile, template=None):
    """{'stars': white filled, 'dim': grey filled (the search phase), 'score', 'xs'}; zeros when none."""
    if profile.get("wanted", "slots"):
        return read_slots(frame, profile)
    box = profile.get("wanted", "box")
    if not box:
        return {"stars": 0, "dim": 0, "score": 0.0}
    c = crop(frame, box)
    if c.size == 0:
        return {"stars": 0, "dim": 0, "score": 0.0}
    H = frame.shape[0]
    base = max(6, int(round(profile.get("wanted", "starHeight", default=0.03) * H)))
    min_score = profile.get("wanted", "minScore", default=0.6)
    level = profile.get("wanted", "filledLevel", default=150)
    edge = profile.get("wanted", "edgeDrop", default=50)
    mx = profile.get("wanted", "max", default=5)
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.int16)
    grey = hsv[..., 1] < 70
    # Judged against the region's own background, so a bright sky behind the HUD is not read as stars.
    med = int(np.median(v))
    lit = max(level, med + 35)
    white = (grey & (v >= lit)).astype(np.uint8)
    greyf = (grey & (v >= 55) & (v < lit) & (np.abs(v - med) > 25)).astype(np.uint8)
    best = {"stars": 0, "dim": 0, "score": 0.0, "xs": []}
    best_key = (0, 0.0)
    for f in (0.8, 0.9, 1.0, 1.1, 1.25):
        size = max(6, int(round(base * f)))
        w = [p for p in _peaks(white, size, min_score, template) if _has_rim(v, p[0], p[1], size, edge)]
        g = _peaks(greyf, size, min_score, template)
        w, g = _row(w, size), _row(g, size)
        # One row: grey stars are only counted on the white stars' row (or alone, in the search phase).
        if w and g:
            cy = np.median([p[1] for p in w])
            g = [p for p in g if abs(p[1] - cy) <= size * 0.4 and all(abs(p[0] - q[0]) > size * 0.6 for q in w)]
        n = len(w) + len(g)
        scores = [p[2] for p in w + g]
        key = (n, float(np.mean(scores)) if scores else 0.0)
        if n and key > best_key:
            best_key = key
            best = {"stars": min(len(w), mx), "dim": min(len(g), mx), "score": round(key[1], 3),
                    "xs": [int(p[0]) for p in w + g]}
    return best
