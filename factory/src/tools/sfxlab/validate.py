"""Checks the sound design of a finished render by matched filtering.

Finds every soundscape file (public/sfx/v3) in the video's audio by correlation, estimates the gain it
was mixed at, subtracts it, and measures how far it lifts the mix: over 400 ms (how present it feels)
and 50 ms (whether it jolts), plus its loudness against the narration around it.

With a cue list (the render plan's sfx, as JSON: [{file, frame, volume}] and the music file) each planned
cue is checked where it should be: it must be found within 0.1 s at about its planned gain.

Usage (from the factory dir): python src/tools/sfxlab/validate.py video.mp4 [cues.json]
"""
import glob
import os
import subprocess
import sys

import librosa
import numpy as np
import scipy.signal as sg

SR = 24000
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
# Mix gains from src/render/soundscape.ts (LEVEL; Shorts, long videos run 2 dB lower; under the voice x0.75).
LEVEL = {"sting": 0.436, "swell": 0.218, "land": 0.195, "air": 0.195, "tick": 0.138}
# Limits: a sound may lift the mix this much (dB) before it reads as intrusive.
RISE_MAX = {"sting": 4.5, "swell": 3.0, "land": 3.0, "air": 2.0, "tick": 1.5}
JOLT_MAX = 7.0


def kw(y):
    # The K-weighting coefficients are for 48 kHz; at 24 kHz they are an approximation, fine for differences.
    return sg.lfilter(*_K2, sg.lfilter(*_K1, y))


def loud(y, win):
    z = kw(y) ** 2
    n = max(1, int(win * SR))
    c = np.concatenate([[0], np.cumsum(z)])
    if len(z) < n:
        return np.array([-0.691 + 10 * np.log10(z.mean() + 1e-12)])
    return -0.691 + 10 * np.log10((c[n:] - c[:-n]) / n + 1e-12)


def audio_of(video):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).astype(np.float64)


def planned(video, cues_file):
    """Each planned cue, located within 0.1 s of its frame and measured."""
    import json

    spec = json.load(open(cues_file, encoding="utf-8"))
    x = audio_of(video)
    key = {"music_1.mp3": "D", "music_2.mp3": "D", "music_3.mp3": "E", "music_4.mp3": "E"}.get(os.path.basename(spec.get("music") or ""), "E")
    hits = []
    for c in spec["cues"]:
        name = c["file"].split("/")[-1][:-4]
        path = f"public/sfx/v3/{name}-{key}.mp3"
        path = path if os.path.exists(path) else f"public/sfx/v3/{name}.mp3"
        t = librosa.load(path, sr=SR, mono=True)[0].astype(np.float64)
        at = int(c["frame"] / 30 * SR)
        best = max(range(max(0, at - SR // 10), at + SR // 10, 24), key=lambda p: x[p: p + len(t)] @ t if p + len(t) <= len(x) else -1)
        hits.append((best, os.path.basename(path)[:-4], float(x[best: best + len(t)] @ t / (np.linalg.norm(x[best: best + len(t)]) * np.linalg.norm(t) + 1e-12)), t, c["volume"]))
    return report(video, x, hits)


def check(video):
    x = audio_of(video)
    hits = []
    for path in sorted(glob.glob("public/sfx/v3/*.mp3")):
        t, _ = librosa.load(path, sr=SR, mono=True)
        t = t.astype(np.float64)
        # Normalised cross-correlation: correlation over the template's energy times the local energy.
        c = sg.correlate(x, t, mode="valid", method="fft")
        cs = np.concatenate([[0], np.cumsum(x**2)])
        e = np.sqrt(cs[len(t):] - cs[: -len(t)] + 1e-12)
        ncc = c / (e * np.linalg.norm(t) + 1e-12)
        # A sound mixed 20 dB under the voice correlates weakly, so a match is a peak far above this
        # template's own background correlation (robust z-score), not a fixed height.
        med = np.median(ncc)
        mad = np.median(np.abs(ncc - med)) + 1e-9
        peaks, _ = sg.find_peaks(ncc, height=max(0.05, med + 12 * 1.4826 * mad), distance=SR)
        name = os.path.basename(path)[:-4]
        role = next(r for r in RISE_MAX if name.startswith(r))
        for p in peaks:
            # A real cue sits at its mix gain; a chance likeness (a consonant that resembles the tap) does not.
            g = float(x[p: p + len(t)] @ t / (t @ t))
            if 0.3 * LEVEL[role] <= g <= 1.5 * LEVEL[role]:
                hits.append((p, name, float(ncc[p]), t, None))
    # One sound per moment: where two files match the same spot, keep the better match.
    hits.sort(key=lambda h: -h[2])
    kept = []
    for h in hits:
        if all(abs(h[0] - k[0]) > SR * 0.3 for k in kept):
            kept.append(h)
    kept.sort(key=lambda h: h[0])
    return report(video, x, kept)


def report(video, x, kept):
    ok = True
    print(f"\n{os.path.basename(os.path.dirname(video)) or video}: {len(x) / SR:.1f} s, {len(kept)} sounds found")
    for p, name, score, t, want in kept:
        seg = x[p: p + len(t)]
        g = float(seg @ t / (t @ t))
        # Planned cues must have played at about their planned volume (0.75x under the voice).
        # Only a shortfall counts: music and speech that resemble the sound (a tuned sting in the bed's
        # key) inflate the estimate, so a high reading is not a fault.
        missing = want is not None and g < 0.5 * want
        pad = int(0.6 * SR)
        a, b = max(0, p - pad), min(len(x), p + len(t) + pad)
        mix = x[a:b]
        base = mix.copy()
        base[p - a: p - a + len(t)] -= g * t
        rise = float(np.max(loud(mix, 0.4) - loud(base, 0.4)))
        jolt = float(np.max(loud(mix, 0.05) - loud(base, 0.05)))
        vs = float(loud(g * t, 0.2).max() - np.percentile(loud(base, 0.4), 80))
        role = next(r for r in RISE_MAX if name.startswith(r))
        bad = rise > RISE_MAX[role] or jolt > JOLT_MAX or missing
        ok &= not bad
        print(f"  {p / SR:6.2f}s  {name:9} match {score:.2f}  gain {g:.3f}  rise {rise:4.1f} dB  jolt {jolt:4.1f} dB  vs mix {vs:+5.1f} dB  {'CHECK' if bad else 'ok'}")
    return ok


results = [planned(sys.argv[1], sys.argv[2])] if len(sys.argv) > 2 and sys.argv[2].endswith(".json") else [check(v) for v in sys.argv[1:]]
print("\nPASS" if all(results) else "\nSOME SOUNDS NEED A LOOK")
