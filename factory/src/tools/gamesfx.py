"""The game's sound without its score, for the game sound bed (GAME_SFX_STEMS, src/assets/gamesfx.ts).

A trailer's or a gameplay video's sound is the game (gunfire, engines, crowds, wind, footsteps) mixed with a score or a
licensed song. The song is a Content ID risk; the game's own sound is what a Short wants under its narration. Here:
  1. Demucs (htdemucs_ft, already in the torch cache: nothing is downloaded) splits drums, bass, other and vocals.
     The vocals go (speech and singing). The four stems are kept in the work folder (demucs_<stem>.npy), so the steps
     below can be re-run without the GPU.
  2. Each of drums, bass and other is split again by HPSS (librosa, soft masks with margins): the strictly tonal part
     (MARGIN_H times the percussive estimate) goes: chords, melody, pads, the bass line. Everything else is kept: the
     percussive part and the noisy residual between the two (wind, rain, engines, crowds). Of the bass only the
     strictly percussive part is kept (an explosion's thump, not a bass line).
  3. A groove is not a gunshot: where what is kept repeats on a steady tempo (the onset envelope's autocorrelation
     over WINDOW seconds, at 40 to 180 beats a minute, the lag and twice the lag both lining up) WHILE a score is
     playing (the removed tonal music at least MUSIC_OVER_DB above what is kept), the stem is taken down by GATE_DB,
     eased over a quarter second. Steady game sounds with no score over them (footsteps, rotors, automatic fire) stay.
Usage: python -I gamesfx.py <in.wav 44.1 kHz stereo> <outdir>
  -> outdir/sfx.wav (the game's sound), outdir/music.wav (everything taken out, for checks), outdir/sfx.json
     {"version", "step", "sfx": [dB], "music": [dB], "beat": [0-1], "gate": [dB], "tonal": [...], "kept", "gatedShare"}
The demucs package's own command line needs an MP3 encoder this PC lacks, so the model is driven directly.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

VERSION = 1
STEP = 0.25  # the levels' grid, seconds
N_FFT = 2048
HOP = 512
MARGIN_H = 3.0  # tonal only where the harmonic estimate is three times the percussive one
MARGIN_P = 3.0  # strictly percussive (used for the bass)
WINDOW = 4.0  # seconds a groove is judged over
WIN_HOP = 0.5
BEAT_MIN = 60 / 180
BEAT_MAX = 60 / 40
BEAT_GATE = 0.45  # autocorrelation peak at which a window repeats on a beat
MUSIC_OVER_DB = 3.0  # ... and counts as a groove only while the removed music is this much louder than what is kept
GATE_DB = -24.0
STEMS = ("drums", "bass", "other", "vocals")


def separate(wav, rate, outdir):
    cached = {s: os.path.join(outdir, f"demucs_{s}.npy") for s in STEMS}
    if all(os.path.exists(p) for p in cached.values()):
        return {s: np.load(p) for s, p in cached.items()}
    import torch
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
    stems = {k: v.cpu().numpy().astype(np.float32) for k, v in zip(model.sources, out)}  # each (2, n)
    for s, p in cached.items():
        np.save(p, stems[s])
    return stems


def split_tonal(x, percussive_only=False):
    """x (2, n) -> (kept, tonal): everything but the strictly tonal part (or only the strictly percussive part)."""
    import librosa

    kept = np.zeros_like(x)
    for ch in range(x.shape[0]):
        S = librosa.stft(x[ch], n_fft=N_FFT, hop_length=HOP)
        H, P = librosa.decompose.hpss(S, margin=(MARGIN_H, MARGIN_P))
        K = P if percussive_only else S - H
        kept[ch] = librosa.istft(K, hop_length=HOP, length=x.shape[1])
    return kept, x - kept


def level_db(x, rate, step):
    mono = x.mean(axis=0)
    n = int(round(step * rate))
    m = len(mono) // n
    if m == 0:
        return np.zeros(0)
    blocks = mono[: m * n].reshape(m, n)
    return 20 * np.log10(np.sqrt((blocks**2).mean(axis=1) + 1e-12) + 1e-9)


def beat_scores(x, rate):
    """The groove score every WIN_HOP seconds: the onset envelope's best normalised autocorrelation at a beat's lag."""
    import librosa

    env = librosa.onset.onset_strength(y=x.mean(axis=0), sr=rate, hop_length=HOP)
    fr = rate / HOP
    win, hop = int(WINDOW * fr), int(WIN_HOP * fr)
    lo, hi = int(BEAT_MIN * fr), int(BEAT_MAX * fr)
    times, scores = [], []
    for a in range(0, max(1, len(env) - win + 1), hop):
        e = env[a: a + win]
        e = e - e.mean()
        d = float((e * e).sum())
        s = 0.0
        if d > 1e-9 and len(e) > 2 * hi:
            ac = np.correlate(e, e, mode="full")[len(e) - 1:] / d
            seg = ac[lo:hi]
            k = int(np.argmax(seg)) + lo
            # A beat repeats: its lag and twice its lag both line up.
            s = float(max(0.0, min(seg.max(), (seg.max() + max(0.0, ac[2 * k])) / 2)))
        times.append((a + win / 2) / fr)
        scores.append(s)
    return np.array(times), np.array(scores)


def gate_steps(times, scores, sfx_db, music_db):
    """The gate per STEP (dB): GATE_DB where a groove runs under a score, eased over a quarter second either side."""
    m = len(sfx_db)
    t = (np.arange(m) + 0.5) * STEP
    beat = np.interp(t, times, scores) if len(times) else np.zeros(m)
    on = (beat >= BEAT_GATE) & (music_db >= sfx_db + MUSIC_OVER_DB)
    db = np.where(on, GATE_DB, 0.0)
    # Close small holes and smooth: a 3-step (0.75 s) moving average of the gate.
    if m >= 3:
        db = np.convolve(db, np.ones(3) / 3, mode="same")
    return beat, db


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    wav, rate = sf.read(src, dtype="float32", always_2d=True)
    stems = separate(wav, rate, outdir)
    n = stems["vocals"].shape[1]
    drums_k, drums_t = split_tonal(stems["drums"])
    other_k, other_t = split_tonal(stems["other"])
    bass_k, bass_t = split_tonal(stems["bass"], percussive_only=True)
    sfx = drums_k + other_k + bass_k
    music = stems["vocals"] + drums_t + other_t + bass_t
    sfx_db = level_db(sfx, rate, STEP)
    music_db = level_db(music, rate, STEP)
    times, scores = beat_scores(sfx, rate)
    beat, gate = gate_steps(times, scores, sfx_db, music_db)
    # The step gate as a per-sample gain, interpolated between step centres (no sample-rate convolution).
    t = np.arange(n) / rate
    centres = (np.arange(len(gate)) + 0.5) * STEP
    gain = (10 ** (np.interp(t, centres, gate) / 20)).astype(np.float32) if len(gate) else np.ones(n, np.float32)
    gated = sfx * gain[None, :]
    removed = music + sfx * (1 - gain[None, :])
    sf.write(os.path.join(outdir, "sfx.wav"), np.clip(gated.T, -1, 1), rate, subtype="PCM_16")
    sf.write(os.path.join(outdir, "music.wav"), np.clip(removed.T, -1, 1), rate, subtype="PCM_16")
    e_all = float((wav.astype(np.float64) ** 2).sum()) + 1e-12
    r1 = lambda a: [round(float(v), 1) for v in a]
    out = {
        "version": VERSION,
        "step": STEP,
        "sfx": r1(level_db(gated, rate, STEP)),
        "music": r1(level_db(removed, rate, STEP)),
        "beat": [round(float(v), 3) for v in beat],
        "gate": r1(gate),
        "kept": round(float((gated.astype(np.float64) ** 2).sum()) / e_all, 4),
        "gatedShare": round(float((gate < GATE_DB / 2).mean()) if len(gate) else 0.0, 3),
    }
    with open(os.path.join(outdir, "sfx.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"separated: kept {out['kept']:.3f} of the energy, {out['gatedShare']:.0%} of the time under a beat", flush=True)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)
