"""How good a frame looks, from Apple's Vision framework on the Mac mini (12 Nov 2026).

VNCalculateImageAestheticsScoresRequest (macOS 15+): Apple's own on-device judge of a picture's overall look
(composition, focus, exposure), the one Photos uses for its best shots. Free, local, no model to download. It runs
through the same Python as applevision.py and macocr.py (MAC_OCR_PYTHON, a venv with pyobjc-framework-Vision and
pyobjc-framework-Quartz). Called by src/assets/appleaesthetics.ts.

  appleaesthetics.py <list.json>   list: ["/abs/frame.jpg", ...]
    prints {"results": [{"file", "score", "utility"}]}: score from -1 (poor) to 1 (striking); utility true for a
    picture of a document, receipt or screen grab rather than a scene.

A picture it cannot read gets an error and no score; one bad picture never stops the list. On a Mac older than
macOS 15 every picture gets the error "unsupported".
"""
import json
import sys

import Quartz
import Vision
from Foundation import NSURL


def load(path):
    src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(path), None)
    return Quartz.CGImageSourceCreateImageAtIndex(src, 0, None) if src else None


def score(path):
    out = {"file": path}
    if not hasattr(Vision, "VNCalculateImageAestheticsScoresRequest"):
        out["error"] = "unsupported"
        return out
    try:
        img = load(path)
        if img is None:
            out["error"] = "cannot open image"
            return out
        req = Vision.VNCalculateImageAestheticsScoresRequest.alloc().init()
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, {})
        ok, err = handler.performRequests_error_([req], None)
        if not ok or not req.results():
            out["error"] = str(err) if err else "no result"
            return out
        obs = req.results()[0]
        out["score"] = round(float(obs.overallScore()), 4)
        out["utility"] = bool(obs.isUtility())
    except Exception as e:  # one bad picture never stops the list
        out["error"] = str(e)
    return out


if __name__ == "__main__":
    with open(sys.argv[1]) as f:
        files = json.load(f)
    print(json.dumps({"results": [score(p) for p in files]}))
