"""The game's sound without its score, for the game sound bed (GAME_SFX_STEMS, src/assets/gamesfx.ts).

A trailer's or a gameplay video's sound is the game (gunfire, engines, crowds, wind, footsteps) mixed with a score or a
licensed song. The song is a Content ID risk; the game's own sound is what a Short wants under its narration. Here:
  1. Demucs (htdemucs_ft, already in the torch cache: nothing is downloaded) splits drums, bass, other and vocals.
     The vocals go (speech and singing).
  2. Each of drums, bass and other is split again into its tonal and its percussive and noisy parts (librosa HPSS on
     the STFT, a strict tonal mask). The tonal part goes: chords, melody, pads, the bass line. Kept: drums' and
     other's percussive and noisy parts and bass's percussive part (an explosion's thump).
  3. A groove is not a gunshot: wherever what is kept repeats on a steady tempo (the onset envelope's autocorrelation
     over WINDOW seconds, at 40 to 220 beats a minute), the window is the song's beat and the stem is taken down
     there by GATE_DB, eased over a quarter second.
Usage: python -I gamesfx.py <in.wav 44.1 kHz stereo> <outdir>
  -> outdir/sfx.wav (the game's sound), outdir/music.wav (everything taken out, for checks), outdir/sfx.json
     {"version", "step", "sfx": [dB], "music": [dB], "beat": [0-1], "gate": [dB], "tonal": [0-1], "kept": share}
The demucs package's own command line needs an MP3 encoder this PC lacks, so the model is driven directly.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch

VERSION = 1
STEP = 0.25  # the levels' grid, seconds
N_FFT = 2048
HOP = 512
# HPSS margins: tonal where the harmonic estimate beats the percussive one at all (1.0); percussive where it is three
# times the harmonic (3.0); the rest is the noisy residual (wind, rain, engines), which is kept.
MARGIN = (1.0, 3.0)
WINDOW = 4.0  # seconds a groove is judged over
WIN_HOP = 0.5
BEAT_MIN = 60 / 220
BEAT_MAX = 60 / 40
BEAT_GATE = 0.45  # autocorrelation peak at which a window is a beat
GATE_DB = -24.0
TONAL_PEAK = 0.5  # share of a frame's chroma energy in its strongest pitch class at which it counts as tonal


def separate(wav, rate):
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs_ft")
    model.eval()
    if rate != model.samplerate:
        raise SystemExit(f"expected {model.samplerate} Hz, got {rate}")
    mix = torch.from_numpy(wav.T.copy())
    if mix.shape[0] == 1:
        mix = mix.repeat(2, 1)
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    device = "cuda" if torch.cuda.is_available() else "cpu"
    with torch.no_grad():
        out = apply_model(model, ((mix - mean) / std)[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    out = out * std + mean
    return {k: v.cpu().numpy() for k, v in zip(model.sources, out)}  # each (2, n)


def split_tonal(x, keep_residual=True):
    """x (2, n) -> (kept, tonal): the percussive (and noisy residual) part and the tonal part, same length."""
    import librosa

    kept = np.zeros_like(x)
    for ch in range(x.shape[0]):
        S = librosa.stft(x[ch], n_fft=N_FFT, hop_length=HOP)
        H, P = librosa.decompose.hpss(S, margin=MARGIN)
        K = S - H if keep_residual else P
        kept[ch] = librosa.istft(K, hop_length=HOP, length=x.shape[1])
    return kept, x - kept


def level_db(x, rate, step):
    mono = x.mean(axis=0)
    n = int(round(step * rate))
    m = len(mono) // n
    if m == 0:
        return []
    blocks = mono[: m * n].reshape(m, n)
    rms = np.sqrt((blocks**2).mean(axis=1) + 1e-12)
    return [round(float(v), 1) for v in 20 * np.log10(rms + 1e-9)]


def beat_scores(x, rate):
    """The groove score every WIN_HOP seconds: the onset envelope's best normalised autocorrelation at a beat's lag."""
    import librosa

    mono = x.mean(axis=0)
    env = librosa.onset.onset_strength(y=mono, sr=rate, hop_length=HOP)
    fr = rate / HOP
    win = int(WINDOW * fr)
    hop = int(WIN_HOP * fr)
    lo, hi = int(BEAT_MIN * fr), int(BEAT_MAX * fr)
    times, scores = [], []
    for a in range(0, max(1, len(env) - win + 1), hop):
        e = env[a : a + win]
        e = e - e.mean()
        d = float((e * e).sum())
        if d <= 1e-9 or len(e) <= hi:
            s = 0.0
        else:
            ac = np.correlate(e, e, mode="full")[len(e) - 1 :] / d
            # A beat repeats: its lag and twice its lag both line up.
            seg = ac[lo:hi]
            k = int(np.argmax(seg)) + lo
            twice = ac[2 * k] if 2 * k < len(ac) else 0.0
            s = float(max(0.0, min(seg.max(), (seg.max() + max(0.0, twice)) / 2)))
        times.append((a + win / 2) / fr)
        scores.append(s)
    return np.array(times), np.array(scores)


def gate_curve(times, scores, n, rate):
    """A gain per sample: GATE_DB where the groove score is over BEAT_GATE, eased over a quarter second."""
    t = np.arange(n) / rate
    if len(times) == 0:
        return np.ones(n, dtype=np.float32), np.zeros(n)
    s = np.interp(t, times, scores)
    db = np.where(s >= BEAT_GATE, GATE_DB, 0.0)
    k = int(0.25 * rate)
    if k > 1:
        kernel = np.ones(k) / k
        db = np.convolve(db, kernel, mode="same")
    return (10 ** (db / 20)).astype(np.float32), db


def tonal_shares(x, rate, step):
    """How tonal each step is: the share of its chroma energy in its strongest pitch class (noise ~ 1/12, a chord ~ 0.4+)."""
    import librosa

    mono = x.mean(axis=0)
    C = librosa.feature.chroma_stft(y=mono, sr=rate, n_fft=N_FFT, hop_length=HOP, norm=None)
    peak = C.max(axis=0) / (C.sum(axis=0) + 1e-9)
    fr = rate / HOP
    per = max(1, int(round(step * fr)))
    m = len(peak) // per
    return [round(float(v), 3) for v in peak[: m * per].reshape(m, per).mean(axis=1)] if m else []


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    wav, rate = sf.read(src, dtype="float32", always_2d=True)
    stems = separate(wav, rate)
    n = stems["vocals"].shape[1]
    drums_k, drums_t = split_tonal(stems["drums"])
    other_k, other_t = split_tonal(stems["other"])
    bass_k, bass_t = split_tonal(stems["bass"], keep_residual=False)
    sfx = drums_k + other_k + bass_k
    times, scores = beat_scores(sfx, rate)
    gain, gate_db = gate_curve(times, scores, n, rate)
    gated = sfx * gain[None, :]
    removed = stems["vocals"] + drums_t + other_t + bass_t + sfx * (1 - gain[None, :])
    sf.write(os.path.join(outdir, "sfx.wav"), np.clip(gated.T, -1, 1), rate, subtype="PCM_16")
    sf.write(os.path.join(outdir, "music.wav"), np.clip(removed.T, -1, 1), rate, subtype="PCM_16")
    per = int(round(STEP * rate))
    m = n // per
    beat = np.interp((np.arange(m) + 0.5) * STEP, times, scores) if len(times) else np.zeros(m)
    gate = gate_db[: m * per].reshape(m, per).mean(axis=1) if m else np.zeros(0)
    e_all = float((wav.astype(np.float64) ** 2).sum()) + 1e-12
    out = {
        "version": VERSION,
        "step": STEP,
        "sfx": level_db(gated, rate, STEP),
        "music": level_db(removed, rate, STEP),
        "beat": [round(float(v), 3) for v in beat],
        "gate": [round(float(v), 1) for v in gate],
        "tonal": tonal_shares(gated, rate, STEP),
        "tonalBefore": tonal_shares(wav.T, rate, STEP),
        "kept": round(float((gated.astype(np.float64) ** 2).sum()) / e_all, 4),
        "gatedShare": round(float((np.array(gate) < GATE_DB / 2).mean()) if m else 0.0, 3),
    }
    with open(os.path.join(outdir, "sfx.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"separated: kept {out['kept']:.3f} of the energy, {out['gatedShare']:.0%} of the time under a beat", flush=True)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)
