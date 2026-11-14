"""Synthetic checks with known answers: stars drawn on noisy backgrounds must be counted, and a drive over a drawn
road map, seen through a tilted, turning radar, must be stitched back with its path. Prints JSON; exit 1 on a fault."""

import json
import math

import cv2
import numpy as np

from .minimap import Minimap
from .mosaic import Atlas, Tracker
from .profile import Profile
from .stars import read_wanted, star_template

PROFILE = {
    "game": "synthetic",
    "minimap": {
        "box": [0.02344, 0.7963, 0.17188, 0.95741],
        "player": [0.09531, 0.9],
        "tilt": {"k": 6.264, "a": 0.56},
        "trim": [0.042, 0.115, 0.042, 0.0],
        "playerMaskRadius": 0.0148,
    },
    "wanted": {"box": [0.74, 0.02, 0.995, 0.17], "max": 5, "starHeight": 0.03, "minScore": 0.55, "filledLevel": 150},
}


def road_map(size=2400, seed=7):
    rng = np.random.default_rng(seed)
    m = np.full((size, size, 3), 52, np.uint8)
    for _ in range(140):
        x, y = rng.integers(0, size, 2)
        r = int(rng.integers(20, 90))
        cv2.circle(m, (int(x), int(y)), r, (int(rng.integers(70, 110)),) * 3, -1)
    for _ in range(260):
        p = rng.integers(0, size, 4)
        cv2.line(m, (int(p[0]), int(p[1])), (int(p[2]), int(p[3])), (int(rng.integers(150, 200)),) * 3, int(rng.integers(3, 9)))
    for _ in range(80):
        x, y = rng.integers(0, size, 2)
        w, h = rng.integers(30, 120, 2)
        cv2.rectangle(m, (int(x), int(y)), (int(x + w), int(y + h)), (int(rng.integers(110, 160)),) * 3, -1)
    return cv2.GaussianBlur(m, (3, 3), 0)


def render_radar(world, pos, heading, mm, zoom=1.0, W=1920, H=1080):
    """A full frame whose radar shows `world` around pos, turned by heading, tilted as the profile says."""
    frame = np.full((H, W, 3), 90, np.uint8)
    x0, y0, x1, y1 = mm.box
    bw, bh = x1 - x0, y1 - y0
    # Top-down picture coordinates -> world: rotate about the player, scale by zoom.
    c, s = math.cos(math.radians(heading)), math.sin(math.radians(heading))
    P = mm.player
    A = np.array([[c * zoom, -s * zoom, 0], [s * zoom, c * zoom, 0], [0, 0, 1.0]])
    T = np.array([[1, 0, pos[0]], [0, 1, pos[1]], [0, 0, 1.0]]) @ A @ np.array([[1, 0, -P[0]], [0, 1, -P[1]], [0, 0, 1.0]])
    # radar crop -> top-down (mm.Hu) -> world
    M = T @ mm.Hu
    crop = cv2.warpPerspective(world, np.linalg.inv(M), (bw, bh), flags=cv2.INTER_LINEAR | cv2.WARP_FILL_OUTLIERS)
    frame[y0:y1, x0:x1] = crop
    cv2.drawMarker(frame, (int(x0 + mm.C[0]), int(y0 + mm.C[1])), (240, 240, 240), cv2.MARKER_TRIANGLE_UP, 14, 2)
    return frame


def check_stars():
    prof = Profile(PROFILE)
    out = []
    rng = np.random.default_rng(3)
    for n in range(0, 6):
        for bg in (30, 120, 200):
            f = np.full((1080, 1920, 3), bg, np.uint8)
            f = np.clip(f.astype(np.int16) + rng.integers(-12, 12, f.shape), 0, 255).astype(np.uint8)
            t = star_template(32) * 255
            for i in range(5):
                x = 1870 - (5 - i) * 40
                y = 110
                lit = i >= 5 - n
                col = 250 if lit else 95
                patch = f[y - 16:y + 16, x - 16:x + 16]
                patch[t > 0] = col
                # GTA outlines its stars in black, so they read on a bright sky too.
                edge = cv2.dilate(t, np.ones((3, 3), np.uint8)) - t
                patch[edge > 0] = 0
            r = read_wanted(f, prof)
            out.append({"truth": n, "bg": bg, "read": r["stars"], "ok": r["stars"] == n})
    return out


def check_stitch():
    prof = Profile(PROFILE)
    mm = Minimap(prof, 1920, 1080)
    world = road_map()
    atlas = Atlas("synthetic")
    tr = Tracker(atlas)
    tr._player = tuple(mm.player)
    pos = np.array([900.0, 1500.0])
    heading = 0.0
    truth, got = [], []
    for i in range(80):
        heading += 6 * math.sin(i / 9)
        step = np.array([math.sin(math.radians(heading)), -math.cos(math.radians(heading))]) * 9
        pos = pos + step
        f = render_radar(world, pos, heading, mm)
        img, msk = mm.flat(f)
        p = tr.track(img, msk, i / 2)
        if p.get("island"):
            truth.append(pos.copy())
            got.append((p["x"], p["y"]))
    truth, got = np.array(truth), np.array(got, np.float64)
    # Positions are in the island's own frame: align with one similarity, then measure.
    S, _ = cv2.estimateAffinePartial2D(got.astype(np.float32), truth.astype(np.float32))
    al = got @ S[:, :2].T + S[:, 2]
    err = np.linalg.norm(al - truth, axis=1)
    path = float(np.sum(np.linalg.norm(np.diff(truth, axis=0), axis=1)))
    return {"frames": 80, "placed": int(len(got)), "islands": len(atlas.islands), "medianError": round(float(np.median(err)), 2),
            "maxError": round(float(err.max()), 2), "pathLength": round(path, 1), "scale": round(float(np.hypot(S[0, 0], S[1, 0])), 3),
            "ok": bool(len(got) >= 76 and np.median(err) < 6 and err.max() < 25 and len(atlas.islands) == 1)}


def run(only=None):
    stars = check_stars()
    stitch = check_stitch() if only != "stars" else {"ok": True}
    ok = all(s["ok"] for s in stars) and stitch["ok"]
    print(json.dumps({"ok": ok, "stars": {"cases": len(stars), "right": sum(s["ok"] for s in stars),
                                         "wrong": [s for s in stars if not s["ok"]]}, "stitch": stitch}))
    return 0 if ok else 1
