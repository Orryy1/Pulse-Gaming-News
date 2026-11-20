"""Subjects in a picture and their cut-outs, from Apple's Vision framework on the Mac mini (12 Nov 2026).

The picture tools that come with macOS, run through the same Python as macocr.py (~/PulseFactory/ocr/bin/python,
a venv with pyobjc-framework-Vision and pyobjc-framework-Quartz; a compiled Swift helper was ruled out on
1 Nov 2026 because the Mac's Command Line Tools refuse their own SDK). Local, free, no model to download.
Called by src/assets/applevision.ts.

  applevision.py boxes <list.json>   list: ["/abs/frame.jpg", ...]
    prints {"results": [{"file", "width", "height", "salient": [...], "objects": [...], "humans": [...],
            "faces": [...], "animals": [...]}]}; each box is {"x", "y", "w", "h", "c"} as fractions of the
    picture with the origin top-left, c the confidence. salient: where a viewer's eye goes (attention-based
    saliency); objects: things that stand out (objectness-based saliency).

  applevision.py lift <jobs.json>    jobs: [{"src": "/abs/in.jpg", "out": "/abs/out.png"}, ...]
    writes each picture's foreground subjects (Vision's foreground instance mask, macOS 14+) as a PNG the size
    of the picture with a clear background; prints {"results": [{"src", "out", "ok", "instances"}]}.

A picture it cannot read gets empty lists or ok false and an error; one bad picture never stops the list.
"""
import json
import sys

import Quartz
import Vision
from Foundation import NSURL


def load(path):
    src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(path), None)
    return Quartz.CGImageSourceCreateImageAtIndex(src, 0, None) if src else None


def box(rect, c):
    # Vision's boxes are 0-1 with the origin bottom-left.
    return {
        "x": round(rect.origin.x, 4),
        "y": round(1 - rect.origin.y - rect.size.height, 4),
        "w": round(rect.size.width, 4),
        "h": round(rect.size.height, 4),
        "c": round(float(c), 3),
    }


def boxes(path):
    page = {"file": path, "width": 0, "height": 0, "salient": [], "objects": [], "humans": [], "faces": [], "animals": []}
    try:
        img = load(path)
        if img is None:
            page["error"] = "cannot open image"
            return page
        page["width"], page["height"] = Quartz.CGImageGetWidth(img), Quartz.CGImageGetHeight(img)
        attention = Vision.VNGenerateAttentionBasedSaliencyImageRequest.alloc().init()
        objectness = Vision.VNGenerateObjectnessBasedSaliencyImageRequest.alloc().init()
        humans = Vision.VNDetectHumanRectanglesRequest.alloc().init()
        humans.setUpperBodyOnly_(False)
        faces = Vision.VNDetectFaceRectanglesRequest.alloc().init()
        animals = Vision.VNRecognizeAnimalsRequest.alloc().init()
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, {})
        ok, err = handler.performRequests_error_([attention, objectness, humans, faces, animals], None)
        if not ok:
            page["error"] = str(err)
            return page
        for key, req in (("salient", attention), ("objects", objectness)):
            for obs in req.results() or []:
                for o in obs.salientObjects() or []:
                    page[key].append(box(o.boundingBox(), o.confidence()))
        for key, req in (("humans", humans), ("faces", faces), ("animals", animals)):
            for o in req.results() or []:
                page[key].append(box(o.boundingBox(), o.confidence()))
    except Exception as e:  # one bad picture never stops the list
        page["error"] = str(e)
    return page


def coverage(cg):
    """Where the cut-out stands: the opaque share of the picture, its box and its centre across (0-1)."""
    W, H = 128, max(1, round(128 * Quartz.CGImageGetHeight(cg) / max(1, Quartz.CGImageGetWidth(cg))))
    ctx = Quartz.CGBitmapContextCreate(
        None, W, H, 8, W * 4, Quartz.CGColorSpaceCreateDeviceRGB(), Quartz.kCGImageAlphaPremultipliedLast
    )
    Quartz.CGContextDrawImage(ctx, Quartz.CGRectMake(0, 0, W, H), cg)
    data = bytes(Quartz.CGDataProviderCopyData(Quartz.CGImageGetDataProvider(Quartz.CGBitmapContextCreateImage(ctx))))
    total = sx = 0.0
    xs, ys = [], []
    for y in range(H):
        row = y * W * 4
        for x in range(W):
            a = data[row + x * 4 + 3]
            if a > 127:
                total += 1
                sx += x
                xs.append(x)
                ys.append(y)
    if not total:
        return {"share": 0}
    # The bitmap's rows run top to bottom here, as the picture does.
    return {
        "share": round(total / (W * H), 4),
        "x": round((sx / total + 0.5) / W, 4),
        "box": [round(min(xs) / W, 4), round(min(ys) / H, 4), round((max(xs) + 1) / W, 4), round((max(ys) + 1) / H, 4)],
    }


def lift(job):
    res = {"src": job["src"], "out": job["out"], "ok": False, "instances": 0}
    try:
        img = load(job["src"])
        if img is None:
            res["error"] = "cannot open image"
            return res
        req = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, {})
        ok, err = handler.performRequests_error_([req], None)
        if not ok:
            res["error"] = str(err)
            return res
        results = req.results() or []
        if not results:
            res["error"] = "no subject"
            return res
        obs = results[0]
        instances = obs.allInstances()
        res["instances"] = instances.count()
        buf, err = obs.generateMaskedImageOfInstances_fromRequestHandler_croppedToInstancesExtent_error_(
            instances, handler, False, None
        )
        if buf is None:
            res["error"] = str(err)
            return res
        ci = Quartz.CIImage.imageWithCVPixelBuffer_(buf)
        cg = Quartz.CIContext.contextWithOptions_(None).createCGImage_fromRect_(ci, ci.extent())
        dest = Quartz.CGImageDestinationCreateWithURL(NSURL.fileURLWithPath_(job["out"]), "public.png", 1, None)
        Quartz.CGImageDestinationAddImage(dest, cg, None)
        res["ok"] = bool(Quartz.CGImageDestinationFinalize(dest))
        res.update(coverage(cg))
    except Exception as e:
        res["error"] = str(e)
    return res


def main():
    mode, listfile = sys.argv[1], sys.argv[2]
    with open(listfile, encoding="utf-8") as f:
        items = json.load(f)
    if mode == "boxes":
        out = [boxes(p) for p in items]
    elif mode == "lift":
        out = [lift(j) for j in items]
    else:
        raise SystemExit(f"unknown mode {mode}")
    sys.stdout.write(json.dumps({"results": out}))


if __name__ == "__main__":
    main()
