"""Proof helpers: hand-check sheets, an independent check of each placed minimap, and the telemetry plot.

  sheets   one picture per checked frame: the frame, the HUD boxes enlarged, the radar beside the stitched map as the
           reader placed it, and the reader's values printed underneath, for a person to mark right or wrong;
  verify   each checked frame found again on the finished map from nothing (no track, no previous frame) and the
           distance to where the track put it, an internal check that does not trust the track;
  plot     the telemetry over time (screen, stars, speed, flying, events) and the path drawn on the map.
"""

import json
import math
import os

import cv2
import numpy as np

from . import video
from .minimap import Minimap
from .mosaic import Atlas, Tracker
from .profile import Profile, crop

FONT = cv2.FONT_HERSHEY_SIMPLEX


def _nearest(samples, t):
    return min(samples, key=lambda s: abs(s["t"] - t))


def _texts_near(samples, t, before=1.6, after=0.6):
    out = {}
    for s in samples:
        if t - before <= s["t"] <= t + after:
            for k, v in (s.get("texts") or {}).items():
                out[k] = v
    return out


def _put(img, text, org, scale=0.7, col=(255, 255, 255), th=2):
    cv2.putText(img, text, org, FONT, scale, (0, 0, 0), th + 3, cv2.LINE_AA)
    cv2.putText(img, text, org, FONT, scale, col, th, cv2.LINE_AA)


def atlas_view(atlas, mm, pose, size):
    """The stitched map as the radar would show it at a pose: back through the tilt into radar pixels."""
    if not pose or pose.get("island") not in atlas.islands:
        return None
    c = atlas.islands[pose["island"]]
    th = math.radians(pose["heading"])
    z = pose["zoom"]
    G = np.array([[z * math.cos(th), -z * math.sin(th), 0], [z * math.sin(th), z * math.cos(th), 0], [0, 0, 1.0]])
    # The player's point in the flat picture lands on (x, y).
    p = G @ np.array([mm.player[0], mm.player[1], 1.0])
    G[0, 2] = pose["x"] - p[0]
    G[1, 2] = pose["y"] - p[1]
    flat, fm = c.view(G, mm.size)
    w, h = size
    radar = cv2.warpPerspective(flat, np.linalg.inv(mm.Hu), (w, h), flags=cv2.INTER_LINEAR)
    rm = cv2.warpPerspective(fm, np.linalg.inv(mm.Hu), (w, h), flags=cv2.INTER_NEAREST)
    radar[rm == 0] = (40, 0, 40)
    return radar


def cmd_sheets(a):
    profile = Profile.load(a.profile)
    tel = json.load(open(a.telemetry, encoding="utf-8"))
    W, H = tel["width"], tel["height"]
    atlas = Atlas.load(a.atlas, profile.game)
    mm = Minimap(profile, W, H)
    os.makedirs(a.out, exist_ok=True)
    times = [float(x) for x in a.times.split(",") if x.strip()]
    for i, t in enumerate(times):
        f = video.frame_at(a.ffmpeg, a.video, t, W, H)
        if f is None:
            continue
        s = _nearest(tel["samples"], t)
        sheet = np.zeros((1080, 1920, 3), np.uint8)
        sheet[:540, :960] = cv2.resize(f, (960, 540), interpolation=cv2.INTER_AREA)
        tiles = []
        for name, box in (("wanted/money", profile.get("wanted", "box")), ("banner", profile.get("texts", "banner")),
                          ("centre", profile.get("texts", "centre")), ("area", profile.get("texts", "area"))):
            c = crop(f, box)
            tiles.append((name, c))
        y = 0
        for name, c in tiles:
            scale = min(940 / max(1, c.shape[1]), 128 / max(1, c.shape[0]))
            r = cv2.resize(c, None, fx=scale, fy=scale)
            sheet[y:y + r.shape[0], 970:970 + r.shape[1]] = r
            _put(sheet, name, (975, y + 22), 0.6, (0, 255, 255))
            y += 136
        radar = mm.raw(f)
        view = atlas_view(atlas, mm, s.get("mm"), (radar.shape[1], radar.shape[0])) if s.get("state") == "hud" else None
        big = 2.2
        r1 = cv2.resize(radar, None, fx=big, fy=big)
        sheet[560:560 + r1.shape[0], 10:10 + r1.shape[1]] = r1
        _put(sheet, "radar", (16, 590), 0.7, (0, 255, 255))
        if view is not None:
            r2 = cv2.resize(view, None, fx=big, fy=big)
            sheet[560:560 + r2.shape[0], 30 + r1.shape[1]:30 + r1.shape[1] + r2.shape[1]] = r2
            _put(sheet, "stitched map at the reader's pose", (36 + r1.shape[1], 590), 0.7, (0, 255, 255))
        tx = 1340
        lines = [f"#{i + 1}  t={t:.1f}s  state={s.get('state')}"]
        if s.get("state") == "hud":
            lines.append(f"stars={s.get('stars', 0)} dim={s.get('dim', 0)} air={s.get('air')}")
            p = s.get("mm") or {}
            lines.append(f"pose: {p.get('how')} isl={p.get('island')} x={p.get('x')} y={p.get('y')} hd={p.get('heading')}")
        for k, v in _texts_near(tel["samples"], t).items():
            lines.append(f"{k}: {' | '.join(v)[:46]}")
        if "money" in s:
            lines.append(f"money={s['money']}")
        for j, l in enumerate(lines):
            _put(sheet, l, (tx - 380, 600 + 34 * j) if j else (tx - 380, 600), 0.7)
        cv2.imwrite(os.path.join(a.out, f"check_{i + 1:02d}_{t:07.1f}.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(json.dumps({"ok": True, "sheets": len(times)}))


def cmd_verify(a):
    """Re-finds each frame's minimap on the finished map with no prior and measures the gap to the tracked pose."""
    profile = Profile.load(a.profile)
    tel = json.load(open(a.telemetry, encoding="utf-8"))
    W, H = tel["width"], tel["height"]
    atlas = Atlas.load(a.atlas, profile.game)
    mm = Minimap(profile, W, H)
    out = []
    for t in [float(x) for x in a.times.split(",") if x.strip()]:
        s = _nearest(tel["samples"], t)
        p = s.get("mm")
        if s.get("state") != "hud" or not p or p.get("island") is None:
            out.append({"t": t, "state": s.get("state"), "tracked": False})
            continue
        f = video.frame_at(a.ffmpeg, a.video, s["t"], W, H)
        img, msk = mm.flat(f)
        tr = Tracker(atlas)
        tr._player = tuple(mm.player)
        found = tr._relocate(img, msk)
        if not found:
            out.append({"t": t, "tracked": True, "refound": False})
            continue
        iid, G, n = found
        q = G @ np.array([mm.player[0], mm.player[1], 1.0])
        err = float(math.hypot(q[0] - p["x"], q[1] - p["y"])) if iid == p["island"] else None
        out.append({"t": t, "tracked": True, "refound": True, "island": iid, "sameIsland": iid == p["island"],
                    "error": None if err is None else round(err, 1), "inliers": n})
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    errs = [o["error"] for o in out if o.get("error") is not None]
    print(json.dumps({"ok": True, "checked": len(out), "refound": sum(1 for o in out if o.get("refound")),
                      "medianError": round(float(np.median(errs)), 1) if errs else None,
                      "within25": sum(1 for e in errs if e <= 25)}))


STATE_COL = {"hud": (80, 200, 80), "menu": (200, 160, 60), "black": (40, 40, 40), "other": (150, 150, 150)}


def cmd_plot(a):
    tel = json.load(open(a.telemetry, encoding="utf-8"))
    track = json.load(open(a.track, encoding="utf-8")) if a.track else None
    S = tel["samples"]
    t0, t1 = S[0]["t"], S[-1]["t"]
    Wd, Hd = 1800, 900
    img = np.full((Hd, Wd, 3), 18, np.uint8)
    L, R = 150, Wd - 30
    X = lambda t: int(L + (t - t0) / max(1e-6, t1 - t0) * (R - L))
    rows = {"screen": (60, 100), "stars": (130, 260), "speed": (290, 470), "flying": (500, 530), "placed": (560, 590), "events": (620, 860)}
    _put(img, f"HUD telemetry: {os.path.basename(tel['video'])[:70]}", (L, 36), 0.8)
    for name, (y0, y1) in rows.items():
        _put(img, name, (10, (y0 + y1) // 2 + 8), 0.65, (200, 200, 200), 1)
        cv2.rectangle(img, (L, y0), (R, y1), (60, 60, 60), 1)
    prev = None
    for s in S:
        x = X(s["t"])
        cv2.line(img, (x, 62), (x, 98), STATE_COL.get(s["state"], (100, 100, 100)), 2)
        if s["state"] == "hud":
            st = s.get("stars", 0)
            y = int(258 - st / 5 * 126)
            cv2.circle(img, (x, y), 2, (60, 180, 255), -1)
            if s.get("air"):
                cv2.line(img, (x, 502), (x, 528), (255, 200, 80), 2)
            if (s.get("mm") or {}).get("island") is not None:
                cv2.line(img, (x, 562), (x, 588), (120, 220, 255), 2)
    if track:
        pts = [(p["t"], p["speed"]) for p in track["points"] if p.get("speed") is not None]
        if pts:
            vmax = max(60.0, float(np.percentile([v for _, v in pts], 99)))
            for t, v in pts:
                cv2.circle(img, (X(t), int(468 - min(v, vmax) / vmax * 176)), 2, (180, 255, 120), -1)
            _put(img, f"{vmax:.0f} u/s", (L + 4, 306), 0.5, (180, 255, 120), 1)
        lane = 0
        for e in track["events"]:
            if e["kind"] in ("area",):
                continue
            x = X(e["t"])
            y = 640 + (lane % 7) * 30
            lane += 1
            cv2.line(img, (x, 622), (x, 858), (90, 90, 160), 1)
            _put(img, (e.get("detail") or e["kind"])[:34], (x + 3, y), 0.45, (255, 220, 160), 1)
    for k in range(0, 6):
        _put(img, str(k), (L - 22, int(262 - k / 5 * 126)), 0.45, (60, 180, 255), 1)
    step = 300 if t1 - t0 > 1200 else 60
    for t in range(int(t0 // step * step), int(t1) + 1, step):
        if t < t0:
            continue
        cv2.line(img, (X(t), 870), (X(t), 880), (200, 200, 200), 1)
        _put(img, f"{t // 60}:{t % 60:02d}", (X(t) - 18, 896), 0.45, (200, 200, 200), 1)
    cv2.imwrite(a.out, img)
    # The path on the map, one picture per island with enough of it.
    if a.atlas:
        atlas = Atlas.load(a.atlas, tel["game"])
        for iid in atlas.islands:
            pic = atlas.picture(iid, 1.0)
            if pic is None:
                continue
            m, msk, x0, y0 = pic
            pts = [(s["mm"]["x"] - x0, s["mm"]["y"] - y0) for s in S
                   if s.get("state") == "hud" and (s.get("mm") or {}).get("island") == iid]
            if len(pts) < 10:
                continue
            for j in range(1, len(pts)):
                a0, b0 = pts[j - 1], pts[j]
                if math.hypot(b0[0] - a0[0], b0[1] - a0[1]) < 200:
                    cv2.line(m, (int(a0[0]), int(a0[1])), (int(b0[0]), int(b0[1])), (40, 120, 255), 3, cv2.LINE_AA)
            for pl in atlas.places:
                if pl["island"] == iid:
                    q = (int(pl["x"] - x0), int(pl["y"] - y0))
                    cv2.circle(m, q, 7, (0, 255, 255), -1)
                    _put(m, pl["name"], (q[0] + 9, q[1] + 6), 0.7)
            scale = min(1.0, 2000 / max(m.shape[:2]))
            if scale < 1:
                m = cv2.resize(m, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            cv2.imwrite(os.path.splitext(a.out)[0] + f"_map_island{iid}.png", m)
    print(json.dumps({"ok": True, "out": a.out}))
