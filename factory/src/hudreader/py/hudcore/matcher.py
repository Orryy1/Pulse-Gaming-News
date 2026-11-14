"""Feature matching between two map pictures. SIFT (OpenCV, patent expired 2020, Apache-2.0) is always there and is
what frame-to-frame tracking uses. LightGlue with DISK features (ETH Zurich's LightGlue and EPFL's DISK, code and
weights both Apache-2.0; SuperPoint is deliberately not used, its licence is restrictive) is used for the hard case,
finding a minimap again on the stitched map after a gap, when its folder and weights are given."""

import os
import sys
import types

import cv2
import numpy as np


class SiftMatcher:
    name = "sift"

    def __init__(self, nfeatures=1500, ratio=0.8):
        self.sift = cv2.SIFT_create(nfeatures=nfeatures)
        self.ratio = ratio
        self.bf = cv2.BFMatcher(cv2.NORM_L2)

    def features(self, img, mask=None):
        g = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        kp, des = self.sift.detectAndCompute(g, mask)
        pts = np.float32([k.pt for k in kp]) if kp else np.zeros((0, 2), np.float32)
        return pts, des

    def match_features(self, fa, fb):
        pa, da = fa
        pb, db = fb
        if da is None or db is None or len(pa) < 4 or len(pb) < 4:
            return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32)
        good = []
        for pair in self.bf.knnMatch(da, db, k=2):
            if len(pair) == 2 and pair[0].distance < self.ratio * pair[1].distance:
                good.append(pair[0])
        if not good:
            return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32)
        return pa[[m.queryIdx for m in good]], pb[[m.trainIdx for m in good]]

    def match(self, a, ma, b, mb):
        return self.match_features(self.features(a, ma), self.features(b, mb))


class LightGlueMatcher:
    """DISK keypoints matched by LightGlue (torch). `libs`: folder with the lightglue and kornia packages;
    `models`: a torch hub folder whose checkpoints/ holds disk_lightglue_v0-1_arxiv.pth and depth-save.pth."""

    name = "lightglue"

    def __init__(self, libs, models, device=None, max_keypoints=1024):
        if libs and libs not in sys.path:
            sys.path.insert(0, libs)
        # The package's __init__ imports ALIKED, which needs torchvision; only LightGlue and DISK are needed.
        pkg = types.ModuleType("lightglue")
        pkg.__path__ = [os.path.join(libs, "lightglue")]
        sys.modules.setdefault("lightglue", pkg)
        import torch

        torch.hub.set_dir(models)
        from lightglue.disk import DISK
        from lightglue.lightglue import LightGlue

        self.torch = torch
        if device is None:
            device = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
        self.device = device
        self.extractor = DISK(max_num_keypoints=max_keypoints).eval().to(device)
        self.matcher = LightGlue(features="disk").eval().to(device)

    def features(self, img, mask=None):
        torch = self.torch
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB) if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        if mask is not None:
            rgb = rgb * (mask[..., None] > 0)
        t = torch.from_numpy(np.ascontiguousarray(rgb)).permute(2, 0, 1).float().div(255).to(self.device)
        with torch.no_grad():
            f = self.extractor.extract(t, resize=None)
        return f

    def match_features(self, fa, fb):
        torch = self.torch
        with torch.no_grad():
            r = self.matcher({"image0": fa, "image1": fb})
        m = r["matches"][0].cpu().numpy()
        if len(m) == 0:
            return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32)
        ka = fa["keypoints"][0].cpu().numpy()[m[:, 0]]
        kb = fb["keypoints"][0].cpu().numpy()[m[:, 1]]
        return ka.astype(np.float32), kb.astype(np.float32)

    def match(self, a, ma, b, mb):
        return self.match_features(self.features(a, ma), self.features(b, mb))


def similarity(pa, pb, thresh=2.5, min_inliers=10):
    """The rotation-scale-translation taking pa onto pb (2x3), with its inlier count; (None, n) when too weak."""
    if len(pa) < 3:
        return None, 0
    S, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=thresh, maxIters=4000, confidence=0.995)
    n = 0 if inl is None else int(inl.sum())
    if S is None or n < min_inliers:
        return None, n
    scale = float(np.hypot(S[0, 0], S[1, 0]))
    if not (0.3 <= scale <= 3.5):
        return None, n
    return S, n


def make(kind, libs=None, models=None):
    if kind == "lightglue":
        try:
            return LightGlueMatcher(libs, models)
        except Exception as e:  # torch or weights missing: fall back, and say so in the output
            m = SiftMatcher()
            m.fallback = f"{type(e).__name__}: {e}"
            return m
    return SiftMatcher()
