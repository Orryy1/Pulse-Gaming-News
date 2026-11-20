"""On-screen text through RapidOCR with PaddleOCR's PP-OCRv4 models (both Apache-2.0, run on ONNX Runtime, MIT):
free, local and allowed commercially. A region is read again only when it has changed, so a 30-minute stream costs a
few hundred reads, not thousands."""

import sys

import cv2
import numpy as np


class Reader:
    def __init__(self, libs=None):
        self.engine = None
        self.error = None
        if libs and libs not in sys.path:
            sys.path.insert(0, libs)
        try:
            from rapidocr_onnxruntime import RapidOCR  # noqa: E402

            self.engine = RapidOCR()
        except Exception as e:  # missing package or model: text is simply not read
            self.error = f"{type(e).__name__}: {e}"
        self.reads = 0

    @property
    def ok(self):
        return self.engine is not None

    def read(self, img, upscale=2.0, min_conf=0.6):
        """[(text, confidence, (x0, y0, x1, y1) in img pixels)] for one crop."""
        if not self.ok or img is None or img.size == 0:
            return []
        im = img
        if upscale != 1.0:
            im = cv2.resize(img, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
        self.reads += 1
        try:
            res, _ = self.engine(im)
        except Exception:
            return []
        out = []
        for box, text, conf in res or []:
            conf = float(conf)
            if conf < min_conf or not str(text).strip():
                continue
            xs = [p[0] / upscale for p in box]
            ys = [p[1] / upscale for p in box]
            out.append((str(text).strip(), round(conf, 3), (min(xs), min(ys), max(xs), max(ys))))
        return out


def has_text(img, frame_h=1080, min_glyphs=3):
    """Cheap test before reading: HUD writing is near-white glyphs of text height with a darker edge around them
    (GTA outlines or backs its text). Sky, fog and girders make huge or hairline blobs and fail it."""
    if img is None or img.size == 0:
        return False
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    white = ((hsv[..., 2] > 200) & (hsv[..., 1] < 60)).astype(np.uint8)
    if white.mean() > 0.35:
        return False
    n, lab, stats, _ = cv2.connectedComponentsWithStats(white, connectivity=8)
    lo, hi = max(5, int(0.010 * frame_h)), int(0.07 * frame_h)
    glyphs = 0
    v = hsv[..., 2]
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (lo <= h <= hi) or w > 3 * hi or area < 12:
            continue
        x0, y0, x1, y1 = max(0, x - 3), max(0, y - 3), min(img.shape[1], x + w + 3), min(img.shape[0], y + h + 3)
        ring = v[y0:y1, x0:x1][lab[y0:y1, x0:x1] != i]
        if ring.size and float(np.percentile(ring, 25)) < 150:
            glyphs += 1
            if glyphs >= min_glyphs:
                return True
    return False


def clean_lines(found, min_alnum=3, min_conf=0.8):
    """Readings worth keeping: mostly Latin letters and digits, three or more of them, read with confidence."""
    out = []
    for text, conf, box in found:
        t = text.strip()
        alnum = sum(ch.isascii() and ch.isalnum() for ch in t)
        ascii_share = sum(ch.isascii() for ch in t) / max(1, len(t))
        if conf >= min_conf and alnum >= min_alnum and ascii_share >= 0.9:
            out.append((t, conf, box))
    return out


class ChangeGate:
    """Says when a region looks different enough from the last time it was read to be worth reading again."""

    def __init__(self, threshold=10.0, refresh=20.0):
        self.last = {}
        self.threshold = threshold
        self.refresh = refresh

    def changed(self, key, img, t, min_gap=1.5):
        if img is None or img.size == 0:
            return False
        prev = self.last.get(key)
        # Game text stays up for seconds: one read a region every min_gap seconds is enough to catch it.
        if prev is not None and t - prev[1] < min_gap:
            return False
        thumb = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (64, 24), interpolation=cv2.INTER_AREA).astype(np.float32)
        prev = self.last.get(key)
        if prev is None or t - prev[1] >= self.refresh or float(np.abs(thumb - prev[0]).mean()) >= self.threshold:
            self.last[key] = (thumb, t)
            return True
        return False
