"""The minimap as a flat top-down picture. GTA V draws its radar tilted, like a map lying on a table seen from the
player's shoulder, and turned with the camera. Undoing the tilt (a fixed homography learned by the calibration tool,
two numbers: k, the perspective, and a, the foreshortening) leaves a picture that differs from the next one only by a
turn, a zoom and a shift: a similarity, which is what the stitcher chains."""

import cv2
import numpy as np

from .profile import px_box

REF_HEIGHT = 1080.0


class Minimap:
    def __init__(self, profile, width, height):
        self.p = profile
        self.W, self.H = width, height
        x0, y0, x1, y1 = px_box(profile.get("minimap", "box"), width, height)
        self.box = (x0, y0, x1, y1)
        px, py = profile.get("minimap", "player")
        self.C = np.array([px * width - x0, py * height - y0], np.float64)
        tilt = profile.get("minimap", "tilt", default={"k": 0.0, "a": 1.0})
        self.k = float(tilt.get("k", 0.0)) / height
        self.a = float(tilt.get("a", 1.0))
        self.s = REF_HEIGHT / height  # every map is kept at 1080p scale, whatever the recording
        tl, tt, tr, tb = profile.get("minimap", "trim", default=[0, 0, 0, 0])
        bw, bh = x1 - x0, y1 - y0
        self.trim = (int(tl * bw), int(tt * bh), int(tr * bw), int(tb * bh))
        self.player_r = max(4, int(profile.get("minimap", "playerMaskRadius", default=0.015) * height))
        T = np.array([[1, 0, -self.C[0]], [0, 1 / self.a, -self.C[1] / self.a], [0, self.k, 1 - self.k * self.C[1]]])
        Sc = np.diag([self.s, self.s, 1.0])
        corners = np.array([[self.trim[0], self.trim[1]], [bw - self.trim[2], self.trim[1]],
                            [bw - self.trim[2], bh - self.trim[3]], [self.trim[0], bh - self.trim[3]]], np.float64)
        pts = cv2.perspectiveTransform(corners[None], Sc @ T)[0]
        mn, mx = pts.min(0), pts.max(0)
        self.O = np.array([[1, 0, -mn[0] + 4], [0, 1, -mn[1] + 4], [0, 0, 1.0]])
        self.Hu = self.O @ Sc @ T
        self.size = (int(np.ceil(mx[0] - mn[0] + 8)), int(np.ceil(mx[1] - mn[1] + 8)))
        # The player's own point in the flat picture (the arrow, at C in the radar).
        self.player = (self.O @ np.array([0, 0, 1.0]))[:2]

    def raw(self, frame):
        x0, y0, x1, y1 = self.box
        return frame[y0:y1, x0:x1]

    def mask(self, crop):
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        v = hsv[..., 2]
        m = ((hsv[..., 1] < 60) & (v > 25) & (v < 235)).astype(np.uint8) * 255
        l, t, r, b = self.trim
        h, w = m.shape
        m[:t, :] = 0
        m[:, :l] = 0
        if r:
            m[:, w - r:] = 0
        if b:
            m[h - b:, :] = 0
        cv2.circle(m, (int(self.C[0]), int(self.C[1])), self.player_r, 0, -1)
        return cv2.erode(m, np.ones((5, 5), np.uint8))

    def flat(self, frame):
        """(top-down picture, its mask) at 1080p scale."""
        c = self.raw(frame)
        m = self.mask(c)
        img = cv2.warpPerspective(c, self.Hu, self.size, flags=cv2.INTER_LINEAR)
        msk = cv2.warpPerspective(m, self.Hu, self.size, flags=cv2.INTER_NEAREST)
        return img, msk

    def altimeter(self, frame):
        """True when the aircraft altimeter (a column of short dashes up the radar's middle) is drawn."""
        box = self.p.get("minimap", "altimeter", "box")
        if not box:
            return False
        x0, y0, x1, y1 = px_box(box, self.W, self.H)
        c = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        if c.size == 0:
            return False
        dark = (c < 45).mean(axis=1) > 0.45
        dashes, prev = 0, False
        for d in dark:
            if d and not prev:
                dashes += 1
            prev = d
        return dashes >= self.p.get("minimap", "altimeter", "minDashes", default=4)


def learn_tilt(pairs, C, k_range=(0.0, 0.012), a_range=(0.3, 1.2), steps=(49, 37)):
    """The tilt (k per pixel, a) that makes successive radar views differ by a similarity (calibration).

    `pairs`: [(pts_a, pts_b)] matched radar points of successive frames (inliers of a homography), in crop pixels;
    C: the player's point in the crop. The score is each pair's median screen-space error after undoing the tilt,
    fitting a similarity, and putting the tilt back, so a degenerate tilt that shrinks everything cannot win."""

    def unwarp(p, k, a):
        y = p[:, 1] - C[1]
        w = 1 + k * y
        return np.stack([(p[:, 0] - C[0]) / w, y / (a * w)], 1)

    def warp(u, k, a):
        w = 1 / (1 - k * a * u[:, 1])
        return np.stack([u[:, 0] * w + C[0], a * u[:, 1] * w + C[1]], 1)

    def score(k, a):
        tot = 0.0
        for pa, pb in pairs:
            ua, ub = unwarp(pa, k, a), unwarp(pb, k, a)
            S, _ = cv2.estimateAffinePartial2D(ua.astype(np.float32), ub.astype(np.float32), method=cv2.LMEDS)
            if S is None:
                tot += 1e3
                continue
            r = np.linalg.norm(warp(ua @ S[:, :2].T + S[:, 2], k, a) - pb, axis=1)
            tot += float(np.median(r))
        return tot / max(1, len(pairs))

    best = (score(0.0, 1.0), 0.0, 1.0)
    identity = best[0]
    for k in np.linspace(*k_range, steps[0]):
        for a in np.linspace(*a_range, steps[1]):
            s = score(k, a)
            if s < best[0]:
                best = (s, float(k), float(a))
    # One finer pass around the best.
    s0, k0, a0 = best
    dk = (k_range[1] - k_range[0]) / steps[0]
    da = (a_range[1] - a_range[0]) / steps[1]
    for k in np.linspace(k0 - dk, k0 + dk, 9):
        for a in np.linspace(a0 - da, a0 + da, 9):
            s = score(k, a)
            if s < best[0]:
                best = (s, float(k), float(a))
    return {"k": best[1], "a": best[2], "error": round(best[0], 3), "untiltedError": round(identity, 3)}
