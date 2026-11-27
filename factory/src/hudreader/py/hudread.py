"""The GTA HUD and minimap reader (src/hudreader): one pass over a recording writes a telemetry file, and grows the
game's stitched map (the atlas) as it goes. Run with python -I from this folder; the folder is put on the path here.

  hudread.py read --video V --profile P --out telemetry.json [--atlas DIR] [--fps 2] [--start S] [--duration D]
                  [--matcher sift|lightglue] [--ocr on|off] [--libs DIR] [--models DIR] [--ffmpeg F] [--ffprobe F]
  hudread.py frames --video V --times 1,2.5,... --out DIR          full frames, for hand checks
  hudread.py calibrate --video V --base P --out NEW.json [...]     learn a new HUD (hudcore/calibrate.py)
  hudread.py selftest                                              synthetic checks of the stars and the stitcher
"""

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from hudcore import video  # noqa: E402
from hudcore.minimap import Minimap  # noqa: E402
from hudcore.mosaic import Atlas, Tracker  # noqa: E402
from hudcore.ocr import ChangeGate, Reader, clean_lines, has_text  # noqa: E402
from hudcore.profile import Profile, crop  # noqa: E402
from hudcore.screens import classify  # noqa: E402
from hudcore.stars import read_wanted  # noqa: E402
from hudcore import matcher as matchers  # noqa: E402

VERSION = 1
TEXT_REGIONS = ("banner", "centre", "area", "subtitle", "help")


def parse_money(profile, texts):
    """(balance, change) read from the money box's lines; None where not shown."""
    bal, delta = None, None
    first = bool(profile.get("money", "first", default=False))
    for t in texts:
        s = t.replace(" ", "")
        if profile.delta_re:
            m = profile.delta_re.search(s)
            if m:
                v = int("".join(ch for ch in m.group(2) if ch.isdigit()) or 0)
                delta = v if m.group(1) == "+" else -v
                continue
        if profile.money_re:
            m = profile.money_re.search(s)
            if m:
                digits = "".join(ch for ch in m.group(1) if ch.isdigit())
                # GTA VI ("money": {"first": true}) writes two balances, the top one first; GTA V keeps its old rule.
                if digits and (bal is None or not first):
                    bal = int(digits)
    return bal, delta


def cmd_read(a):
    profile = Profile.load(a.profile)
    W, H, dur = video.probe(a.ffprobe, a.video)
    # Frames are read at 1080p or below: the HUD is drawn for 1080p and higher only costs time.
    if H > 1080:
        W, H = int(round(W * 1080 / H / 2) * 2), 1080
    atlas = Atlas.load(a.atlas, profile.game) if a.atlas else Atlas(profile.game)
    reloc = matchers.make(a.matcher, a.libs, a.models)
    tracker = Tracker(atlas, reloc_matcher=reloc)
    mm = Minimap(profile, W, H)
    tracker._player = tuple(mm.player)
    if a.threads:
        cv2.setNumThreads(a.threads)
    reader = Reader(a.libs, a.threads or None, profile.get("ocrDet")) if a.ocr == "on" else None
    gate = ChangeGate()
    # How much a text region is enlarged before reading: GTA V's small writing reads better at 2x; GTA VI's large
    # banners read as well at 1x for a quarter of the time (the text finder's cost grows with the pixels).
    upscale = float(profile.get("ocrUpscale", default=2.0))
    track_map = profile.get("minimap", "track", default=True) is not False
    stars_any = bool(profile.get("wanted", "anyScreen", default=False))
    talk_box = profile.get("talkBox")
    samples = []
    t0 = time.time()
    duration = a.duration or max(0.0, dur - a.start)
    last_state = None
    for t, frame in video.frames(a.ffmpeg, a.video, a.fps, start=a.start, duration=duration, width=W, height=H,
                                 keyframes=a.keyframes):
        state, conf = classify(frame, profile)
        s = {"t": round(t, 2), "state": state}
        # Spoken lines on screen (subtitles), told without reading them: the miner holds a stretch full of dialogue
        # as a story moment (a mission's or a cutscene's talk), the spoiler rule's cheapest sure sign.
        if talk_box and state != "black" and has_text(crop(frame, talk_box), H):
            s["talk"] = True
        if state == "other" and stars_any:
            # GTA VI hides its radar now and then during a chase while the stars stay up: they are read anyway (the
            # fixed slots, right-hand fill and outline checks keep scenery out). Only a frame that shows some count.
            w = read_wanted(frame, profile)
            if w["stars"] or w["dim"]:
                s["stars"] = w["stars"]
                if w["dim"]:
                    s["dim"] = w["dim"]
        if state != "hud":
            if last_state == "hud":
                tracker.reset()
            last_state = state
            samples.append(s)
            continue
        last_state = state
        w = read_wanted(frame, profile)
        s["stars"] = w["stars"]
        if w["dim"]:
            s["dim"] = w["dim"]
        if w["score"]:
            s["starScore"] = w["score"]
        s["air"] = bool(mm.altimeter(frame))
        # GTA VI's radar is in colour, which the stitcher (made for GTA V's grey radar) cannot follow: a profile may
        # switch the map off ("track": false) rather than fill the atlas with hundreds of one-frame islands.
        if track_map:
            img, msk = mm.flat(frame)
            s["mm"] = tracker.track(img, msk, t)
        if reader and reader.ok:
            texts = {}
            for region in TEXT_REGIONS:
                box = profile.get("texts", region)
                if not box:
                    continue
                c = crop(frame, box)
                if not has_text(c, H) or not gate.changed(region, c, t):
                    continue
                lines = [x[0] for x in clean_lines(reader.read(c, upscale=upscale))
                         if not (profile.ignore_re and profile.ignore_re.match(x[0]))]
                if lines:
                    texts[region] = lines
            mb = profile.get("money", "box")
            if mb:
                c = crop(frame, mb)
                if has_text(c, H, min_glyphs=2) and gate.changed("money", c, t):
                    lines = [x[0] for x in clean_lines(reader.read(c), min_alnum=1, min_conf=0.7)]
                    bal, delta = parse_money(profile, lines)
                    if bal is not None:
                        s["money"] = bal
                    if delta is not None:
                        s["moneyDelta"] = delta
            if texts:
                s["texts"] = texts
            area = texts.get("area")
            pose = s.get("mm") or {}
            if area and profile.area_re and pose.get("island"):
                for line in area:
                    if profile.area_re.match(line):
                        atlas.add_place(line.strip(), pose["island"], pose["x"], pose["y"])
                        break
        samples.append(s)
        if a.progress and len(samples) % 200 == 0:
            print(json.dumps({"progress": round(t, 1), "of": round(a.start + duration, 1)}), flush=True)
    # Positions recorded on an island that was later joined to another are moved onto it.
    for src, dst, M in atlas.merges:
        M = np.array(M)
        for s in samples:
            p = s.get("mm")
            if p and p.get("island") == src:
                q = M @ np.array([p["x"], p["y"], 1.0])
                p.update(island=dst, x=round(float(q[0]), 1), y=round(float(q[1]), 1),
                         heading=round(p["heading"] + float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))), 1))
    atlas.sources.append({"video": os.path.basename(a.video), "start": a.start, "duration": duration,
                          "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    if a.atlas:
        atlas.save(a.atlas)
    out = {
        "version": VERSION,
        "game": profile.game,
        "video": a.video,
        "width": W,
        "height": H,
        "fps": a.fps,
        "start": a.start,
        "duration": round(duration, 2),
        "matcher": reloc.name,
        "matcherFallback": getattr(reloc, "fallback", None),
        "ocr": {"engine": "rapidocr-ppocrv4" if reader and reader.ok else "off",
                "error": reader.error if reader else None, "reads": reader.reads if reader else 0},
        "stats": tracker.stats,
        "seconds": round(time.time() - t0, 1),
        # The reader's own CPU time (ffmpeg's decoding runs in its own process and is not in it).
        "cpuSeconds": round(time.process_time(), 1),
        # Whether spoken lines were looked for (a profile's talkBox): a read without it cannot tell dialogue.
        "talkRead": bool(talk_box),
        "places": atlas.places,
        "islands": {str(i): {"coverage": c.coverage(), "bbox": c.bbox()} for i, c in atlas.islands.items()},
        "samples": samples,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(json.dumps({"ok": True, "samples": len(samples), "seconds": out["seconds"], "cpuSeconds": out["cpuSeconds"],
                      "stats": tracker.stats,
                      "ocr": out["ocr"], "matcher": out["matcher"]}))


def cmd_frames(a):
    W, H, _ = video.probe(a.ffprobe, a.video)
    os.makedirs(a.out, exist_ok=True)
    for t in [float(x) for x in a.times.split(",") if x.strip()]:
        f = video.frame_at(a.ffmpeg, a.video, t, W, H)
        if f is not None:
            cv2.imwrite(os.path.join(a.out, f"f_{t:08.2f}.png"), f)
    print(json.dumps({"ok": True}))


def cmd_atlas_picture(a):
    atlas = Atlas.load(a.atlas, "")
    os.makedirs(a.out, exist_ok=True)
    meta = {}
    for iid in atlas.islands:
        pic = atlas.picture(iid, scale=a.scale)
        if pic is None:
            continue
        img, msk, x0, y0 = pic
        bgra = np.dstack([img, msk])
        cv2.imwrite(os.path.join(a.out, f"island_{iid}.png"), bgra)
        meta[str(iid)] = {"x0": int(x0), "y0": int(y0), "scale": a.scale, "width": int(img.shape[1]),
                          "height": int(img.shape[0])}
    with open(os.path.join(a.out, "islands.json"), "w", encoding="utf-8") as f:
        json.dump({"islands": meta, "places": atlas.places}, f, indent=1)
    print(json.dumps({"ok": True, "islands": meta}))


def cmd_crop(a):
    """A square crop of an island around a spot, for the Day N pin's minimap disc."""
    atlas = Atlas.load(a.atlas, "")
    c = atlas.islands.get(a.island)
    if c is None:
        raise SystemExit(f"no island {a.island}")
    half = a.size // 2
    x0, y0 = int(round(a.x)) - half, int(round(a.y)) - half
    img, msk = c.render(x0, y0, x0 + a.size, y0 + a.size)
    bg = np.full_like(img, 40)
    img = np.where(msk[..., None] > 0, img, bg)
    if a.px and a.px != a.size:
        img = cv2.resize(img, (a.px, a.px), interpolation=cv2.INTER_AREA)
    cv2.imwrite(a.out, img)
    print(json.dumps({"ok": True, "out": a.out, "coverage": round(float((msk > 0).mean()), 3)}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("read")
    r.add_argument("--video", required=True)
    r.add_argument("--profile", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--atlas")
    r.add_argument("--fps", type=float, default=2.0)
    r.add_argument("--start", type=float, default=0.0)
    r.add_argument("--duration", type=float, default=0.0)
    r.add_argument("--matcher", default="sift")
    r.add_argument("--ocr", default="on")
    r.add_argument("--threads", type=int, default=0)
    r.add_argument("--keyframes", action="store_true")
    r.add_argument("--libs")
    r.add_argument("--models")
    r.add_argument("--ffmpeg", default="ffmpeg")
    r.add_argument("--ffprobe", default="ffprobe")
    r.add_argument("--progress", action="store_true")
    f = sub.add_parser("frames")
    f.add_argument("--video", required=True)
    f.add_argument("--times", required=True)
    f.add_argument("--out", required=True)
    f.add_argument("--ffmpeg", default="ffmpeg")
    f.add_argument("--ffprobe", default="ffprobe")
    ap = sub.add_parser("atlas")
    ap.add_argument("--atlas", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=float, default=0.5)
    c = sub.add_parser("calibrate")
    c.add_argument("--video", required=True)
    c.add_argument("--base", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--game", required=True)
    c.add_argument("--times", default="")
    c.add_argument("--sequence", default="")
    c.add_argument("--stars", default="")
    c.add_argument("--libs")
    c.add_argument("--ffmpeg", default="ffmpeg")
    c.add_argument("--ffprobe", default="ffprobe")
    cr = sub.add_parser("crop")
    cr.add_argument("--atlas", required=True)
    cr.add_argument("--island", type=int, required=True)
    cr.add_argument("--x", type=float, required=True)
    cr.add_argument("--y", type=float, required=True)
    cr.add_argument("--size", type=int, default=600)
    cr.add_argument("--px", type=int, default=360)
    cr.add_argument("--out", required=True)
    for name in ("sheets", "verify"):
        q = sub.add_parser(name)
        q.add_argument("--video", required=True)
        q.add_argument("--profile", required=True)
        q.add_argument("--telemetry", required=True)
        q.add_argument("--atlas", required=True)
        q.add_argument("--times", required=True)
        q.add_argument("--out", required=True)
        q.add_argument("--ffmpeg", default="ffmpeg")
    pl = sub.add_parser("plot")
    pl.add_argument("--telemetry", required=True)
    pl.add_argument("--track")
    pl.add_argument("--atlas")
    pl.add_argument("--out", required=True)
    sub.add_parser("selftest")
    a = p.parse_args()
    if a.cmd == "read":
        cmd_read(a)
    elif a.cmd == "frames":
        cmd_frames(a)
    elif a.cmd == "crop":
        cmd_crop(a)
    elif a.cmd == "atlas":
        cmd_atlas_picture(a)
    elif a.cmd == "calibrate":
        from hudcore.calibrate import run as calibrate

        calibrate(a)
    elif a.cmd in ("sheets", "verify", "plot"):
        from hudcore import proof

        {"sheets": proof.cmd_sheets, "verify": proof.cmd_verify, "plot": proof.cmd_plot}[a.cmd](a)
    elif a.cmd == "selftest":
        from hudcore.selftest import run as selftest

        sys.exit(selftest())


if __name__ == "__main__":
    main()
