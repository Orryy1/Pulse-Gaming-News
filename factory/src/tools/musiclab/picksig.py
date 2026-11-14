"""Chooses each series' signature music from the ACE-Step takes (acegen.py) by measurement, not by ear.

Per series it keeps one sting, one bed and (documentaries) one rise, and finishes them to the soundscape v3
rules so they drop into the existing mix without new levels:

- Sting: cut to its opening phrase (at most STING_MAX seconds: a Short plays an sfx for 3 s), moved by
  varispeed into the series key (D or E major, the keys the tuned sounds come in), 38 Hz high-pass, 10 kHz
  low-pass, 6 ms fade in, a long fade out and loudness-matched like every v3 file: its loudest 200 ms
  K-weighted window at -20 dB, so LEVEL.sting (10 dB under the narrator) means the same thing for it.
- Bed: a seamless beat-cut loop (sfxlab/loop.py), pitch-moved into the series key with Rubber Band (tempo
  kept) and mastered to -12.7 LUFS like the house beds, then scored by pickbeds.py's rules for life under a
  narrator (speech band, lead melody, busyness, breakdowns, loop seam, bass on phones, tempo).
- Rise: cut so a strong downbeat ("the hit") lands RISE_TAIL seconds before its end, mastered like a bed;
  the hit's offset is recorded so the documentary can land it on a chapter's first word.

A take that fails the key fit, the loudness or the score is never kept; a series with no passing take keeps
the house music. Writes public/sfx/signature/<series>.mp3, public/music/signature/<series>_bed.wav and
docs_rise.wav, their rights.json, src/render/signaturelib.ts (the library the render reads) and a report.

Usage (from the factory dir, the audio Python): python src/tools/musiclab/picksig.py <raw dir> [--report out.json]
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

import librosa
import numpy as np
import scipy.signal as sg
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
SFXLAB = os.path.join(HERE, "..", "sfxlab")
src = open(os.path.join(SFXLAB, "pickbeds.py"), encoding="utf-8").read().rsplit("\nmain()", 1)[0]
P = {"__file__": os.path.join(SFXLAB, "pickbeds.py"), "__name__": "pickbeds"}
sys.path.insert(0, SFXLAB)
exec(compile(src, "pickbeds.py", "exec"), P)

SR = 48000
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FILE_LOUD = -20.0  # soundscape v3: every sound file's loudest 200 ms, K-weighted (dB)
BED_LUFS = P["TARGET_LUFS"]  # -12.7, the house beds' level
STING_MIN, STING_MAX = 1.6, 2.9
RISE_TAIL = 3.0
MAX_BED_PENALTY = 8.0  # pickmoods.py's limit for a bed that plays only part of the time
MAX_STING_PENALTY = 6.0
KEY_FIT_MIN = 0.78  # share of the pitch energy on the key's seven notes
BRIEFS = json.load(open(os.path.join(HERE, "briefs.json"), encoding="utf-8"))
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def loud(y, win=0.2, hop=0.01):
    z = sg.lfilter(*_K2, sg.lfilter(*_K1, y)) ** 2
    n, h = int(win * SR), int(hop * SR)
    if len(z) < n:
        z = np.pad(z, (0, n - len(z)))
    c = np.concatenate([[0], np.cumsum(z)])
    idx = np.arange(0, len(z) - n + 1, h)
    return -0.691 + 10 * np.log10((c[idx + n] - c[idx]) / n + 1e-12)


def chroma(mono):
    harm = librosa.effects.harmonic(mono.astype(np.float32))
    c = librosa.feature.chroma_cqt(y=harm, sr=SR).mean(axis=1)
    return c / (c.sum() + 1e-9)


def key_fit(c, key, shift=0):
    t = NAMES.index(key)
    scale = [(t + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)]
    return float(np.roll(c, shift)[scale].sum())


def best_shift(c, key):
    """The varispeed move (-3..3 semitones) that puts the most pitch energy on the key's notes."""
    return max(range(-3, 4), key=lambda s: key_fit(c, key, s) - 0.015 * abs(s))


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def lufs(path):
    return P["lufs"](path)


def features(stereo):
    """Lab-style measurements on the mono sum (soundscape v3's gotchas: A-weighted bands, energy-weighted centroid)."""
    y = stereo.mean(axis=0)
    M = np.abs(librosa.stft(y.astype(np.float32), n_fft=2048, hop_length=256))
    S = M**2
    fr = librosa.fft_frequencies(sr=SR, n_fft=2048)
    SA = S * (10 ** (librosa.A_weighting(fr) / 10))[:, None]
    tot = SA.sum() + 1e-12
    band = lambda lo, hi: float(SA[(fr >= lo) & (fr < hi)].sum() / tot)
    mtot = M.sum(axis=1)
    L = loud(y, 0.05, 0.005)
    harm, perc = librosa.effects.hpss(y.astype(np.float32))
    tonal = float(np.sum(harm**2) / (np.sum(harm**2) + np.sum(perc**2) + 1e-12))
    c = chroma(y)
    ent = float(-(c * np.log(c + 1e-12)).sum() / np.log(12))
    return dict(
        seconds=round(len(y) / SR, 3),
        centroid=round(float((fr * mtot).sum() / (mtot.sum() + 1e-12)), 1),
        presence=round(band(2000, 6000), 4),
        air=round(band(6000, 24000), 4),
        phone=round(band(250, 4000), 3),
        peak_s=round(int(np.argmax(L)) * 0.005, 3),
        tonal=round(tonal, 3),
        # A sting you can hum: strongly pitched, its notes concentrated on a few pitch classes.
        motif=round(tonal * (1 - ent), 3),
        jump_db=round(float(np.max(np.diff(loud(y, 0.01, 0.0025)))), 2),
    )


def sting_score(f, fit):
    flags = {
        "length": max(0, STING_MIN - f["seconds"], f["seconds"] - STING_MAX) * 10,
        "harsh top": max(0, f["presence"] - 0.12) * 40 + max(0, f["air"] - 0.02) * 150,
        "bright": max(0, f["centroid"] - 1600) / 150,
        "too dark": max(0, 250 - f["centroid"]) / 60,
        "lost on phones": max(0, 0.55 - f["phone"]) * 20,
        "late peak": max(0, f["peak_s"] - 1.8) * 4,
        "jolt": max(0, f["jump_db"] - 12) * 0.8,
        "out of key": max(0, KEY_FIT_MIN - fit) * 40,
        "forgettable": max(0, 0.12 - f["motif"]) * 25,
    }
    return round(sum(flags.values()), 2), {k: round(v, 1) for k, v in flags.items() if v > 0.05}


def cut_sting(stereo):
    """Trim the start, then end on the quietest moment between STING_MIN and STING_MAX (never mid-attack)."""
    mono = stereo.mean(axis=0)
    env = loud(mono, 0.02, 0.005)
    top = env.max()
    start = int(np.argmax(env > top - 35)) * int(0.005 * SR)
    stereo = stereo[:, start:]
    mono = mono[start:]
    on = librosa.onset.onset_strength(y=mono.astype(np.float32), sr=SR, hop_length=240)
    lo, hi = int(STING_MIN * SR / 240), min(len(on) - 1, int(STING_MAX * SR / 240))
    if hi <= lo:
        return stereo
    env2 = loud(mono, 0.05, 0.005)
    cost = [on[i] / (on.max() + 1e-9) + 0.02 * max(0.0, env2[min(len(env2) - 1, i // 4)] - (top - 12)) for i in range(lo, hi)]
    end = (lo + int(np.argmin(cost))) * 240
    return stereo[:, :end]


def finish_sting(stereo, shift):
    if shift:
        rate = 2 ** (shift / 12)
        stereo = np.vstack([sg.resample_poly(ch, 1000, int(round(1000 * rate))) for ch in stereo])
    hp = sg.butter(2, 38, "hp", fs=SR, output="sos")
    lp = sg.butter(4, 10000, "lp", fs=SR, output="sos")
    stereo = np.vstack([sg.sosfilt(lp, sg.sosfilt(hp, ch)) for ch in stereo])
    n = stereo.shape[1]
    fi = int(0.006 * SR)
    stereo[:, :fi] *= np.linspace(0, 1, fi)
    fo = int(n * 0.4)
    stereo[:, n - fo:] *= np.linspace(1, 0, fo) ** 1.5
    stereo *= 10 ** ((FILE_LOUD - loud(stereo.mean(axis=0)).max()) / 20)
    pk = np.max(np.abs(stereo))
    if pk > 10 ** (-1 / 20):
        stereo *= 10 ** (-1 / 20) / pk
    return stereo


def read(path):
    try:
        y, sr = sf.read(path, always_2d=True)
        y = y.T.astype(np.float64)
    except Exception:  # an MP3 this libsndfile cannot read
        y, sr = librosa.load(path, sr=SR, mono=False)
        y = np.atleast_2d(y).astype(np.float64)
    if sr != SR:
        y = np.vstack([librosa.resample(ch, orig_sr=sr, target_sr=SR) for ch in y])
    if y.shape[0] == 1:
        y = np.vstack([y, y])
    return y


def master_music(src_wav, dest, key):
    """Rubber Band into the key (tempo kept), then the house beds' loudness with a gentle limiter."""
    mono = read(src_wav).mean(axis=0)
    c = chroma(mono[: SR * 60])
    shift = best_shift(c, key)
    tmp = dest + ".tmp.wav"
    chain = f"rubberband=pitch={2 ** (shift / 12):.6f}:transients=crisp" if shift else "anull"
    ff("-i", src_wav, "-af", chain, "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", tmp)
    gain = BED_LUFS - lufs(tmp)
    # Twice: the limiter takes a little off a punchy take, so the second pass makes up what it took.
    for _ in range(2):
        ff("-i", tmp, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.95:level=false", "-c:a", "pcm_s16le", dest)
        off = BED_LUFS - lufs(dest)
        if abs(off) < 0.2:
            break
        gain += off
    os.remove(tmp)
    after = chroma(read(dest).mean(axis=0)[: SR * 60])
    return shift, key_fit(after, key)


def grid(path):
    """bedgrid.py's bar grid: a line fitted through the tracked beats."""
    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    if len(beats) > 8:
        beat, first = (float(v) for v in np.polyfit(np.arange(len(beats)), beats, 1))
        first %= beat
    else:
        beat, first = 60 / float(np.atleast_1d(tempo)[0]), 0.0
    return dict(bar=round(4 * beat, 4), first=round(first, 4), loop=round(len(y) / sr, 4))


def find_hit(mono):
    """The rise's downbeat: the strongest onset with a loudness jump, in the take's second half."""
    hop = 480
    on = librosa.onset.onset_strength(y=mono.astype(np.float32), sr=SR, hop_length=hop)
    env = loud(mono, 0.1, hop / SR)
    n = min(len(on), len(env))
    jump = np.zeros(n)
    w = int(0.6 * SR / hop)
    for i in range(w, n - w):
        jump[i] = max(0.0, env[i: i + w].mean() - env[i - w: i].mean())
    score = on[:n] / (on.max() + 1e-9) + jump / 6
    lo = int(n * 0.35)
    i = lo + int(np.argmax(score[lo:]))
    return i * hop / SR, float(jump[i])


def pick(raw, report_path):
    out_sfx = os.path.join("public", "sfx", "signature")
    out_music = os.path.join("public", "music", "signature")
    work = os.path.join("data", "musiclab", "work")
    for d in (out_sfx, out_music, work):
        os.makedirs(d, exist_ok=True)
    report = {"model": "ACE-Step 1.5 (acestep-v15-turbo)", "series": {}}
    lib = {}
    rights = []
    for series, spec in BRIEFS["series"].items():
        key = spec["key"]
        rep = report["series"].setdefault(series, {"name": spec["name"], "key": key, "stings": [], "beds": [], "rises": []})
        takes = sorted(glob.glob(os.path.join(raw, f"{series}__*__s*.wav")))
        meta = lambda p: json.load(open(p[:-4] + ".json", encoding="utf-8")) if os.path.exists(p[:-4] + ".json") else {}
        # Stings.
        best_sting = None
        for p in [t for t in takes if "__sting__" in t]:
            st = cut_sting(read(p))
            c = chroma(st.mean(axis=0))
            shift = best_shift(c, key)
            fin = finish_sting(st, shift)
            fit = key_fit(chroma(fin.mean(axis=0)), key)
            f = features(fin)
            pen, flags = sting_score(f, fit)
            row = dict(take=os.path.basename(p), shift=shift, key_fit=round(fit, 3), penalty=pen, flags=flags, **f)
            rep["stings"].append(row)
            if pen <= MAX_STING_PENALTY and (best_sting is None or pen < best_sting[0]["penalty"]):
                best_sting = (row, fin, meta(p))
        # Beds.
        best_bed = None
        for p in [t for t in takes if "__bed__" in t]:
            name = os.path.basename(p)[:-4]
            loop = os.path.join(work, f"{name}_loop.wav")
            r = subprocess.run([sys.executable, os.path.join(SFXLAB, "loop.py"), p, loop], capture_output=True, text=True)
            if r.returncode:
                rep["beds"].append(dict(take=name, error=(r.stdout + r.stderr).strip()[-200:]))
                continue
            fin = os.path.join(work, f"{name}_final.wav")
            shift, fit = master_music(loop, fin, key)
            m = P["bed"](fin)
            m["seam"], m["dip"] = P["flow"](fin)
            pen, flags = P["score"](m)
            if fit < KEY_FIT_MIN:
                flags["out of key"] = round((KEY_FIT_MIN - fit) * 40, 1)
                pen = round(pen + flags["out of key"], 2)
            row = dict(take=name, shift=shift, key_fit=round(fit, 3), penalty=pen, flags=flags, metrics=m)
            rep["beds"].append(row)
            if pen <= MAX_BED_PENALTY and (best_bed is None or pen < best_bed[0]["penalty"]):
                best_bed = (row, fin, meta(p))
        # The documentary rise.
        best_rise = None
        for p in [t for t in takes if "__rise__" in t]:
            name = os.path.basename(p)[:-4]
            y = read(p)
            hit, jump = find_hit(y.mean(axis=0))
            end = min(y.shape[1], int((hit + RISE_TAIL) * SR))
            start = max(0, int((hit - 14.0) * SR))
            seg = y[:, start:end].copy()
            fo = int(1.2 * SR)
            seg[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
            fi = int(1.0 * SR)
            seg[:, :fi] *= np.linspace(0, 1, fi)
            tmp = os.path.join(work, f"{name}_cut.wav")
            sf.write(tmp, seg.T.astype(np.float32), SR, subtype="PCM_16")
            fin = os.path.join(work, f"{name}_final.wav")
            shift, fit = master_music(tmp, fin, key)
            f = features(read(fin))
            hit_at = hit - start / SR
            flags = {
                "weak hit": max(0, 3 - jump) * 2,
                "out of key": max(0, KEY_FIT_MIN - fit) * 40,
                "harsh top": max(0, f["presence"] - 0.12) * 40,
                "lost on phones": max(0, 0.5 - f["phone"]) * 20,
                "short build": max(0, 8 - hit_at) * 1.5,
            }
            pen = round(sum(flags.values()), 2)
            row = dict(take=name, shift=shift, key_fit=round(fit, 3), hit=round(hit_at, 3), hit_jump_db=round(jump, 1), penalty=pen,
                       flags={k: round(v, 1) for k, v in flags.items() if v > 0.05}, **f)
            rep["rises"].append(row)
            if pen <= MAX_STING_PENALTY and (best_rise is None or pen < best_rise[0]["penalty"]):
                best_rise = (row, fin, meta(p))
        entry = {"name": spec["name"], "key": key}
        if best_sting:
            row, fin, m = best_sting
            tmp = os.path.join(work, f"{series}_sting.wav")
            sf.write(tmp, fin.T.astype(np.float32), SR, subtype="PCM_16")
            dest = os.path.join(out_sfx, f"{series}.mp3")
            ff("-i", tmp, "-ar", str(SR), "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", dest)
            entry["sting"] = f"signature/{series}"
            # The peak as decoded (MP3 shifts it by its encoder delay), so a cue can land it on an event.
            entry["stingPeak"] = round(features(read(dest))["peak_s"], 3)
            rights.append(right(f"sfx/signature/{series}.mp3", dest, m, row, f"opening phrase cut ({row['seconds']} s), varispeed {row['shift']:+d} semitones into {key} major, 38 Hz high-pass, 10 kHz low-pass, fades, {FILE_LOUD} dB K-weighted 200 ms max (src/tools/musiclab/picksig.py)"))
        if best_bed:
            row, fin, m = best_bed
            dest = os.path.join(out_music, f"{series}_bed.wav")
            with open(fin, "rb") as a, open(dest, "wb") as b:
                b.write(a.read())
            entry["bed"] = f"music/signature/{series}_bed.wav"
            entry["grid"] = grid(dest)
            rights.append(right(entry["bed"], dest, m, row, f"beat-aligned seamless loop, Rubber Band {row['shift']:+d} semitones into {key} major (tempo kept), {BED_LUFS} LUFS (src/tools/musiclab/picksig.py)"))
        if best_rise:
            row, fin, m = best_rise
            dest = os.path.join(out_music, f"{series}_rise.wav")
            with open(fin, "rb") as a, open(dest, "wb") as b:
                b.write(a.read())
            entry["rise"] = {"file": f"music/signature/{series}_rise.wav", "hit": row["hit"], "seconds": row["seconds"]}
            rights.append(right(entry["rise"]["file"], dest, m, row, f"cut to {row['seconds']} s with the downbeat at {row['hit']} s, Rubber Band {row['shift']:+d} semitones into {key} major, {BED_LUFS} LUFS (src/tools/musiclab/picksig.py)"))
        lib[series] = entry
        print(f"{series:10} sting {bool(best_sting)} bed {bool(best_bed)} rise {bool(best_rise)}", flush=True)
    json.dump(dict(schema="pulse-audio-rights-v1", licence_record="public/music/signature/LICENCE.md", music=rights),
              open(os.path.join(out_music, "rights.json"), "w", encoding="utf-8", newline="\n"), indent=2)
    write_lib(lib)
    report["library"] = lib
    json.dump(report, open(report_path, "w", encoding="utf-8"), indent=1, default=str)
    print("report:", report_path)


def right(file, path, meta, row, finishing):
    return dict(
        file=file,
        sha256=hashlib.sha256(open(path, "rb").read()).hexdigest(),
        origin=f"ACE-Step 1.5 ({meta.get('model', 'acestep-v15-turbo')}), generated locally on the PC, seed {meta.get('seed')} ({row['take']})",
        prompt=meta.get("caption", ""),
        licence="MIT model licence; ACE-Step's official model card says generated music may be used commercially (public/music/signature/LICENCE.md). Retire the file on any Content ID claim.",
        finishing=finishing,
    )


def write_lib(lib):
    lines = [
        "// Generated by src/tools/musiclab/picksig.py: the series-signature music that passed the measurement. Do not",
        "// edit by hand; re-run the picker. A series missing here keeps the house music (src/render/signature.ts).",
        'import type { SignatureLibrary } from "./signature.ts";',
        "",
        f"export const SIGNATURE_LIBRARY: SignatureLibrary = {json.dumps(lib, indent=2)};",
        "",
    ]
    with open(os.path.join("src", "render", "signaturelib.ts"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    rp = sys.argv[sys.argv.index("--report") + 1] if "--report" in sys.argv else os.path.join("data", "musiclab", "report.json")
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    pick(sys.argv[1], rp)
