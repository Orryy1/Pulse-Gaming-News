"""Does any signature file resemble a known track? A landmark fingerprint check, free and local.

The method is the one audio-recognition services use (spectrogram peak pairs hashed with their time gap, a match
being many hashes that agree on one time offset): robust to level, EQ, a voice over the top and lossy encoding,
so a generated piece that reproduced part of a recording would light up here. It compares every query file with
a reference corpus (the channel's other music, the Epidemic and ElevenLabs libraries on the PC, and each other),
after first proving itself on controls: an excerpt of a reference, re-encoded with a voice and noise over it,
must be found (positive), and unrelated pairs must score low (negative). A query is flagged when its best match
shares MATCH_HASHES aligned hashes and MATCH_SHARE of its own hashes with one reference.

When ACOUSTID_API_KEY is set and pyacoustid with fpcalc is installed, each query is also looked up in the public
AcoustID database (about 50 million recordings); without a key that step is reported as not run.

Usage (the audio Python, isolated: D:/pulse-tools/pulse-python-runtime on the PC): python fingerprint.py --query <files...> --corpus <dirs or files...> [--report out.json]
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter, defaultdict

import librosa
import numpy as np
import scipy.ndimage as ndi

SR = 8000
N_FFT = 1024
HOP = 256
FAN = 6
DT_MAX = 64  # frames (about 2 s)
MATCH_HASHES = 80  # calibrated 14 Nov 2026: unrelated tracks peaked at 43, 12 s excerpts under a voice at 133+
MATCH_SHARE = 0.01
AUDIO = (".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac")


def peaks(y):
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    D = librosa.amplitude_to_db(S, ref=np.max)
    mx = ndi.maximum_filter(D, size=(15, 11))
    f, t = np.nonzero((D == mx) & (D > -55))
    # Keep the strongest per frame band, at most 30 a second.
    order = np.argsort(t)
    return list(zip(t[order], f[order]))


def hashes(y):
    pk = peaks(y)
    out = []
    for i, (t1, f1) in enumerate(pk):
        n = 0
        for t2, f2 in pk[i + 1:]:
            dt = t2 - t1
            if dt < 1:
                continue
            if dt > DT_MAX:
                break
            if abs(int(f2) - int(f1)) > 120:
                continue
            out.append(((int(f1), int(f2), int(dt)), int(t1)))
            n += 1
            if n >= FAN:
                break
    return out


def load(path, offset=0.0, duration=None):
    y, _ = librosa.load(path, sr=SR, mono=True, offset=offset, duration=duration)
    return y


class Index:
    def __init__(self):
        self.table = defaultdict(list)
        self.names = []

    def add(self, name, hs):
        k = len(self.names)
        self.names.append(name)
        for h, t in hs:
            self.table[h].append((k, t))

    def best(self, hs, skip=()):
        votes = Counter()
        for h, t in hs:
            for k, tr in self.table.get(h, ()):
                if k not in skip:
                    votes[(k, tr - t)] += 1
        if not votes:
            return None, 0
        per = Counter()
        for (k, _), v in votes.items():
            per[k] = max(per[k], v)
        k, v = per.most_common(1)[0]
        return self.names[k], v


def stem(path):
    """A track's identity: its file name without the extension (a pocketed .flac copy is the same track)."""
    return os.path.splitext(os.path.basename(path))[0]


def same(idx, path):
    return {k for k, n in enumerate(idx.names) if stem(n) == stem(path)}


def files_in(items):
    out = []
    for it in items:
        if os.path.isdir(it):
            out += [p for p in glob.glob(os.path.join(it, "**", "*"), recursive=True) if p.lower().endswith(AUDIO)]
        elif os.path.isfile(it):
            out.append(it)
    return sorted(set(os.path.normpath(p) for p in out))


def acoustid_lookup(path):
    key = os.environ.get("ACOUSTID_API_KEY", "")
    if not key:
        return "not run: no ACOUSTID_API_KEY"
    try:
        import acoustid  # pyacoustid, needs fpcalc
    except ImportError:
        return "not run: pyacoustid is not installed"
    try:
        res = list(acoustid.match(key, path, parse=True))
        return [dict(score=round(s, 3), recording=r, title=t, artist=a) for s, r, t, a in res[:3]] or "no match"
    except Exception as e:  # network or fpcalc missing
        return f"not run: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", nargs="+", required=True)
    ap.add_argument("--corpus", nargs="+", required=True)
    ap.add_argument("--voice", help="a narration to lay over the positive control")
    ap.add_argument("--report", default="")
    a = ap.parse_args()
    queries = files_in(a.query)
    corpus = [p for p in files_in(a.corpus) if p not in queries]
    idx = Index()
    lengths = {}
    for p in corpus:
        try:
            # The first five minutes of each reference: enough for any bed or cue, quick for long library files.
            hs = hashes(load(p, duration=300))
        except Exception as e:
            print("skip", p, e, file=sys.stderr)
            continue
        idx.add(p, hs)
        lengths[p] = len(hs)
    qidx = Index()
    qh = {}
    for q in queries:
        qh[q] = hashes(load(q))
        qidx.add(q, qh[q])
    print(f"corpus {len(idx.names)} files, {sum(lengths.values())} hashes; {len(queries)} queries", flush=True)

    # Controls. Positive: 12 s of a reference (half-way in), a voice laid over it at speech level, noise, an MP3-like
    # low-pass. It must be found, with its share above the threshold.
    rng = np.random.default_rng(3)
    controls = []
    picks = [idx.names[i] for i in rng.choice(len(idx.names), size=min(8, len(idx.names)), replace=False)] if idx.names else []
    voice = load(a.voice) if a.voice else None
    for ref in picks:
        dur = librosa.get_duration(path=ref)
        y = load(ref, offset=max(0.0, min(dur - 13, dur / 2)), duration=12)
        if len(y) < SR * 6:
            continue
        mix = 0.5 * y / (np.max(np.abs(y)) + 1e-9)
        if voice is not None and len(voice) > len(mix):
            v = voice[: len(mix)]
            mix = mix + 0.6 * v / (np.max(np.abs(v)) + 1e-9)
        mix = mix + 0.01 * rng.standard_normal(len(mix))
        mix = librosa.effects.preemphasis(mix, coef=-0.3)
        hs = hashes(mix.astype(np.float32))
        name, votes = idx.best(hs)
        controls.append(dict(kind="positive", ref=os.path.basename(ref), found=os.path.basename(name or ""), votes=votes,
                             share=round(votes / max(1, len(hs)), 3), ok=bool(name and stem(name) == stem(ref) and votes >= MATCH_HASHES)))
    # Negative: each query against the corpus is the test itself; as a control, the corpus files against each other
    # (different tracks should not match).
    neg = []
    for ref in picks:
        hs = hashes(load(ref, duration=60))
        name, votes = idx.best(hs, skip=same(idx, ref))
        neg.append(dict(kind="negative", ref=os.path.basename(ref), nearest=os.path.basename(name or ""), votes=votes,
                        share=round(votes / max(1, len(hs)), 3)))
    rows = []
    for q in queries:
        hs = qh[q]
        name, votes = idx.best(hs)
        qname, qvotes = qidx.best(hs, skip={qidx.names.index(q)})
        share = votes / max(1, len(hs))
        flag = votes >= MATCH_HASHES and share >= MATCH_SHARE
        rows.append(dict(
            file=os.path.basename(q),
            hashes=len(hs),
            nearest=os.path.basename(name or ""),
            aligned=votes,
            share=round(share, 4),
            nearest_signature=os.path.basename(qname or ""),
            aligned_signature=qvotes,
            resembles_known=flag,
            acoustid=acoustid_lookup(q),
        ))
        print(f"{os.path.basename(q):34} nearest {os.path.basename(name or '-')[:40]:40} aligned {votes:4d} share {share:.4f} {'FLAG' if flag else 'clear'}", flush=True)
    passed = all(c["ok"] for c in controls) and controls
    report = dict(
        method="landmark fingerprint (spectrogram peak pairs, offset-aligned votes), 8 kHz",
        thresholds=dict(aligned_hashes=MATCH_HASHES, share=MATCH_SHARE),
        corpus_files=len(idx.names),
        controls=controls + neg,
        controls_passed=bool(passed),
        queries=rows,
        any_flagged=any(r["resembles_known"] for r in rows),
    )
    print("controls", "PASS" if passed else "FAIL", "| flagged:", sum(r["resembles_known"] for r in rows))
    if a.report:
        json.dump(report, open(a.report, "w", encoding="utf-8"), indent=1)


main()
