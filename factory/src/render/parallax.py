"""2.5D layers for the long videos' stills (src/render/parallax.ts): a depth model splits each picture into
background, middle and foreground; the renderer drifts them at different speeds so key art and
screenshots move like footage (owner, 27 Oct 2026: "huge overhauls").

Depth Anything V2 (small) on CUDA (the PC), MPS (the Mac) or the CPU. Each layer's hole, where the
nearer layer will slide away, is painted in from its surroundings so nothing shows twice. A picture
with no real depth (a menu, a logo, text) is skipped.

Usage: python parallax.py <jobs.json> <out.json>
  jobs.json: [{"src": "path/to/image.jpg", "prefix": "path/to/image"}, ...]
  out.json:  {"done": [{"src", "bg", "mid", "fg"}], "skipped": [{"src", "why"}]}
A job with "mesh": true makes the 3D photo's maps instead (src/render/orbit.ts):
  {"src", "depth", "far", "farDepth", "pivot", "grid"}
and "fill": "pushpull" paints the place behind the subject with fill_bg (PARALLAX_DEEP) instead of fill.
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


def pushpull(rgb, known):
    """Fills the unknown pixels from the known ones only, coarse to fine (push-pull): each level averages just the
    known pixels, and a hole takes the coarser level's colour where it has no known pixels of its own. No pixel of
    the cut-out subject is ever sampled, so no ghost of it shows behind the camera move."""
    c = rgb.astype(np.float32) * known[..., None]
    w = known.astype(np.float32)
    pyr = []
    while min(w.shape) > 8:
        pyr.append((c, w))
        c, w = cv2.pyrDown(c), cv2.pyrDown(w)
    out = c / np.maximum(w, 1e-4)[..., None]
    for c, w in reversed(pyr):
        h, ww = w.shape
        up = cv2.resize(out, (ww, h), interpolation=cv2.INTER_LINEAR)
        a = np.clip(w * 1.6, 0, 1)[..., None]
        out = (c / np.maximum(w, 1e-4)[..., None]) * a + up * (1 - a)
    return out


def fill_bg(rgb, hole, seed=7):
    """PARALLAX_DEEP's background behind the subject (src/render/depthcam.ts): push-pull from the background only,
    then the picture's own grain laid back over the paint, so the revealed strip reads as more of the same place
    instead of a smooth smear. Cheap enough for the Mac (no generative model: those need this PC's GPU, and the
    FLUX Fill weights here are licensed for non-commercial use only)."""
    known = ~hole
    if not known.any():
        return rgb
    out = pushpull(rgb, known)
    f = rgb.astype(np.float32)
    detail = f - cv2.GaussianBlur(f, (0, 0), 1.5)
    ring = cv2.dilate(hole.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool) & known
    std = detail[ring].std(axis=0) if ring.sum() > 64 else np.array([3.0, 3.0, 3.0])
    rng = np.random.default_rng(seed)
    noise = cv2.GaussianBlur(rng.normal(0, 1, rgb.shape).astype(np.float32), (0, 0), 0.7) * (std * 1.6)
    out = out + noise
    a = soft(hole, 3)[..., None]
    return np.clip(out * a + f * (1 - a), 0, 255).astype(np.uint8)


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


GRID_W, GRID_H = 32, 18  # the subject's footprint, cell by cell, for the pop-out's fit test (src/render/popout.ts)


def grid_of(mask):
    """The share of each cell the subject covers, one digit 0-9 a cell, row by row."""
    small = cv2.resize(mask.astype(np.float32), (GRID_W, GRID_H), interpolation=cv2.INTER_AREA)
    return "".join(str(int(min(9, round(v * 9)))) for v in small.flatten())


def mesh(pipe, src, prefix, better=False):
    """The 3D photo's maps (src/render/orbit.ts): the depth map, sharpened so the subject's edge carries its own
    depth (a soft map paints a halo of background onto the subject when the camera turns); the picture with the
    subject painted out and that hidden place's own depth, the surface behind the cut; and the subject's
    footprint grid."""
    img = Image.open(src).convert("RGB")
    if img.width > MAX_W:
        img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
    rgb = np.array(img)
    h, w = rgb.shape[:2]
    d = pipe(img)["predicted_depth"].squeeze().float().cpu().numpy()
    d = cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC)
    d = (d - d.min()) / max(1e-6, d.max() - d.min())
    if d.std() < 0.08:
        return None, "flat"
    near_t = np.quantile(d, NEAR_Q)
    fg = d >= near_t
    if fg.mean() < 0.03:
        return None, "no foreground"
    # Edge-true depth: a median kills speckle, then the near side grows two pixels so the subject's own
    # outline (anti-aliased in the picture) moves with the subject rather than with the wall behind it.
    d8 = (d * 255).astype(np.uint8)
    d8 = cv2.medianBlur(d8, 5)
    d8 = cv2.dilate(d8, np.ones((5, 5), np.uint8))
    grow = lambda m, r: cv2.dilate(m.astype(np.uint8), np.ones((r, r), np.uint8)).astype(bool)
    hole = grow(fg, 31)
    far_rgb = fill_bg(rgb, hole) if better else fill(rgb, hole, hole)
    # The hidden place's depth: the hole painted from the depth around it, so the far surface is a wall,
    # never a dent where the subject stood.
    small = cv2.resize(d8, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    sh = cv2.resize(hole.astype(np.uint8) * 255, (w // 2, h // 2), interpolation=cv2.INTER_NEAREST)
    far_d = cv2.resize(cv2.inpaint(small, sh, 8, cv2.INPAINT_TELEA), (w, h), interpolation=cv2.INTER_LINEAR)
    far_d = np.where(hole, np.minimum(far_d, int(near_t * 255) - 8), d8).astype(np.uint8)
    # Saved at the picture's own working size (at most MAX_W), the size the surface is cut at: the old 1,024-wide
    # map, shrunk by nearest neighbour, cut the subject's edge in steps of 3 to 4 px once a Short's crop magnified it.
    Image.fromarray(d8).save(f"{prefix}.depth.png")
    Image.fromarray(far_d).save(f"{prefix}.fardepth.png")
    Image.fromarray(far_rgb).save(f"{prefix}.far.webp", quality=90)
    # The subject's depth (the pivot the camera swings round) and footprint.
    pivot = float(np.median(d[fg]))
    return {
        "src": src,
        "depth": f"{prefix}.depth.png",
        "far": f"{prefix}.far.webp",
        "farDepth": f"{prefix}.fardepth.png",
        "pivot": round(pivot, 3),
        "grid": grid_of(fg),
    }, None


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    from transformers import pipeline

    pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device())
    done, skipped = [], []
    for j in jobs:
        try:
            if j.get("mesh"):
                r, why = mesh(pipe, j["src"], j["prefix"], better=j.get("fill") == "pushpull")
            else:
                r, why = layers(pipe, j["src"], j["prefix"])
            (done.append(r) if r else skipped.append({"src": j["src"], "why": why}))
        except Exception as e:  # one bad picture never stops the rest
            skipped.append({"src": j["src"], "why": str(e)[:200]})
    json.dump({"done": done, "skipped": skipped}, open(sys.argv[2], "w", encoding="utf-8"))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
