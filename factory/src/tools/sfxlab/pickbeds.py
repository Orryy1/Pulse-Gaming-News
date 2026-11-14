"""Chooses the channel's music beds by measurement and writes them to public/music.

Candidates: the original Suno beds and ElevenLabs Music generations (data/sfxlab/beds/*.mp3). Each is
cut into a seamless beat-aligned loop (loop.py), moved to the nearer of the soundscape's two keys (D or
E major, so the tuned sound effects always fit; pitch only, tempo kept), matched for loudness, then
scored for life under a narrator: little energy in the speech band, no lead melody, steady, not
frantic, audible on a phone, a clean loop. The best four are kept.

Usage (from the factory dir): python src/tools/sfxlab/pickbeds.py
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

import librosa
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from beds import bed  # noqa: E402

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
TARGET_LUFS = -12.7  # the old beds' average, so the render's music levels keep their meaning
WORK = os.path.join("data", "sfxlab", "beds")
OUT = os.path.join("public", "music")


def retune(path):
    """(semitones, key, fit): the smallest pitch move that puts the bed's notes in D or E major."""
    y, sr = librosa.load(path, sr=22050, mono=True, duration=120)
    c = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    best = None
    for k in ("D", "E"):
        prof = np.roll(MAJOR, NAMES.index(k))
        for s in range(-3, 4):
            fit = float(np.corrcoef(np.roll(c, s), prof)[0, 1]) - 0.02 * abs(s)
            if best is None or fit > best[2]:
                best = (s, k, fit)
    return best


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def lufs(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(out[out.rfind("Summary:"):].split("I:")[1].split()[0])


def flow(path):
    """(seam, dip): the loudness jump where the loop wraps beyond the bed's own beat-to-beat changes, and
    the deepest 4 s drop below its median (a breakdown or a break, which jolts under narration)."""
    import scipy.signal as sg
    import soundfile as sf

    y, sr = sf.read(path)
    y = y.mean(axis=1) if y.ndim > 1 else y
    z = sg.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621],
                   sg.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585], np.concatenate([y, y]))) ** 2
    c = np.concatenate([[0], np.cumsum(z)])
    win = lambda n, h: 10 * np.log10((c[np.arange(0, len(z) - n, h) + n] - c[np.arange(0, len(z) - n, h)]) / n + 1e-12)
    j = np.abs(np.diff(win(int(0.4 * sr), int(0.1 * sr))))
    w = len(y) // int(0.1 * sr)
    seam = float(j[w - 6: w + 3].max() - np.percentile(j[: len(j) // 2], 95))
    l4 = win(int(4 * sr), int(4 * sr))[: len(y) // int(4 * sr)]
    return seam, float(np.median(l4) - l4.min())


def score(m):
    flags = {
        "speech band": max(0, m["speech_band"] - 0.06) * 120,
        "lead melody": max(0, m["lead"] - 0.02) * 150,
        "frantic": max(0, m["onsets_per_s"] - 6.5) * 3,
        "breakdown": max(0, m["dip"] - 3) * 3,
        "loop seam": max(0, m["seam"]) * 3,
        "bass-heavy (lost on phones)": max(0, m["low"] - 0.45) * 40,
        "tempo": max(0, 88 - m["tempo"], m["tempo"] - 118) * 0.3,
    }
    return round(sum(flags.values()), 2), {k: round(v, 1) for k, v in flags.items() if v > 0.05}


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    srcs = sorted(glob.glob("public/music_*.mp3")) + sorted(p for p in glob.glob(os.path.join(WORK, "el_*.mp3")) if "el_test" not in p and "el_cost" not in p)
    for src in srcs:
        name = os.path.basename(src)[:-4]
        loop = os.path.join(WORK, f"{name}_loop.wav")
        if not os.path.exists(loop):
            r = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "loop.py"), src, loop], capture_output=True, text=True)
            if r.returncode:
                print("skip", name, r.stdout.strip(), r.stderr.strip()[-200:])
                continue
        shift, key, fit = retune(loop)
        tuned = os.path.join(WORK, f"{name}_final.wav")
        gain = None
        chain = [f"rubberband=pitch={2 ** (shift / 12):.6f}:transients=crisp"] if shift else []
        tmp = os.path.join(WORK, f"{name}_tmp.wav")
        ff("-i", loop, "-af", ",".join(chain) or "anull", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", tmp)
        gain = TARGET_LUFS - lufs(tmp)
        ff("-i", tmp, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.95:level=false", "-c:a", "pcm_s16le", tuned)
        os.remove(tmp)
        m = bed(tuned)
        m["seam"], m["dip"] = flow(tuned)
        pen, flags = score(m)
        rows.append(dict(name=name, src=src, file=tuned, key=key, shift=shift, key_fit=round(fit, 2), penalty=pen, flags=flags, metrics=m))
        print(f"{name:12} pen {pen:5}  {key} ({shift:+d})  {m['seconds']:5.1f}s  speech {m['speech_band']:.3f} lead {m['lead']:.3f} onsets {m['onsets_per_s']} dip {m['dip']:.1f} seam {m['seam']:+.1f} low {m['low']} tempo {m['tempo']}  {flags}", flush=True)
    rows.sort(key=lambda r: r["penalty"])
    keep = rows[:4]
    rights = []
    for i, r in enumerate(keep, 1):
        dest = os.path.join(OUT, f"bed_{i}.wav")
        with open(r["file"], "rb") as f, open(dest, "wb") as g:
            g.write(f.read())
        suno = r["name"].startswith("music_")
        rights.append(dict(
            file=f"music/bed_{i}.wav",
            key=r["key"],
            sha256=hashlib.sha256(open(dest, "rb").read()).hexdigest(),
            origin=(f"Suno generation (public/{r['name']}.mp3)" if suno else f"ElevenLabs Music, generated 2026-10-21 ({r['name']})"),
            licence=("Suno paid-plan commercial licence; retire the bed on any Content ID claim" if suno else "ElevenLabs paid-plan commercial use; retire the bed on any Content ID claim"),
            finishing=f"beat-aligned seamless loop, pitch {r['shift']:+d} semitones (rubberband, tempo kept), {TARGET_LUFS} LUFS (src/tools/sfxlab/pickbeds.py)",
        ))
        print(f"KEEP bed_{i} <- {r['name']} ({r['key']} major, penalty {r['penalty']})")
    json.dump(dict(schema="pulse-audio-rights-v1", beds=rights), open(os.path.join(OUT, "rights.json"), "w"), indent=2)
    json.dump(rows, open(os.path.join(WORK, "report.json"), "w"), indent=1, default=str)


main()
