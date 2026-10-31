"""2.5D layers for the long videos' stills (src/render/parallax.ts): a depth model splits each picture into
background, middle and foreground; the renderer drifts them at different speeds so key art and
screenshots move like footage (owner, 27 Oct 2026: "huge overhauls").

Depth Anything V2 (small) on CUDA (the PC), MPS (the Mac) or the CPU. Each layer's hole, where the
nearer layer will slide away, is painted in from its surroundings so nothing shows twice. A picture
with no real depth (a menu, a logo, text) is skipped.

Usage: python parallax.py <jobs.json> <out.json>
  jobs.json: [{"src": "path/to/image.jpg", "prefix": "path/to/image"}, ...]
  out.json:  {"done": [{"src", "bg", "mid", "fg"}], "skipped": [{"src", "why"}]}
"""
import json
import os
import sys

import numpy as np
import cv2
from PIL import Image

MAX_W = 1920
NEAR_Q, MID_Q = 0.80, 0.50  # depth quantiles: the nearest fifth is foreground, the next three tenths middle
FEATHER = 9  # px of soft edge on a layer's mask


def device():
    import torch

    if torch.cuda.is_available():
        return 0
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return -1


def soft(mask, r):
    k = r * 2 + 1
    return cv2.GaussianBlur(mask.astype(np.float32), (k, k), r / 2)


def fill(rgb, hole, inside):
    """Paints a hole in from its surroundings, at half size (fast; the revealed edges are small). The
    hole is the cut-out grown a little, so no edge colour of the nearer layer bleeds into the paint, but
    the paint only goes where the nearer layer sits (`inside`): around it the picture stays as it was,
    or a smeared halo shows even before anything moves."""
    h, w = hole.shape
    small = cv2.resize(rgb, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    sh = cv2.resize(hole.astype(np.uint8) * 255, (w // 2, h // 2), interpolation=cv2.INTER_NEAREST)
    painted = cv2.inpaint(small, sh, 6, cv2.INPAINT_TELEA)
    big = cv2.resize(painted, (w, h), interpolation=cv2.INTER_CUBIC)
    a = soft(inside, FEATHER)[..., None]
    return (big * a + rgb * (1 - a)).astype(np.uint8)


def layers(pipe, src, prefix):
    img = Image.open(src).convert("RGB")
    if img.width > MAX_W:
        img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
    rgb = np.array(img)
    h, w = rgb.shape[:2]
    out = pipe(img)
    d = out["predicted_depth"]
    d = d.squeeze().float().cpu().numpy()
    d = cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC)
    d = (d - d.min()) / max(1e-6, d.max() - d.min())  # near is 1
    if d.std() < 0.08:
        return None, "flat"
    near_t, mid_t = np.quantile(d, [NEAR_Q, MID_Q])
    fg = d >= near_t
    mid = d >= mid_t
    if fg.mean() < 0.03:
        return None, "no foreground"
    grow = lambda m, r: cv2.dilate(m.astype(np.uint8), np.ones((r, r), np.uint8)).astype(bool)
    bg_rgb = fill(rgb, grow(mid, 25), mid)
    mid_rgb = fill(rgb, grow(fg, 25), fg)
    mid_a = (soft(mid, FEATHER) * 255).astype(np.uint8)
    fg_a = (soft(fg, FEATHER) * 255).astype(np.uint8)
    Image.fromarray(bg_rgb).save(f"{prefix}.bg.webp", quality=88)
    Image.fromarray(np.dstack([mid_rgb, mid_a])).save(f"{prefix}.mid.webp", quality=88)
    Image.fromarray(np.dstack([rgb, fg_a])).save(f"{prefix}.fg.webp", quality=88)
    # Where the subject stands across the picture (0 left to 1 right): thumbnails set the headline on the other side.
    cols = fg.mean(axis=0)
    fgx = float((cols * np.arange(w)).sum() / max(1e-6, cols.sum()) / w)
    return {"src": src, "bg": f"{prefix}.bg.webp", "mid": f"{prefix}.mid.webp", "fg": f"{prefix}.fg.webp", "fgx": round(fgx, 3)}, None


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    from transformers import pipeline

    pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device())
    done, skipped = [], []
    for j in jobs:
        try:
            r, why = layers(pipe, j["src"], j["prefix"])
            (done.append(r) if r else skipped.append({"src": j["src"], "why": why}))
        except Exception as e:  # one bad picture never stops the rest
            skipped.append({"src": j["src"], "why": str(e)[:200]})
    json.dump({"done": done, "skipped": skipped}, open(sys.argv[2], "w", encoding="utf-8"))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
