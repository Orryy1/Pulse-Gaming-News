"""Builds src/render/components/worldmap.ts, the map the animated map graphic draws (MapMoment).

Source: Natural Earth 1:50m admin-0 countries (public domain) as TopoJSON, from the world-atlas package
(ISC): `npm pack world-atlas@2.0.2`, then `python -I build.py <countries-50m.json> src/render/components/worldmap.ts`.
Arcs are decoded, projected to Web Mercator (degrees: x = longitude, y = -mercator latitude), simplified
(Douglas-Peucker, 0.03 degrees, islands under 0.04 square degrees left out) and written as SVG paths with
relative moves: each country (together they are the land), the borders between them, and a label point
per country.
"""
import json
import math
import sys

TOL = 0.03
MIN_RING = 0.04  # square degrees: smaller islands are left out
LAT_MIN, LAT_MAX = -60.0, 84.0


def merc(lon, lat):
    lat = max(LAT_MIN, min(LAT_MAX, lat))
    y = math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))
    return lon, -y


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm if (dx or dy) else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]


def main(src, out):
    topo = json.load(open(src, encoding="utf-8"))
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append(merc(x * sx + tx, y * sy + ty))
        arcs.append(simplify(pts, TOL))

    def ring(idx):
        pts = []
        for i in idx:
            a = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
            pts.extend(a if not pts else a[1:])
        # A ring across the date line (Russia's far east, Fiji) would streak across the whole map: its
        # western half is moved past 180 degrees east instead.
        if any(abs(b[0] - a[0]) > 180 for a, b in zip(pts, pts[1:])):
            pts = [(x + 360 if x < 0 else x, y) for x, y in pts]
        return pts

    def path(rings):
        out = []
        for r in rings:
            if len(r) < 4:
                continue
            xs = [p[0] for p in r]
            ys = [p[1] for p in r]
            if (max(xs) - min(xs)) * (max(ys) - min(ys)) < MIN_RING:
                continue
            x0, y0 = round(r[0][0], 2), round(r[0][1], 2)
            seg = [f"M{x0:g} {y0:g}"]
            px, py = x0, y0
            for x, y in r[1:]:
                x, y = round(x, 2), round(y, 2)
                if x == px and y == py:
                    continue
                seg.append(f"l{round(x - px, 2):g} {round(y - py, 2):g}")
                px, py = x, y
            out.append("".join(seg) + "z")
        return "".join(out).replace(" -", "-")

    uses = {}
    countries = {}
    points = {}
    boxes = {}
    for g in topo["objects"]["countries"]["geometries"]:
        name = (g.get("properties") or {}).get("name")
        if not name or name == "Antarctica":
            continue
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]] if g["type"] == "Polygon" else []
        rings = []
        best = (0, None)
        for poly in polys:
            for k, r in enumerate(poly):
                for i in r:
                    uses[i if i >= 0 else ~i] = uses.get(i if i >= 0 else ~i, 0) + 1
                pts = ring(r)
                rings.append(pts)
                if k == 0 and len(pts) > 2:
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    area = (max(xs) - min(xs)) * (max(ys) - min(ys))
                    if area > best[0]:
                        best = (area, (sum(xs) / len(xs), sum(ys) / len(ys)))
        countries[name] = path(rings)
        pts = [p for r in rings for p in r]
        if pts:
            boxes[name] = [
                round(min(p[0] for p in pts), 1),
                round(min(p[1] for p in pts), 1),
                round(max(p[0] for p in pts), 1),
                round(max(p[1] for p in pts), 1),
            ]
        if best[1]:
            points[name] = [round(best[1][0], 2), round(best[1][1], 2)]
    borders = []
    for i, n in uses.items():
        if n >= 2 and len(arcs[i]) >= 2:
            a = arcs[i]
            x0, y0 = round(a[0][0], 2), round(a[0][1], 2)
            seg = [f"M{x0:g} {y0:g}"]
            px, py = x0, y0
            for x, y in a[1:]:
                x, y = round(x, 2), round(y, 2)
                seg.append(f"l{round(x - px, 2):g} {round(y - py, 2):g}")
                px, py = x, y
            borders.append("".join(seg))
    data = {
        "source": "Natural Earth 1:50m admin-0 (public domain) via world-atlas 2.0.2; Web Mercator, degrees",
        "borders": "".join(borders).replace(" -", "-"),
        "countries": countries,
        "points": points,
        "boxes": boxes,
    }
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=True)
    head = [
        "// Generated by src/tools/mapdata/build.py from Natural Earth (public domain). Do not edit.",
        "export interface WorldData {",
        "  source: string;",
        "  borders: string;",
        "  countries: Record<string, string>;",
        "  points: Record<string, [number, number]>;",
        "  boxes: Record<string, [number, number, number, number]>;",
        "}",
        "export const WORLD: WorldData = JSON.parse(" + json.dumps(text) + ");",
    ]
    # A TypeScript module: the renderer's bundler and Node both import it without JSON import attributes.
    with open(out, "w", encoding="utf-8", newline="") as f:
        f.write(chr(10).join(head) + chr(10))
    print(out, sum(len(v) for v in countries.values()), len(data["borders"]), len(countries))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
