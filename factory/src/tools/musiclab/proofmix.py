"""Proof mixes for the series-signature music: each series' sting and bed under a real Short narration, mixed at
the Short composition's own levels (src/render/Short.tsx: the bed at 0.085 under the voice and 0.13 in a pause of
0.9 s or more, rising over 0.8 s and back down 0.3 s before the next word; the sting at LEVEL.sting, a quarter
lower under the voice; the closing sting at 0.9 of that two seconds from the end). Writes <out>/<series>.wav and
the cue list sfxlab/validate.py checks it with, so the stings are found and measured in a finished mix.

Usage (from the factory dir, the audio Python): python src/tools/musiclab/proofmix.py <narration> <out dir>
"""
import json
import os
import sys

import librosa
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000
FPS = 30
LEVEL_STING = 0.436  # src/render/soundscape.ts LEVEL.sting
UNDER_VOICE = 0.75
CLOSE_GAIN = 0.6  # src/render/signature.ts SIGNATURE_CLOSE_GAIN
BED_UNDER, BED_PAUSE = 0.085, 0.13
PAUSE_S, RISE_S, FALL_S = 0.9, 0.8, 0.3


def speaking_mask(voice):
    """1 on 30 fps frames with speech (20 ms loudness within 30 dB of the speech level), with Short.tsx's lead-in and tail."""
    hop = SR // FPS
    n = len(voice) // hop + 1
    rms = np.array([np.sqrt(np.mean(voice[i * hop: (i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    db = 20 * np.log10(rms)
    on = db > np.percentile(db[db > -80], 70) - 30
    m = np.zeros(n, dtype=bool)
    for f in np.nonzero(on)[0]:
        m[max(0, f - 2): min(n, f + 9)] = True
    return m


def bed_envelope(speaking):
    """src/render/musicplan.ts bedEnvelope, frame for frame."""
    n = len(speaking)
    target = np.full(n, BED_UNDER)
    f = 0
    while f < n:
        if speaking[f]:
            f += 1
            continue
        g = f
        while g < n and not speaking[g]:
            g += 1
        if g - f >= round(PAUSE_S * FPS) or f == 0 or g == n:
            target[f:g] = BED_PAUSE
        f = g
    out = np.zeros(n)
    up = (BED_PAUSE - BED_UNDER) / (RISE_S * FPS)
    down = (BED_PAUSE - BED_UNDER) / (FALL_S * FPS)
    level = target[0]
    for i in range(n):
        level = min(target[i], level + up) if target[i] > level else target[i]
        out[i] = level
    for i in range(n - 2, -1, -1):
        out[i] = min(out[i], out[i + 1] + down)
    fade = np.clip(np.arange(n) / 12, 0, 1)  # Short.tsx fades the music in over 12 frames
    return out * fade


def per_sample(frames_curve, length):
    hop = SR // FPS
    return np.repeat(frames_curve, hop)[:length] if len(frames_curve) * hop >= length else np.pad(np.repeat(frames_curve, hop), (0, length))[:length]


def load(path):
    y, _ = librosa.load(path, sr=SR, mono=False)
    y = np.atleast_2d(y)
    return np.vstack([y, y]) if y.shape[0] == 1 else y


def main():
    narration, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    lib_src = open(os.path.join("src", "render", "signaturelib.ts"), encoding="utf-8").read()
    lib = json.loads(lib_src.split("SIGNATURE_LIBRARY: SignatureLibrary = ", 1)[1].rsplit(";", 1)[0])
    voice = load(narration)
    total = voice.shape[1] + int(1.5 * SR)
    voice = np.pad(voice, ((0, 0), (0, total - voice.shape[1])))
    mono = voice.mean(axis=0)
    speaking = speaking_mask(mono)
    bed_curve = per_sample(bed_envelope(speaking), total)
    under = per_sample(np.where(speaking, UNDER_VOICE, 1.0), total)
    rows = []
    # The baseline: today's house music (bed_1, E major) and the brand sting in its key, mixed the same way, so a
    # reading that comes from the mix itself (a closing sting over the bare bed) is seen for what it is.
    lib = {"house": {"bed": "music/bed_1.wav", "sting": "v3/sting-E", "key": "E"}, **lib}
    for series, e in lib.items():
        if not e.get("sting"):
            continue
        bed_file = os.path.join("public", e["bed"]) if e.get("bed") else None
        mix = voice.copy()
        if bed_file:
            bed = load(bed_file)
            reps = int(np.ceil(total / bed.shape[1]))
            bed = np.tile(bed, (1, reps))[:, :total]
            mix += bed * bed_curve
        sting = load(os.path.join("public", "sfx", e["sting"] + ".mp3"))
        cues = []
        for frame, vol in ((0, LEVEL_STING), (max(0, round((total / SR - 2.0) * FPS)), LEVEL_STING * 0.9 * (1 if series == "house" else CLOSE_GAIN))):
            at = frame * SR // FPS
            n = min(sting.shape[1], total - at)
            mix[:, at: at + n] += sting[:, :n] * vol * under[at: at + n]
            # validate.py adds the bed's key itself for the brand sting; a signature sting is named as it is.
            name = "v3/sting" if series == "house" else e["sting"]
            cues.append(dict(file=f"sfx/{name}.mp3", frame=frame, volume=vol))
        peak = float(np.max(np.abs(mix)))
        dest = os.path.join(out, f"{series}.wav")
        sf.write(dest, (mix / max(1.0, peak / 0.98)).T.astype(np.float32), SR, subtype="PCM_16")
        json.dump(dict(music=e.get("bed"), cues=cues), open(os.path.join(out, f"{series}.cues.json"), "w"), indent=1)
        rows.append(dict(series=series, file=dest, bed=e.get("bed"), peak=round(peak, 3)))
        print(series, dest, "peak", round(peak, 3), flush=True)
    json.dump(rows, open(os.path.join(out, "mixes.json"), "w"), indent=1)


main()
