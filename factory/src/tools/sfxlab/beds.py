"""Music bed forensics: how a bed sits under the narrator and how it loops.

Per bed: length, integrated loudness and range, how much of its energy sits in the speech band
(1-4 kHz, where it masks words), whether it carries a lead melody (pitched energy above 500 Hz),
how busy it is (onsets per second), how much it changes over time (how repetitive a long video
feels), and the loop seam (the jump in level and colour where the file restarts).

Usage (from the factory dir): python src/tools/sfxlab/beds.py public/music_*.mp3
"""
import json
import subprocess
import sys

import librosa
import numpy as np

SR = 44100


def lufs(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    tail = out[out.rfind("Summary:"):]
    get = lambda k: float(tail.split(k)[1].split()[0])
    return get("I:"), get("LRA:")


def bed(path):
    y, _ = librosa.load(path, sr=SR, mono=True)
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)) ** 2
    fr = librosa.fft_frequencies(sr=SR, n_fft=4096)
    SA = S * (10 ** (librosa.A_weighting(fr) / 10))[:, None]
    share = lambda lo, hi: float(SA[(fr >= lo) & (fr < hi)].sum() / SA.sum())
    harm = librosa.effects.harmonic(y)
    H = np.abs(librosa.stft(harm, n_fft=4096, hop_length=1024)) ** 2
    lead = float(H[fr > 500].sum() / (H.sum() + 1e-12))
    onsets = librosa.onset.onset_detect(y=y, sr=SR, units="time")
    # Repetition: mean similarity of 4 s chroma+MFCC blocks to each other (1 = the same throughout).
    feat = np.vstack([librosa.feature.chroma_cqt(y=y, sr=SR), librosa.feature.mfcc(y=y, sr=SR, n_mfcc=13)[1:] / 50])
    blk = int(4 * SR / 512)
    blocks = [feat[:, i: i + blk].mean(axis=1) for i in range(0, feat.shape[1] - blk, blk)]
    B = np.array(blocks)
    B = (B - B.mean(axis=0)) / (B.std(axis=0) + 1e-9)
    sim = np.corrcoef(B)
    variety = float(1 - np.mean(sim[np.triu_indices(len(B), 1)]))
    # Loop seam: level (dB) and spectral (correlation) jump between the last and first 200 ms.
    n = int(0.2 * SR)
    a, b = y[-n:], y[:n]
    rms = lambda z: 20 * np.log10(np.sqrt(np.mean(z**2)) + 1e-9)
    spec = lambda z: np.abs(np.fft.rfft(z * np.hanning(len(z))))[: n // 4]
    seam_db = float(rms(b) - rms(a))
    seam_colour = float(np.corrcoef(np.log(spec(a) + 1e-9), np.log(spec(b) + 1e-9))[0, 1])
    I, LRA = lufs(path)
    return dict(
        file=path.replace("\\", "/").split("/")[-1],
        seconds=round(len(y) / SR, 1),
        lufs=I,
        lra=LRA,
        speech_band=round(share(1000, 4000), 3),
        low=round(share(0, 250), 3),
        lead=round(lead, 3),
        onsets_per_s=round(len(onsets) / (len(y) / SR), 2),
        variety=round(variety, 3),
        tempo=round(float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=SR)[0])[0])),
        seam_db=round(seam_db, 1),
        seam_colour=round(seam_colour, 2),
        tail_db=round(float(rms(a)), 1),
        head_db=round(float(rms(b)), 1),
    )


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(json.dumps(bed(p)))
