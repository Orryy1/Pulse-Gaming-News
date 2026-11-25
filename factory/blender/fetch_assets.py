"""Gets the Blender scene kit's outside files (assets/manifest.json) into the asset folder, once.

Downloads each file not already there and checks its md5 where the manifest has one, unpacks the factory's
woff2 fonts to TrueType (Blender cannot read woff2) and draws the land mask for the globe from the country
outlines. Safe to run again: anything already in place is kept.

  python fetch_assets.py [asset folder]          default: BLENDER_ASSETS, else D:/pulse-data/blender/assets
  python fetch_assets.py --trace-logo            redraws assets/logo_mark.json from public/logo.png (needs OpenCV)

Needs Pillow and fontTools (with brotli) for the fonts and the land mask.
"""
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

KIT = Path(__file__).resolve().parent
FACTORY = KIT.parent
MANIFEST = KIT / "assets" / "manifest.json"


def asset_dir(argv):
    for a in argv:
        if not a.startswith("--"):
            return Path(a)
    return Path(os.environ.get("BLENDER_ASSETS") or "D:/pulse-data/blender/assets")


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(entry, root):
    dest = root / entry["file"]
    if dest.exists() and dest.stat().st_size > 0:
        return "kept"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(entry["url"], headers={"User-Agent": "pulse-blender-kit"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    if entry.get("md5") and md5(tmp) != entry["md5"]:
        tmp.unlink()
        raise RuntimeError(f"{entry['id']}: checksum does not match the manifest")
    tmp.replace(dest)
    return "downloaded"


def fonts(root):
    from fontTools.ttLib import TTFont

    pairs = {
        "anton-400.ttf": "anton-latin-400-normal.woff2",
        "inter-800.ttf": "inter-latin-800-normal.woff2",
        "inter-600.ttf": "inter-latin-600-normal.woff2",
    }
    out = root / "fonts"
    out.mkdir(parents=True, exist_ok=True)
    for ttf, woff in pairs.items():
        if (out / ttf).exists():
            continue
        f = TTFont(str(FACTORY / "public" / "fonts" / woff))
        f.flavor = None
        f.save(str(out / ttf))


def rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def land_mask(root):
    from PIL import Image, ImageDraw

    dest = root / "geo" / "land_4096.png"
    if dest.exists():
        return
    w, h = 4096, 2048
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    data = json.load(open(root / "geo" / "ne_50m_admin_0_countries.geojson", encoding="utf-8"))
    for feat in data["features"]:
        for poly in rings(feat["geometry"]):
            for k, ring in enumerate(poly):
                pts = [((lon + 180) / 360 * w, (90 - lat) / 180 * h) for lon, lat in ring]
                if len(pts) >= 3:
                    d.polygon(pts, fill=0 if k else 255)
    img.save(dest)


def trace_logo():
    """The orange parts of public/logo.png as polygons in a unit square centred on 0 (y up), for logo_mark.json."""
    import cv2
    import numpy as np

    img = cv2.imread(str(FACTORY / "public" / "logo.png"), cv2.IMREAD_UNCHANGED)
    bgr = img[..., :3].astype(int)
    orange = ((bgr[..., 2] > 180) & (bgr[..., 1] > 60) & (bgr[..., 1] < 160) & (bgr[..., 0] < 90)).astype(np.uint8) * 255
    orange = cv2.morphologyEx(orange, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, hier = cv2.findContours(orange, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    size = img.shape[1]
    shapes = []
    for i, c in enumerate(contours):
        if cv2.contourArea(c) < 400:
            continue
        c = cv2.approxPolyDP(c, 1.2, True)
        pts = [[round((x - size / 2) / size, 4), round((size / 2 - y) / size, 4)] for [[x, y]] in c]
        shapes.append({"hole": bool(hier[0][i][3] >= 0), "points": pts})
    out = KIT / "assets" / "logo_mark.json"
    json.dump({"from": "public/logo.png", "size": size, "shapes": shapes}, open(out, "w", encoding="utf-8"))
    print(f"traced {len(shapes)} shapes into {out}")


def main():
    if "--trace-logo" in sys.argv:
        trace_logo()
        return
    root = asset_dir(sys.argv[1:])
    root.mkdir(parents=True, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    for entry in manifest["files"]:
        print(f"{entry['id']}: {download(entry, root)}")
    fonts(root)
    land_mask(root)
    print(f"assets ready in {root}")


if __name__ == "__main__":
    main()
