"""Learns a game's HUD from a few frames of the owner's own footage (for GTA VI on launch day): where the minimap is,
where the player arrow sits in it, how the radar is tilted, where money, area names and banners are written, and how
big the wanted stars are. Starts from a base profile (GTA V's) and writes a new one, plus a preview picture with
every box drawn, which is checked by eye before the profile is used (src/tools/hudreader.ts calibrate).

  --times      seconds to sample (default: 24 spread over the recording)
  --sequence   start,seconds of steady play with the minimap moving, at 2 fps, for the tilt
  --stars      seconds:count of a frame showing a known wanted level, for the stars' size and box
"""

import copy
import json
import os

import cv2
import numpy as np

from . import video
from .minimap import learn_tilt
from .ocr import Reader
from .profile import Profile, crop


def _frames(a, times, W, H):
    out = []
    for t in times:
        f = video.frame_at(a.ffmpeg, a.video, t, W, H)
        if f is not None:
            out.append((t, f))
    return out


def _frac(box, W, H):
    x0, y0, x1, y1 = box
    return [round(x0 / W, 5), round(y0 / H, 5), round(x1 / W, 5), round(y1 / H, 5)]


def find_bars(stack_hsv, mad, W, H):
    """Static saturated horizontal strips (health and armour bars) in the lower half: [(x0, y0, x1, y1)]."""
    sat = np.median(stack_hsv[..., 1], axis=0) > 70
    val = np.median(stack_hsv[..., 2], axis=0) > 70
    static = mad < 10
    m = (sat & val & static).astype(np.uint8)
    m[: H // 2] = 0
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 9), np.uint8)))
    parts = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w > 0.02 * W and h < 0.02 * H and w > 4 * h:
            parts.append([int(x), int(y), int(x + w), int(y + h)])
    # Health, armour and the special bar sit end to end on one row: join pieces on the same row with small gaps.
    parts.sort()
    out = []
    for b in parts:
        last = out[-1] if out else None
        if last and abs((b[1] + b[3]) / 2 - (last[1] + last[3]) / 2) < max(3, (b[3] - b[1])) and b[0] - last[2] < 0.03 * W:
            last[:] = [min(last[0], b[0]), min(last[1], b[1]), max(last[2], b[2]), max(last[3], b[3])]
        else:
            out.append(list(b))
    out = [tuple(b) for b in out if b[2] - b[0] > 0.05 * W]
    return sorted(out, key=lambda b: -(b[2] - b[0]))


def find_minimap(std, sat_mean, W, H, bars, arrow_at=None):
    """The radar's box: above the bar strip when there is one, else the corner whose picture changes most while
    staying grey (a map, not the world)."""
    cands = []
    if bars:
        x0, y0, x1, y1 = bars[0]
        top = max(0, int(y0 - (x1 - x0) * 0.75))
        cands.append((x0, top, x1, y0 - 2))
    cw, ch = int(0.2 * W), int(0.24 * H)
    for cx, cy in ((0, H - ch), (W - cw, H - ch), (0, 0), (W - cw, 0)):
        cands.append((cx, cy, cx + cw, cy + ch))

    def score(b):
        x0, y0, x1, y1 = b
        s = std[y0:y1, x0:x1]
        g = sat_mean[y0:y1, x0:x1]
        base = float(np.mean(s) * (1.0 - np.clip(np.mean(g) / 120.0, 0, 1)))
        # A steady bright marker (the player arrow) inside is the radar's surest sign; open sky has none.
        return base * (3.0 if arrow_at and arrow_at(b) else 1.0)

    # Above the bar strip is where GTA (and Rockstar's other open worlds) draw the radar: it wins unless it is dead.
    if bars and score(cands[0]) > 0.25 * max(score(c) for c in cands):
        best = cands[0]
    else:
        best = max(cands, key=score)
    x0, y0, x1, y1 = best
    # Tighten to the rows and columns that actually change.
    s = std[y0:y1, x0:x1] > max(10.0, float(np.percentile(std[y0:y1, x0:x1], 40)))
    rows = np.where(s.mean(axis=1) > 0.35)[0]
    cols = np.where(s.mean(axis=0) > 0.35)[0]
    if len(rows) > 10 and len(cols) > 10:
        best = (x0 + int(cols.min()), y0 + int(rows.min()), x0 + int(cols.max()) + 1, y0 + int(rows.max()) + 1)
    return best, round(score(best), 2)


def find_arrow(stack_gray, mad, box):
    """The player arrow: the steady bright blob nearest the radar's middle-bottom third."""
    x0, y0, x1, y1 = box
    med = np.median(stack_gray[:, y0:y1, x0:x1], axis=0)
    m = ((med > 170) & (mad[y0:y1, x0:x1] < 12)).astype(np.uint8)
    n, lab, stats, cents = cv2.connectedComponentsWithStats(m)
    want = np.array([(x1 - x0) / 2, (y1 - y0) * 0.62])
    best = None
    for i in range(1, n):
        if not (6 <= stats[i][4] <= 900):
            continue
        d = float(np.linalg.norm(cents[i] - want))
        if best is None or d < best[0]:
            best = (d, cents[i])
    if best is None:
        return (x0 + want[0], y0 + want[1]), False
    return (x0 + float(best[1][0]), y0 + float(best[1][1])), True


def tilt_pairs(frames, box, C):
    sift = cv2.SIFT_create(nfeatures=800)
    bf = cv2.BFMatcher(cv2.NORM_L2)
    x0, y0, x1, y1 = box
    pairs = []
    prev = None
    for _, f in frames:
        c = f[y0:y1, x0:x1]
        hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
        m = ((hsv[..., 1] < 60) & (hsv[..., 2] > 25) & (hsv[..., 2] < 235)).astype(np.uint8) * 255
        cv2.circle(m, (int(C[0]), int(C[1])), 14, 0, -1)
        kp, des = sift.detectAndCompute(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), m)
        if prev is not None and des is not None and prev[1] is not None and len(kp) > 12:
            good = [p[0] for p in bf.knnMatch(des, prev[1], k=2) if len(p) == 2 and p[0].distance < 0.8 * p[1].distance]
            if len(good) >= 12:
                pa = np.float32([kp[g.queryIdx].pt for g in good])
                pb = np.float32([prev[0][g.trainIdx].pt for g in good])
                Hm, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 3.0)
                if inl is not None and inl.sum() >= 12:
                    keep = inl.ravel() > 0
                    pairs.append((pa[keep].astype(np.float64), pb[keep].astype(np.float64)))
        prev = (kp, des)
    return pairs


def text_boxes(reader, frames, W, H, profile):
    """OCR over whole frames, grouped into the money, area and banner boxes."""
    found = {"money": [], "area": [], "banner": [], "centre": []}
    for _, f in frames:
        small = cv2.resize(f, (W // 2 * 2, H // 2 * 2)) if W > 1920 else f
        for text, conf, (bx0, by0, bx1, by1) in reader.read(small, upscale=1.0, min_conf=0.7):
            cx, cy, h = (bx0 + bx1) / 2 / W, (by0 + by1) / 2 / H, (by1 - by0) / H
            b = (bx0, by0, bx1, by1)
            if profile.money_re and profile.money_re.search(text.replace(" ", "")) and cy < 0.3:
                found["money"].append(b)
            elif profile.area_re and profile.area_re.match(text) and cx > 0.6 and cy > 0.8:
                found["area"].append(b)
            elif h > 0.035 and 0.25 < cx < 0.75:
                found["banner" if cy < 0.36 else "centre"].append(b)
    out = {}
    for k, bs in found.items():
        if len(bs) >= 1:
            a = np.array(bs)
            pad_x, pad_y = 0.04 * W, 0.03 * H
            out[k] = _frac((max(0, a[:, 0].min() - pad_x), max(0, a[:, 1].min() - pad_y),
                            min(W, a[:, 2].max() + pad_x), min(H, a[:, 3].max() + pad_y)), W, H)
    return out


def star_boxes(frame, W, H):
    """Star-like shapes in the top right of a frame known to show stars: (box, height, count)."""
    from .stars import _peaks, _row

    x0, y0 = int(0.6 * W), 0
    c = frame[y0:int(0.25 * H), x0:W]
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.int16)
    med = int(np.median(v))
    grey = hsv[..., 1] < 70
    masks = [(grey & (v >= max(150, med + 35))).astype(np.uint8), (grey & (v >= 55) & (np.abs(v - med) > 25)).astype(np.uint8)]
    best, best_size = [], 0
    for m in masks:
        for px in range(int(0.015 * H), int(0.06 * H), 2):
            s = _row(_peaks(m, px, 0.6), px)
            if len(s) > len(best):
                best, best_size = s, px
    if not best:
        return None
    xs = [p[0] for p in best]
    ys = [p[1] for p in best]
    size = best_size
    box = (x0 + min(xs) - 6 * size, y0 + max(0, min(ys) - 2 * size), min(W, x0 + max(xs) + 2 * size), y0 + max(ys) + 2 * size)
    return _frac(box, W, H), round(size / H, 4), len(best)


def run(a):
    base = Profile.load(a.base)
    W, H, dur = video.probe(a.ffprobe, a.video)
    if H > 1080:
        W, H = int(round(W * 1080 / H / 2) * 2), 1080
    times = [float(t) for t in a.times.split(",") if t.strip()] or list(np.linspace(dur * 0.05, dur * 0.95, 24))
    frames = _frames(a, times, W, H)
    if len(frames) < 6:
        raise SystemExit("calibration needs at least 6 frames")
    # Black frames and menus would hide the HUD's steady parts: only frames with picture count, and "steady" is
    # judged robustly (median distance from the median), so a few odd frames cannot spoil it.
    frames = [(t, f) for t, f in frames if float(cv2.cvtColor(f[::8, ::8], cv2.COLOR_BGR2GRAY).mean()) > 15]
    stack = np.stack([f for _, f in frames])
    gray = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in stack]).astype(np.float32)
    hsv = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2HSV) for f in stack])
    std = gray.std(axis=0)
    med = np.median(gray, axis=0)
    mad = np.median(np.abs(gray - med[None]), axis=0)
    sat_mean = hsv[..., 1].astype(np.float32).mean(axis=0)
    bars = find_bars(hsv, mad, W, H)
    if bars:
        # Frames that show the bar strip are frames with the HUD: the radar and its arrow are judged on those only.
        bx0, by0, bx1, by1 = bars[0]
        ref = np.median(stack[:, by0:by1, bx0:bx1].astype(np.float32), axis=0)
        keep = [i for i in range(len(stack)) if float(np.abs(stack[i, by0:by1, bx0:bx1].astype(np.float32) - ref).mean()) < 25]
        if len(keep) >= 4:
            stack, gray, hsv = stack[keep], gray[keep], hsv[keep]
            std = gray.std(axis=0)
            med = np.median(gray, axis=0)
            mad = np.median(np.abs(gray - med[None]), axis=0)
            sat_mean = hsv[..., 1].astype(np.float32).mean(axis=0)
            frames = [frames[i] for i in keep]
    arrow_at = lambda b: find_arrow(gray, mad, b)[1]
    mbox, mscore = find_minimap(std, sat_mean, W, H, bars, arrow_at)
    (ax, ay), arrow_found = find_arrow(gray, mad, mbox)
    prof = copy.deepcopy(base.data)
    prof["game"] = a.game
    prof["label"] = a.game.upper()
    prof["calibrated"] = True
    notes = {"frames": len(frames), "minimapScore": mscore, "arrowFound": arrow_found, "bars": len(bars)}
    mm = prof.setdefault("minimap", {})
    mm["box"] = _frac(mbox, W, H)
    mm["player"] = [round(ax / W, 5), round(ay / H, 5)]
    if bars:
        b = bars[0]
        mm["bars"] = {"box": _frac((b[0], b[1] + 1, b[2], b[3] - 1), W, H), "minShare": 0.6}
    else:
        mm.pop("bars", None)
        notes["warning"] = "no static bar strip found: HUD frames will be told by the minimap alone"
    if a.sequence:
        s0, sd = [float(x) for x in a.sequence.split(",")]
        seq = list(video.frames(a.ffmpeg, a.video, 2.0, start=s0, duration=sd, width=W, height=H))
        C = (ax - mbox[0], ay - mbox[1])
        pairs = tilt_pairs(seq, mbox, C)
        notes["tiltPairs"] = len(pairs)
        if len(pairs) >= 8:
            t = learn_tilt(pairs, np.array(C))
            mm["tilt"] = {"k": round(t["k"] * H, 4), "a": round(t["a"], 4)}
            notes["tilt"] = t
    reader = Reader(a.libs)
    if reader.ok:
        found = text_boxes(reader, frames, W, H, base)
        for k, box in found.items():
            if k == "money":
                prof.setdefault("money", {})["box"] = box
            else:
                prof.setdefault("texts", {})[k] = box
        notes["textBoxes"] = sorted(found)
    else:
        notes["ocr"] = reader.error
    if a.stars:
        st, count = a.stars.split(":")
        f = video.frame_at(a.ffmpeg, a.video, float(st), W, H)
        r = star_boxes(f, W, H) if f is not None else None
        if r:
            box, size, n = r
            prof.setdefault("wanted", {}).update(box=box, starHeight=size)
            notes["stars"] = {"told": int(count), "found": n}
    prof["calibration"] = notes
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(prof, fh, indent=2)
    # The preview: every box on the middle frame, for the eye check.
    pv = frames[len(frames) // 2][1].copy()
    p2 = Profile(prof)

    def draw(box, col, label):
        if not box:
            return
        x0, y0, x1, y1 = [int(round(v)) for v in (box[0] * W, box[1] * H, box[2] * W, box[3] * H)]
        cv2.rectangle(pv, (x0, y0), (x1, y1), col, 2)
        cv2.putText(pv, label, (x0 + 3, max(14, y0 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)

    draw(p2.get("minimap", "box"), (0, 255, 255), "minimap")
    draw(p2.get("minimap", "bars", "box"), (0, 255, 0), "bars")
    draw(p2.get("wanted", "box"), (255, 255, 255), "wanted")
    draw(p2.get("money", "box"), (0, 200, 0), "money")
    for k, b in (p2.get("texts") or {}).items():
        draw(b, (255, 160, 0), k)
    cv2.drawMarker(pv, (int(ax), int(ay)), (0, 0, 255), cv2.MARKER_CROSS, 20, 2)
    cv2.imwrite(os.path.splitext(a.out)[0] + "_preview.png", pv)
    print(json.dumps({"ok": True, "out": a.out, "notes": notes}, default=str))
