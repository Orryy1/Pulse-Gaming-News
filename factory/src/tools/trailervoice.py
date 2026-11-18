"""Splits a trailer's sound into the spoken voice and everything else, for trailer voice lines (src/tools/trailerlines.ts).

Demucs (htdemucs_ft, already in the torch cache: nothing is downloaded) separates the vocals; the pitch of the vocals
is then read every 10 ms (librosa's yin) so a sung lyric can be told from a spoken line (a held, steady note).
Usage: python trailervoice.py <in.wav 44.1 kHz stereo> <outdir>
  -> <outdir>/vocals.wav, <outdir>/music.wav, <outdir>/features.json {"hop": 0.01, "f0": [...], "rms": [...]}
The demucs package's own command line needs an MP3 encoder this PC lacks, so the model is driven directly.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch


def separate(src, outdir):
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs_ft")
    model.eval()
    wav, rate = sf.read(src, dtype="float32", always_2d=True)
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
    stems = dict(zip(model.sources, out))
    vocals = stems["vocals"].cpu().numpy().T
    music = sum(v for k, v in stems.items() if k != "vocals").cpu().numpy().T
    sf.write(os.path.join(outdir, "vocals.wav"), vocals, rate, subtype="PCM_16")
    sf.write(os.path.join(outdir, "music.wav"), music, rate, subtype="PCM_16")
    return vocals.mean(axis=1), rate


def features(mono, rate):
    import librosa

    y = librosa.resample(mono, orig_sr=rate, target_sr=16000)
    hop = 160  # 10 ms
    f0 = librosa.yin(y, fmin=70, fmax=900, sr=16000, frame_length=1024, hop_length=hop)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]
    db = 20 * np.log10(rms + 1e-9)
    # yin always answers; a frame counts as voiced only where the voice is actually there.
    voiced = db > max(-45.0, float(np.percentile(db, 95)) - 30.0)
    f0 = np.where(voiced[: len(f0)], f0, 0.0)
    return {"hop": 0.01, "f0": [round(float(x), 1) for x in f0], "rms": [round(float(x), 1) for x in db]}


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    mono, rate = separate(src, outdir)
    with open(os.path.join(outdir, "features.json"), "w", encoding="utf-8") as f:
        json.dump(features(mono, rate), f)
    print("separated", flush=True)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)
