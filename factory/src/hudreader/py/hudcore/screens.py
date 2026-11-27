"""What kind of screen a frame is: live play with the HUD on it, the pause menu or map, black, or something else
(loading screens, cutscenes, the phone over a hidden HUD). Only `hud` frames are read for the minimap and stars."""

import cv2
import numpy as np

from .profile import crop, px_box


def bars_share(frame, profile):
    """The share of the minimap's health and armour strip that is coloured (GTA V: green, blue and yellow bars)."""
    box = profile.get("minimap", "bars", "box")
    if not box:
        return 0.0
    c = crop(frame, box)
    if c.size == 0:
        return 0.0
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
    col = (hsv[..., 1] > 70) & (hsv[..., 2] > 70)
    # A column counts when most of its rows are coloured, so a bright sky behind the strip does not.
    return float((col.mean(axis=0) > 0.5).mean())


def menu_score(frame, profile):
    """The pause menu's tab row: mostly dark boxes with one bright selected tab."""
    box = profile.get("menu", "tabs")
    if not box:
        return 0.0
    c = crop(frame, box)
    if c.size == 0:
        return 0.0
    v = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)[..., 2]
    dark = float((v < 70).mean())
    bright_cols = (v > 200).mean(axis=0) > 0.5
    # The selected tab is one bright run of about a sixth of the row.
    run, best = 0, 0
    for b in bright_cols:
        run = run + 1 if b else 0
        best = max(best, run)
    tab = best / max(1, len(bright_cols))
    return dark if 0.06 <= tab <= 0.3 else dark * 0.5


def frame_share(frame, profile):
    """The share of the minimap's outline that is drawn (GTA VI: a thin light rounded rectangle around the radar, and
    no health strip under it). Points along the four sides, corners left out, each count when the brightness steps
    sharply across the expected edge (within a few pixels): scenery rarely has one straight edge in all four places."""
    fr = profile.get("minimap", "frame")
    box = profile.get("minimap", "box")
    if not fr or not box:
        return 0.0
    H, W = frame.shape[:2]
    x0, y0, x1, y1 = px_box(box, W, H)
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.int16)
    step = int(fr.get("step", 22))
    reach = max(2, int(round(fr.get("reach", 0.003) * H)))
    corner = fr.get("corner", 0.12)
    n = int(fr.get("points", 12))
    hits = total = 0

    def edge_hit(line):
        # Largest brightness step between neighbours two pixels apart, anywhere within `reach` of the edge.
        if line.size < 5:
            return False
        d = np.abs(line[2:] - line[:-2])
        return int(d.max()) >= step

    for i in range(n):
        f = corner + (1 - 2 * corner) * (i + 0.5) / n
        x = int(round(x0 + f * (x1 - x0)))
        y = int(round(y0 + f * (y1 - y0)))
        for line in (
            g[max(0, y0 - reach - 1):min(H, y0 + reach + 2), x],
            g[max(0, y1 - reach - 2):min(H, y1 + reach + 1), x],
            g[y, max(0, x0 - reach - 1):min(W, x0 + reach + 2)],
            g[y, max(0, x1 - reach - 2):min(W, x1 + reach + 1)],
        ):
            total += 1
            hits += edge_hit(line)
    return hits / max(1, total)


def arrow_seen(frame, profile):
    """GTA VI's player arrow: a dark disc with a white arrow in it, always at the same point of the radar. On a bright
    scene the radar's light outline fades into the picture, but the arrow still stands out."""
    ar = profile.get("minimap", "frame", "arrow")
    pl = profile.get("minimap", "player")
    if not ar or not pl:
        return False
    H, W = frame.shape[:2]
    cx, cy = int(round(pl[0] * W)), int(round(pl[1] * H))
    k = H / 1080.0
    R = int(np.ceil(10 * k))
    if cx - R < 0 or cy - R < 0 or cx + R >= W or cy + R >= H:
        return False
    g = cv2.cvtColor(frame[cy - R:cy + R + 1, cx - R:cx + R + 1], cv2.COLOR_BGR2GRAY)
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
    d = np.hypot(xx, yy) / k
    ring = g[(d >= 6) & (d <= 9)]
    core = g[d <= 4]
    return float((ring < 80).mean()) >= ar.get("ring", 0.45) and float((core > 170).mean()) >= ar.get("core", 0.3)


def classify(frame, profile):
    v = cv2.cvtColor(frame[::8, ::8], cv2.COLOR_BGR2GRAY)
    if float(v.mean()) < 12:
        return "black", 0.0
    share = bars_share(frame, profile)
    if share >= profile.get("minimap", "bars", "minShare", default=0.6):
        return "hud", share
    if profile.get("minimap", "frame"):
        fs = frame_share(frame, profile)
        if fs >= profile.get("minimap", "frame", "minShare", default=0.7) or arrow_seen(frame, profile):
            return "hud", fs
    m = menu_score(frame, profile)
    if m >= profile.get("menu", "minDarkShare", default=0.55):
        return "menu", m
    return "other", share
