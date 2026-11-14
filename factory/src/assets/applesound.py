"""What can be heard in a stretch of game audio, from Apple's Sound Analysis framework on the Mac mini (12 Nov 2026).

SNClassifySoundRequest with Apple's built-in classifier (about 300 sounds: speech, laughter, crowd, music,
explosion, gunshot, car crash and so on), on device, free, no model to download. Runs through the same Python as
applevision.py (MAC_OCR_PYTHON, with pyobjc-framework-SoundAnalysis and pyobjc-framework-AVFoundation added by
mac/migrate.sh prepare). Called by src/assets/applesound.ts and mac/gameplay/soundtags.mjs.

  applesound.py <audio.wav> [min_confidence]
    prints {"file", "windows": [{"t", "d", "top": [[label, confidence], ...]}]}: one entry per analysis window
    (about a second, half overlapping), t and d in seconds, the window's sounds at or above min_confidence
    (default 0.1), most confident first, at most eight.
  applesound.py --labels
    prints {"labels": [...]}: every sound the built-in classifier knows.

A file it cannot read prints {"file", "error"} and exits 0: the caller treats it as "nothing heard".
"""
import json
import sys

import objc
import SoundAnalysis
from Foundation import NSURL, NSObject

SNResultsObserving = objc.protocolNamed("SNResultsObserving")


def seconds(t):
    # CMTime arrives as a tuple-like struct: (value, timescale, flags, epoch).
    value, scale = t[0], t[1]
    return float(value) / float(scale) if scale else 0.0


class Collector(NSObject, protocols=[SNResultsObserving]):
    def init(self):
        self = objc.super(Collector, self).init()
        self.windows = []
        self.error = None
        self.min_conf = 0.1
        return self

    def request_didProduceResult_(self, request, result):
        tr = result.timeRange()
        top = [
            [c.identifier(), round(float(c.confidence()), 3)]
            for c in result.classifications()
            if float(c.confidence()) >= self.min_conf
        ][:8]
        self.windows.append({"t": round(seconds(tr[0]), 3), "d": round(seconds(tr[1]), 3), "top": top})

    def request_didFailWithError_(self, request, error):
        self.error = str(error)

    def requestDidComplete_(self, request):
        pass


def request():
    req, err = SoundAnalysis.SNClassifySoundRequest.alloc().initWithClassifierIdentifier_error_(
        SoundAnalysis.SNClassifierIdentifierVersion1, None
    )
    if req is None:
        raise RuntimeError(str(err))
    return req


def classify(path, min_conf):
    analyzer, err = SoundAnalysis.SNAudioFileAnalyzer.alloc().initWithURL_error_(NSURL.fileURLWithPath_(path), None)
    if analyzer is None:
        return {"file": path, "error": str(err)}
    collector = Collector.alloc().init()
    collector.min_conf = min_conf
    ok, err = analyzer.addRequest_withObserver_error_(request(), collector, None)
    if not ok:
        return {"file": path, "error": str(err)}
    analyzer.analyze()  # synchronous: every window has been reported when it returns
    out = {"file": path, "windows": collector.windows}
    if collector.error:
        out["error"] = collector.error
    return out


if __name__ == "__main__":
    if sys.argv[1] == "--labels":
        print(json.dumps({"labels": list(request().knownClassifications())}))
        sys.exit(0)
    try:
        result = classify(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.1)
    except Exception as e:  # never a traceback for the caller to parse
        result = {"file": sys.argv[1], "error": str(e)}
    print(json.dumps(result))
