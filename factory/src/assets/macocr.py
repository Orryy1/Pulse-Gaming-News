"""Words and their boxes in a picture, from the text recogniser built into macOS (Apple's Vision framework).

The Mac's twin of winocr.ps1: local and free. Run by src/assets/ocr.ts through ~/PulseFactory/ocr/bin/python
(a venv with pyobjc-framework-Vision and pyobjc-framework-Quartz, made by mac/migrate.sh prepare; a compiled
Swift helper was tried first, 1 Nov 2026, but the Mac's Command Line Tools refuse their own SDK). Called with
a JSON list of image paths; prints one JSON object in the Windows engine's shape:
{ "results": [ { "file": ..., "width": w, "height": h, "words": [ { "text", "x", "y", "w", "h" } ] } ] }
in pixels of the picture, top-left origin. A picture it cannot read gets an empty word list and an error.
"""
import json
import re
import sys

import Quartz
import Vision
from Foundation import NSURL


def read(path):
    page = {"file": path, "width": 0, "height": 0, "words": []}
    try:
        src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(path), None)
        img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None) if src else None
        if img is None:
            page["error"] = "cannot open image"
            return page
        W, H = Quartz.CGImageGetWidth(img), Quartz.CGImageGetHeight(img)
        page["width"], page["height"] = W, H
        req = Vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        req.setUsesLanguageCorrection_(False)
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, {})
        ok, err = handler.performRequests_error_([req], None)
        if not ok:
            page["error"] = str(err)
            return page
        for obs in req.results() or []:
            cands = obs.topCandidates_(1)
            if not cands:
                continue
            cand = cands[0]
            line = cand.string()
            # One box a word, as the Windows engine gives: each run of non-space characters in the line.
            for m in re.finditer(r"\S+", line):
                box, _ = cand.boundingBoxForRange_error_((m.start(), m.end() - m.start()), None)
                if box is None:
                    continue
                r = box.boundingBox()
                # Vision's boxes are 0-1 with the origin bottom-left.
                page["words"].append({
                    "text": m.group(0),
                    "x": r.origin.x * W,
                    "y": (1 - r.origin.y - r.size.height) * H,
                    "w": r.size.width * W,
                    "h": r.size.height * H,
                })
    except Exception as e:  # one bad picture never stops the list
        page["error"] = str(e)
    return page


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        files = json.load(f)
    sys.stdout.write(json.dumps({"results": [read(p) for p in files]}))


if __name__ == "__main__":
    main()
