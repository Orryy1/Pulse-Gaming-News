"""Acoustic fingerprint of sound effects: what makes one soothing and another jarring.

Usage: python -I forensics.py file1.mp3 [file2 ...]  -> one JSON object per line.
"""
import json
import sys

import librosa
import numpy as np


def features(path: str) -> dict:
    y, sr = librosa.load(path, sr=48000, mono=True)
    y = y / (np.max(np.abs(y)) + 1e-9)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=256)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    total = S.sum() + 1e-12
    band = lambda lo, hi: float(S[(freqs >= lo) & (freqs < hi)].sum() / total)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=128)[0]
    t = np.arange(len(rms)) * 128 / sr
    peak_i = int(np.argmax(rms))
    pk = rms[peak_i] + 1e-12
    pre = rms[: peak_i + 1]
    i10 = int(np.argmax(pre >= 0.1 * pk)) if len(pre) else 0
    i90 = int(np.argmax(pre >= 0.9 * pk)) if len(pre) else 0
    post = rms[peak_i:]
    below = np.where(post < pk * 10 ** (-30 / 20))[0]
    decay = float(below[0] * 128 / sr) if len(below) else float(len(post) * 128 / sr)
    # Steepest one-frame jump in loudness (dB): a sharp transient reads as a click or a jolt.
    env_db = 20 * np.log10(rms + 1e-6)
    jump = float(np.max(np.diff(env_db))) if len(env_db) > 1 else 0.0
    harm, perc = librosa.effects.hpss(y)
    tonal = float(np.sum(harm**2) / (np.sum(harm**2) + np.sum(perc**2) + 1e-12))
    f0 = None
    if tonal > 0.5:
        spec = np.abs(np.fft.rfft(harm * np.hanning(len(harm))))
        fr = np.fft.rfftfreq(len(harm), 1 / sr)
        m = (fr > 60) & (fr < 4000)
        f0 = float(fr[m][np.argmax(spec[m])])
    return {
        "file": path.replace("\\", "/").split("/")[-1],
        "seconds": round(len(y) / sr, 2),
        "centroid_hz": round(float(librosa.feature.spectral_centroid(S=S, sr=sr).mean())),
        "rolloff85_hz": round(float(librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.85).mean())),
        "low_<200": round(band(0, 200), 3),
        "mid_200_2k": round(band(200, 2000), 3),
        "presence_2k_6k": round(band(2000, 6000), 3),
        "air_>6k": round(band(6000, 24000), 3),
        "attack_ms": round((t[i90] - t[i10]) * 1000) if i90 >= i10 else 0,
        "max_jump_db": round(jump, 1),
        "crest_db": round(float(20 * np.log10(1 / (np.sqrt(np.mean(y**2)) + 1e-9))), 1),
        "flatness": round(float(librosa.feature.spectral_flatness(S=S).mean()), 3),
        "tonal": round(tonal, 2),
        "pitch_hz": round(f0) if f0 else None,
        "note": librosa.hz_to_note(f0) if f0 else None,
        "decay_ms": round(decay * 1000),
    }


for p in sys.argv[1:]:
    print(json.dumps(features(p)))
