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
    "wanted": {"box": [0.74, 0.02, 0.995, 0.17], "max": 5, "minScore": 0.7,
               "slots": {"x": [0.90885, 0.92344, 0.93802, 0.95313, 0.96771], "y": 0.03796, "size": 0.03056}},
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
    """GTA V's look: touching filled stars (white when seen, grey in the search), empty slots as outlines."""
    prof = Profile(PROFILE)
    out = []
    rng = np.random.default_rng(3)
    size = 28
    t = star_template(size)
    xs = [1745, 1773, 1801, 1830, 1858]
    edge = cv2.dilate(t, np.ones((3, 3), np.uint8)) - t
    for n in range(0, 6):
        for phase in ("white", "grey"):
            for bg in (30, 120, 200):
                f = np.full((1080, 1920, 3), bg, np.uint8)
                f = np.clip(f.astype(np.int16) + rng.integers(-12, 12, f.shape), 0, 255).astype(np.uint8)
                for i in range(5):
                    x, y = xs[i], 41  # the slots, side by side and touching
                    patch = f[y - size // 2:y + size // 2, x - size // 2:x + size // 2]
                    if i < n:
                        col = 245 if phase == "white" else (95 if bg > 140 else 160)
                        patch[t > 0] = col
                        patch[edge > 0] = 0
                    else:
                        patch[edge > 0] = 0 if bg > 90 else 230  # an empty slot: the outline only
                r = read_wanted(f, prof)
                got = r["stars"] if phase == "white" else r["dim"]
                other = r["dim"] if phase == "white" else r["stars"]
                out.append({"truth": n, "phase": phase, "bg": bg, "read": got, "other": other, "ok": got == n and other == 0})
    return out


GTA6 = {
    "game": "synthetic6",
    "minimap": {"box": [0.01667, 0.81852, 0.17396, 0.97407], "player": [0.09479, 0.93796],
                "frame": {"minShare": 0.7, "step": 22, "reach": 0.003, "corner": 0.12, "points": 12,
                          "arrow": {"ring": 0.45, "core": 0.3}}},
    "wanted": {"max": 6, "minScore": 0.7, "fill": "right", "emptyDarker": True, "outlines": True,
               "slots": {"x": [0.88125, 0.9, 0.91927, 0.93854, 0.95677, 0.975], "y": [0.03981], "size": 0.025}},
}


def check_stars6():
    """GTA VI's look: six slots, the level lit from the right in light grey, empty slots as dark see-through stars,
    which must never count, on a dark or a bright sky."""
    prof = Profile(GTA6)
    out = []
    rng = np.random.default_rng(5)
    size = 27
    t = star_template(size)
    xs = [1692, 1728, 1765, 1802, 1837, 1872]
    for n in range(0, 7):
        for bg in (40, 110, 190):
            f = np.full((1080, 1920, 3), bg, np.uint8)
            f = np.clip(f.astype(np.int16) + rng.integers(-10, 10, f.shape), 0, 255).astype(np.uint8)
            for i, x in enumerate(xs):
                y = 43
                patch = f[y - size // 2:y - size // 2 + size, x - size // 2:x - size // 2 + size]
                lit = i >= 6 - n
                patch[t > 0] = 235 if lit and bg > 150 else (175 if lit else max(0, bg - 45))
            r = read_wanted(f, prof)
            level = r["stars"] + r["dim"]
            out.append({"truth": n, "bg": bg, "read": level, "slots": r.get("slots"), "ok": level == n})
    # The search phase: the level drawn as thin light outlines with a dark rim, the middle see-through.
    edge = t - cv2.erode(t, np.ones((3, 3), np.uint8))
    for n in range(1, 4):
        for bg in (60, 110):
            f = np.full((1080, 1920, 3), bg, np.uint8)
            f = np.clip(f.astype(np.int16) + rng.integers(-10, 10, f.shape), 0, 255).astype(np.uint8)
            for i, x in enumerate(xs):
                patch = f[43 - size // 2:43 - size // 2 + size, x - size // 2:x - size // 2 + size]
                if i >= 6 - n:
                    rim = cv2.dilate(edge, np.ones((3, 3), np.uint8)) - edge
                    patch[rim > 0] = 20
                    patch[edge > 0] = 240
                else:
                    patch[t > 0] = max(0, bg - 45)
            r = read_wanted(f, prof)
            level = r["stars"] + r["dim"]
            out.append({"truth": n, "bg": bg, "outline": True, "read": level, "slots": r.get("slots"), "ok": level == n})
    return out


def check_frame():
    """GTA VI has no health strip: live play is told by the radar's thin light outline, which scenery lacks."""
    from .screens import classify

    prof = Profile(GTA6)
    rng = np.random.default_rng(9)
    out = []
    for drawn in (True, False):
        for bg in (30, 120, 200):
            f = np.clip(np.full((1080, 1920, 3), bg, np.int16) + rng.integers(-15, 15, (1080, 1920, 3)), 0, 255).astype(np.uint8)
            if drawn:
                x0, y0, x1, y1 = 32, 884, 334, 1052
                f[y0 + 2:y1 - 2, x0 + 2:x1 - 2] = (f[y0 + 2:y1 - 2, x0 + 2:x1 - 2] * 0.5 + 40).astype(np.uint8)
                cv2.rectangle(f, (x0, y0), (x1, y1), (bg + 60 if bg < 150 else bg - 90,) * 3, 2)
            state, _ = classify(f, prof)
            out.append({"drawn": drawn, "bg": bg, "state": state, "ok": (state == "hud") == drawn})
    # A bright scene that hides the outline: the player arrow (a dark disc with a white arrow) still tells live play.
    for arrow in (True, False):
        f = np.clip(np.full((1080, 1920, 3), 200, np.int16) + rng.integers(-15, 15, (1080, 1920, 3)), 0, 255).astype(np.uint8)
        if arrow:
            cx, cy = int(round(0.09479 * 1920)), int(round(0.93796 * 1080))
            cv2.circle(f, (cx, cy), 9, (30, 30, 30), -1)
            cv2.fillPoly(f, [np.array([[cx, cy - 5], [cx - 4, cy + 4], [cx + 4, cy + 4]], np.int32)], (245, 245, 245))
        state, _ = classify(f, prof)
        out.append({"arrow": arrow, "state": state, "ok": (state == "hud") == arrow})
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
    stars6 = check_stars6()
    frame = check_frame()
    stitch = check_stitch() if only != "stars" else {"ok": True}
    ok = all(s["ok"] for s in stars + stars6 + frame) and stitch["ok"]
    print(json.dumps({"ok": ok, "stars": {"cases": len(stars), "right": sum(s["ok"] for s in stars),
                                         "wrong": [s for s in stars if not s["ok"]]},
                      "stars6": {"cases": len(stars6), "right": sum(s["ok"] for s in stars6),
                                 "wrong": [s for s in stars6 if not s["ok"]]},
                      "frame": {"cases": len(frame), "right": sum(s["ok"] for s in frame),
                                "wrong": [s for s in frame if not s["ok"]]}, "stitch": stitch}))
    return 0 if ok else 1
