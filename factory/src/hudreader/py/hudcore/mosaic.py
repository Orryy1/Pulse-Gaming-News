"""The stitched map: built only from the owner's own minimap crops (never Rockstar's map art), stored as 512-pixel
tiles so it can grow over days of streams, and kept as "islands": pieces not yet joined to each other. A frame that
lands on two islands joins them. Positions are in map units (1080p minimap pixels at the island's first zoom).

Tracking a frame is three steps: frame to frame (the last flat minimap, SIFT and a similarity), then a correction
against the map itself around the predicted place (keeps drift down over a long drive), and, after a gap (a menu, a
cutscene, a death), finding the minimap again anywhere on the map with the configured matcher."""

import json
import math
import os

import cv2
import numpy as np

from .matcher import SiftMatcher, similarity

TILE = 512


def _h(S):
    return np.vstack([S, [0, 0, 1.0]])


class Canvas:
    def __init__(self):
        self.tiles = {}  # (tx, ty) -> [img uint8 HxWx3, weight uint8 HxW]
        self.version = 0

    def bbox(self):
        if not self.tiles:
            return None
        xs = [k[0] for k in self.tiles]
        ys = [k[1] for k in self.tiles]
        return (min(xs) * TILE, min(ys) * TILE, (max(xs) + 1) * TILE, (max(ys) + 1) * TILE)

    def blend(self, img, mask, G, cap=24):
        """Adds a flat minimap (img, mask) placed by G (3x3, picture -> canvas), as a running mean."""
        h, w = mask.shape
        corners = cv2.perspectiveTransform(np.float64([[[0, 0], [w, 0], [w, h], [0, h]]]), G)[0]
        x0, y0 = np.floor(corners.min(0)).astype(int)
        x1, y1 = np.ceil(corners.max(0)).astype(int)
        T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1.0]]) @ G
        size = (x1 - x0, y1 - y0)
        wi = cv2.warpPerspective(img, T, size, flags=cv2.INTER_LINEAR)
        wm = cv2.warpPerspective(mask, T, size, flags=cv2.INTER_NEAREST) > 0
        for ty in range(y0 // TILE, (y1 - 1) // TILE + 1):
            for tx in range(x0 // TILE, (x1 - 1) // TILE + 1):
                ox, oy = tx * TILE, ty * TILE
                sx0, sy0 = max(x0, ox), max(y0, oy)
                sx1, sy1 = min(x1, ox + TILE), min(y1, oy + TILE)
                if sx0 >= sx1 or sy0 >= sy1:
                    continue
                m = wm[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]
                if not m.any():
                    continue
                t = self.tiles.get((tx, ty))
                if t is None:
                    t = [np.zeros((TILE, TILE, 3), np.uint8), np.zeros((TILE, TILE), np.uint8)]
                    self.tiles[(tx, ty)] = t
                ti = t[0][sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox]
                tw = t[1][sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox]
                src = wi[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0].astype(np.float32)
                wf = tw.astype(np.float32)
                new = (ti.astype(np.float32) * wf[..., None] + src) / (wf[..., None] + 1)
                ti[m] = np.clip(new[m], 0, 255).astype(np.uint8)
                tw[m] = np.minimum(tw[m].astype(np.int32) + 1, cap).astype(np.uint8)
        self.version += 1

    def render(self, x0, y0, x1, y1):
        """(picture, mask) of a canvas window."""
        out = np.zeros((y1 - y0, x1 - x0, 3), np.uint8)
        msk = np.zeros((y1 - y0, x1 - x0), np.uint8)
        for ty in range(y0 // TILE, (y1 - 1) // TILE + 1):
            for tx in range(x0 // TILE, (x1 - 1) // TILE + 1):
                t = self.tiles.get((tx, ty))
                if t is None:
                    continue
                ox, oy = tx * TILE, ty * TILE
                sx0, sy0 = max(x0, ox), max(y0, oy)
                sx1, sy1 = min(x1, ox + TILE), min(y1, oy + TILE)
                if sx0 >= sx1 or sy0 >= sy1:
                    continue
                out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = t[0][sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox]
                msk[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = (t[1][sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox] > 0) * 255
        return out, msk

    def view(self, G, size):
        """The canvas as the flat minimap at pose G would see it: (picture, mask) in picture coordinates."""
        w, h = size
        corners = cv2.perspectiveTransform(np.float64([[[0, 0], [w, 0], [w, h], [0, h]]]), G)[0]
        x0, y0 = np.floor(corners.min(0)).astype(int) - 2
        x1, y1 = np.ceil(corners.max(0)).astype(int) + 2
        img, msk = self.render(x0, y0, x1, y1)
        T = np.linalg.inv(np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1.0]]) @ G)
        return (cv2.warpPerspective(img, T, size, flags=cv2.INTER_LINEAR),
                cv2.warpPerspective(msk, T, size, flags=cv2.INTER_NEAREST))

    def coverage(self):
        """Square map units drawn so far."""
        return int(sum(int((t[1] > 0).sum()) for t in self.tiles.values()))

    def save(self, folder):
        os.makedirs(folder, exist_ok=True)
        keys = []
        for (tx, ty), (img, w) in self.tiles.items():
            name = f"t_{tx}_{ty}"
            cv2.imwrite(os.path.join(folder, name + ".png"), img)
            cv2.imwrite(os.path.join(folder, name + "_w.png"), w)
            keys.append([tx, ty])
        return keys

    @staticmethod
    def load(folder, keys):
        c = Canvas()
        for tx, ty in keys:
            name = f"t_{tx}_{ty}"
            img = cv2.imread(os.path.join(folder, name + ".png"), cv2.IMREAD_COLOR)
            w = cv2.imread(os.path.join(folder, name + "_w.png"), cv2.IMREAD_GRAYSCALE)
            if img is not None and w is not None:
                c.tiles[(tx, ty)] = [img, w]
        return c


class Atlas:
    """Every island of one game's map, the places named on it and where they came from."""

    def __init__(self, game):
        self.game = game
        self.islands = {}  # id -> Canvas
        self.next_id = 1
        self.places = []  # {name, island, x, y, seen}
        self.merges = []  # (from, into, 3x3 list) in this run, so earlier positions can be moved
        self.sources = []

    def new_island(self):
        iid = self.next_id
        self.next_id += 1
        self.islands[iid] = Canvas()
        return iid

    def merge(self, src, dst, M):
        """Moves island src into dst; M (3x3) takes src's coordinates to dst's."""
        a = self.islands.pop(src)
        bb = a.bbox()
        if bb:
            x0, y0, x1, y1 = bb
            img, msk = a.render(x0, y0, x1, y1)
            T = M @ np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1.0]])
            self.islands[dst].blend(img, msk, T)
        for p in self.places:
            if p["island"] == src:
                q = M @ np.array([p["x"], p["y"], 1.0])
                p.update(island=dst, x=round(float(q[0]), 1), y=round(float(q[1]), 1))
        self.merges.append((src, dst, M.tolist()))

    def add_place(self, name, island, x, y):
        for p in self.places:
            if p["name"].lower() == name.lower() and p["island"] == island and math.hypot(p["x"] - x, p["y"] - y) < 400:
                n = p["seen"]
                p["x"] = round((p["x"] * n + x) / (n + 1), 1)
                p["y"] = round((p["y"] * n + y) / (n + 1), 1)
                p["seen"] = n + 1
                return
        self.places.append({"name": name, "island": island, "x": round(x, 1), "y": round(y, 1), "seen": 1})

    def save(self, folder):
        os.makedirs(folder, exist_ok=True)
        meta = {"game": self.game, "version": 1, "nextId": self.next_id, "islands": {}, "places": self.places,
                "sources": self.sources[-200:]}
        for iid, c in self.islands.items():
            sub = os.path.join(folder, f"island_{iid}")
            # Old tiles of a merged or regrown island are replaced whole.
            if os.path.isdir(sub):
                for f in os.listdir(sub):
                    os.remove(os.path.join(sub, f))
            keys = c.save(sub)
            meta["islands"][str(iid)] = {"tiles": keys, "coverage": c.coverage(), "bbox": c.bbox()}
        with open(os.path.join(folder, "atlas.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=1)
        for d in os.listdir(folder):
            if d.startswith("island_") and int(d.split("_")[1]) not in self.islands:
                sub = os.path.join(folder, d)
                for f in os.listdir(sub):
                    os.remove(os.path.join(sub, f))
                os.rmdir(sub)

    @staticmethod
    def load(folder, game):
        a = Atlas(game)
        path = os.path.join(folder, "atlas.json")
        if not os.path.exists(path):
            return a
        with open(path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        a.next_id = meta.get("nextId", 1)
        a.places = meta.get("places", [])
        a.sources = meta.get("sources", [])
        for iid, info in meta.get("islands", {}).items():
            a.islands[int(iid)] = Canvas.load(os.path.join(folder, f"island_{iid}"), info["tiles"])
        return a

    def picture(self, iid, scale=1.0, pad=16):
        """The island as one picture (for the end map and the proof), with its offset: (img, mask, x0, y0)."""
        c = self.islands[iid]
        bb = c.bbox()
        if not bb:
            return None
        img, msk = c.render(*bb)
        ys, xs = np.where(msk > 0)
        if not len(xs):
            return None
        x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
        x1, y1 = min(img.shape[1], xs.max() + pad), min(img.shape[0], ys.max() + pad)
        img, msk = img[y0:y1, x0:x1], msk[y0:y1, x0:x1]
        if scale != 1.0:
            img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            msk = cv2.resize(msk, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        return img, msk, bb[0] + x0, bb[1] + y0


class Tracker:
    """Places each flat minimap on the atlas."""

    def __init__(self, atlas, reloc_matcher=None, min_inliers=10):
        self.atlas = atlas
        self.sift = SiftMatcher()
        self.reloc = reloc_matcher or self.sift
        self.min_inliers = min_inliers
        self.island = None
        self.G = None
        self.prev = None  # (features, img, mask)
        self.lost_since = None
        self.reloc_tries = 0
        self.tracked = 0
        self.join_every = 20
        self._wcache = {}
        self.last_reloc = -1e9
        self.reloc_every = 1.0
        self.fails = 0
        self.merged_into = {}
        self.stats = {"f2f": 0, "refined": 0, "relocated": 0, "new_islands": 0, "lost": 0, "merged": 0}

    def reset(self):
        """A gap (menu, cutscene, no HUD): the next frame must be found again."""
        self.prev = None

    def _refine(self, img, mask, G):
        c = self.atlas.islands[self.island]
        v, vm = c.view(G, (mask.shape[1], mask.shape[0]))
        overlap = (vm > 0) & (mask > 0)
        if overlap.mean() < 0.25:
            return G, 0
        pa, pb = self.sift.match(img, mask, v, vm)
        S, n = similarity(pa, pb, thresh=2.0, min_inliers=max(12, self.min_inliers))
        if S is None:
            return G, 0
        rot = abs(math.degrees(math.atan2(S[1, 0], S[0, 0])))
        scale = float(np.hypot(S[0, 0], S[1, 0]))
        cx, cy = mask.shape[1] / 2, mask.shape[0] / 2
        moved = S @ np.array([cx, cy, 1.0])
        shift = float(np.hypot(moved[0] - cx, moved[1] - cy))
        if rot > 12 or abs(scale - 1) > 0.15 or shift > 60:
            return G, 0
        return G @ _h(S), n

    def _window_features(self, iid, c, wx, wy, x1, y1, win):
        """The matcher's features of one island window, cached until the island has grown a fair amount."""
        key = (iid, wx, wy)
        hit = self._wcache.get(key)
        if hit is not None and c.version - hit[0] < 60:
            return hit[1]
        wimg, wmsk = c.render(wx, wy, min(x1, wx + win), min(y1, wy + win))
        feats = None if (wmsk > 0).mean() < 0.05 else self.reloc.features(wimg, wmsk)
        self._wcache[key] = (c.version, feats)
        return feats

    def _relocate(self, img, mask, only=None, query=None):
        """Finds the picture anywhere on the given islands (all by default): (island, G, inliers) or None."""
        best = None
        q = query if query is not None else self.reloc.features(img, mask)
        for iid, c in list(self.atlas.islands.items()):
            if only is not None and iid not in only:
                continue
            bb = c.bbox()
            if not bb:
                continue
            x0, y0, x1, y1 = bb
            # Windows of the island, so a large map is searched in pieces the matcher can take.
            win = 1024
            for wy in range(y0, max(y0 + 1, y1 - win // 2), win // 2):
                for wx in range(x0, max(x0 + 1, x1 - win // 2), win // 2):
                    wf = self._window_features(iid, c, wx, wy, x1, y1, win)
                    if wf is None:
                        continue
                    pa, pb = self.reloc.match_features(q, wf)
                    S, n = similarity(pa, pb, thresh=3.0, min_inliers=max(15, self.min_inliers + 5))
                    if S is not None and (best is None or n > best[2]):
                        G = np.array([[1, 0, wx], [0, 1, wy], [0, 0, 1.0]]) @ _h(S)
                        best = (iid, G, n)
        return best

    def track(self, img, mask, t, allow_reloc=True):
        """Returns {'island', 'x', 'y', 'heading', 'zoom', 'how', 'inliers'} or {'how': 'lost'}."""
        if (mask > 0).mean() < 0.08:
            self.stats["lost"] += 1
            return {"how": "blank"}
        f = self.sift.features(img, mask)
        how, n = None, 0
        if self.prev is not None and self.island is not None:
            pa, pb = self.sift.match_features(f, self.prev[0])
            S, n = similarity(pa, pb, thresh=2.5, min_inliers=self.min_inliers)
            if S is not None:
                self.G = self.G @ _h(S)
                how = "f2f"
                self.stats["f2f"] += 1
                G2, n2 = self._refine(img, mask, self.G)
                if n2:
                    self.G = G2
                    how = "refined"
                    self.stats["refined"] += 1
        if how is not None:
            self.tracked += 1
            others = [i for i in self.atlas.islands if i != self.island]
            if allow_reloc and others and self.tracked % self.join_every == 0:
                # While the track is sure of itself, look for this spot on the other islands: a hit joins them.
                found = self._relocate(img, mask, only=others)
                if found:
                    iid, G, _ = found
                    self.atlas.merge(self.island, iid, G @ np.linalg.inv(self.G))
                    self.merged_into[self.island] = iid
                    self.stats["merged"] += 1
                    self.island, self.G = iid, G
        if how is None:
            # Looking for the spot on the whole map is the costly step: at most once every RELOC_EVERY seconds.
            if t - self.last_reloc < self.reloc_every:
                self.stats["lost"] += 1
                return {"how": "waiting"}
            self.last_reloc = t
            q = f if self.reloc is self.sift else None
            found = self._relocate(img, mask, query=q) if (allow_reloc and self.atlas.islands) else None
            if found:
                iid, G, n = found
                self.island, self.G = iid, G
                how = "relocated"
                self.fails = 0
                self.stats["relocated"] += 1
            elif self.fails < 1 and self.atlas.islands:
                # One more try before a new piece of map is begun: a fog bank or a turn can hide one frame.
                self.fails += 1
                self.stats["lost"] += 1
                self.prev = None
                return {"how": "lost", "inliers": n}
            elif self.prev is None or self.island is None or self.fails >= 1:
                self.fails = 0
                self.island = self.atlas.new_island()
                self.G = np.eye(3)
                how = "new_island"
                self.stats["new_islands"] += 1
            else:
                self.stats["lost"] += 1
                self.prev = None
                return {"how": "lost", "inliers": n}
        self.atlas.islands[self.island].blend(img, mask, self.G)
        self.prev = (f, img, mask)
        return self.pose(how, n)

    def pose(self, how, n, player=None):
        G = self.G
        p = player if player is not None else self._player
        q = G @ np.array([p[0], p[1], 1.0])
        heading = math.degrees(math.atan2(G[1, 0], G[0, 0]))
        zoom = float(math.sqrt(abs(np.linalg.det(G[:2, :2]))))
        return {"island": self.island, "x": round(float(q[0]), 1), "y": round(float(q[1]), 1),
                "heading": round(heading, 1), "zoom": round(zoom, 3), "how": how, "inliers": int(n)}

    _player = (0.0, 0.0)
