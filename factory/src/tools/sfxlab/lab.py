"""Sound lab: builds the channel's soundscape (public/sfx/v3) by measurement, not by ear.

For each role (sting, air, swell, land, tick) it gathers candidates (fresh ElevenLabs takes plus the
local library), finishes them alike, tunes tonal ones to each music bed's key, scores each against
the role's profile (harsh top end, ringing, high pitch, jolts, timing, key clash) and against the
real narrator and music (how far the sound rises above them), then keeps the best coherent set.
Every finished file is matched for perceived loudness, not peak, so the mix levels mean the same
thing for every sound.

Usage (from the factory dir): python src/tools/sfxlab/lab.py [--no-generate]
"""
import hashlib
import json
import os
import re
import sys
import urllib.request

import librosa
import numpy as np
import scipy.signal as sg
import soundfile as sf

SR = 48000
ROOT = os.getcwd()
LAB = os.path.join(ROOT, "data", "sfxlab")
RAW = os.path.join(LAB, "v3raw")
OUT = os.path.join(ROOT, "public", "sfx", "v3")
LIB = "D:/AdobeSFX"
os.makedirs(RAW, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
# The music beds' keys, measured with src/tools/sfxlab/key.py (Krumhansl profile on mean chroma).
BEDS = {"D": ["music_1.mp3", "music_2.mp3"], "E": ["music_3.mp3", "music_4.mp3"]}
FILE_LOUD = -20.0  # every finished file's loudest 200 ms window, K-weighted (dB)

FAMILY = "Warm, polished, subtle, premium documentary sound design. No harsh highs, no metallic ring, no distortion, no voice, no melody."
GEN = {
    "air": [
        "a soft warm whoosh of air for a smooth video transition, like a heavy cloth swept past the microphone, breathy and low, no tone, no whistle",
        "a gentle dark airy swoosh, deep soft wind passing quickly, muffled and smooth, cinematic transition",
        "a subtle quick swish, a soft hand sweep through the air close to the microphone, warm and tactile, no hiss",
    ],
    "tick": [
        "a single soft muted wooden knock, a felt mallet tapping a low marimba bar, warm and round, very short, no ring, no echo",
        "a soft rounded tap as a number appears on screen, a warm low pluck like a muted kalimba, very short and clean",
        "a gentle tactile click of a premium card snapping softly into place, low and warm, very short",
        "a single soft muted tap of a fingertip on a wooden table, close and warm, very short, no tone",
    ],
    "sting": [
        "a short warm brand sting for a friendly gaming news show, a soft low synth pluck chord with a gentle airy swell, confident, ends cleanly",
        "a soft modern logo sound, a warm rounded synth pad hit with a low pulse underneath, gentle and premium, no bells",
    ],
    "swell": [
        "a smooth soft reverse swell rising into a reveal, warm low airy pad, gentle crescendo that ends cleanly with no hit",
        "a soft breathy rising swoosh of air building gently into a reveal, no musical tone, no synth, ends cleanly with no hit",
    ],
    "land": [
        "a soft deep cinematic thud as a title card lands, a round warm low boom with a short soft tail, felt more than heard",
        "a soft warm muffled thump, like a cushion struck by a padded mallet, short soft body, no boom tail, no tone",
    ],
}
SECONDS = {"air": 0.8, "tick": 0.5, "sting": 1.8, "swell": 1.4, "land": 1.3}
TAKES = 4

# What each role must be. peak_s: when the loudness peak should land (the cue is placed so that
# this lands on the cut); decay_ms: peak to -30 dB; lowpass: where the top end is rolled off.
ROLES = {
    "air": dict(dur=(0.4, 1.1), peak_s=(0.0, 0.35), decay=(120, 450), lowpass=9000, fade=0.45, keep=3, offset=-17, tonal_max=0.7, centroid=(450, 950), phone=0.6),
    "tick": dict(dur=(0.1, 0.7), peak_s=(0.0, 0.08), decay=(50, 280), lowpass=8000, fade=0.6, keep=1, offset=-20, tonal_max=1.0, centroid=(300, 1000), phone=0.6),
    "sting": dict(dur=(0.8, 2.6), peak_s=(0.0, 0.5), decay=(250, 1300), lowpass=10000, fade=0.4, keep=1, offset=-10, tonal_max=1.0, centroid=(300, 1000), phone=0.6),
    "swell": dict(dur=(0.8, 2.2), peak_s=(0.5, 1.6), decay=(40, 400), lowpass=9000, fade=0.12, keep=1, offset=-16, tonal_max=1.0, centroid=(250, 900), phone=0.5),
    "land": dict(dur=(0.5, 2.2), peak_s=(0.0, 0.25), decay=(200, 900), lowpass=7000, fade=0.55, keep=1, offset=-17, tonal_max=1.0, centroid=(250, 800), phone=0.5),
}
LIB_RE = {
    "air": re.compile(r"whoosh|swish|swoosh|woosh", re.I),
    "tick": re.compile(r"\b(click|tap|knock|pluck|mallet|marimba|kalimba|wood ?block|select|confirm|counter|tick|button)\b", re.I),
    "sting": re.compile(r"Transition Logo \d", re.I),
    "swell": re.compile(r"Swell", re.I),
    "land": re.compile(r"Thump|Hit Impact|Impact Short|Low Boom|Sub Drop", re.I),
}
LIB_SKIP = re.compile(r"beep|warble|distort|gun|weapon|explo|glass|saber|laser|blaster|magic|cartoon|toon|horror|scream|alien|glitch|keyboard|typing|mouse|ratchet|camera|door|car |truck|auto ", re.I)


def env_key():
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    return ""


def generate():
    key = env_key()
    for role, prompts in GEN.items():
        for pi, prompt in enumerate(prompts):
            for t in range(TAKES):
                dest = os.path.join(RAW, f"{role}_p{pi}_t{t}.mp3")
                if os.path.exists(dest):
                    continue
                body = json.dumps({"text": f"{prompt}. {FAMILY}", "duration_seconds": SECONDS[role], "prompt_influence": 0.55}).encode()
                req = urllib.request.Request("https://api.elevenlabs.io/v1/sound-generation", data=body, method="POST",
                                             headers={"xi-api-key": key, "content-type": "application/json"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    open(dest, "wb").write(r.read())
                print("generated", os.path.basename(dest), flush=True)


# ---------------------------------------------------------------- measurement
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def kw(y):
    return sg.lfilter(*_K2, sg.lfilter(*_K1, y))


def loud(y, win=0.2, hop=0.01):
    """K-weighted loudness per window (dB, BS.1770 style)."""
    z = kw(y) ** 2
    n, h = int(win * SR), int(hop * SR)
    if len(z) < n:
        z = np.pad(z, (0, n - len(z)))
    c = np.concatenate([[0], np.cumsum(z)])
    idx = np.arange(0, len(z) - n + 1, h)
    return -0.691 + 10 * np.log10((c[idx + n] - c[idx]) / n + 1e-12)


def load(path):
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float64)


def finish(y, role):
    """build-sfx's chain: trim, 38 Hz high-pass, low-pass, 6 ms fade in, long fade out, loudness-matched."""
    spec = ROLES[role]
    thr = 10 ** (-55 / 20)
    nz = np.where(np.abs(y) > thr)[0]
    if len(nz) == 0:
        return None
    y = y[nz[0]:]
    # Trailing silence off too, so lengths are honest.
    y = y[: nz[-1] - nz[0] + 1]
    if len(y) > spec["dur"][1] * SR * 1.6:
        y = y[: int(spec["dur"][1] * SR * 1.6)]
    y = sg.sosfilt(sg.butter(2, 38, "hp", fs=SR, output="sos"), y)
    y = sg.sosfilt(sg.butter(4, spec["lowpass"], "lp", fs=SR, output="sos"), y)
    n = len(y)
    fi = min(n, int(0.006 * SR))
    y[:fi] *= np.linspace(0, 1, fi)
    fo = int(n * spec["fade"])
    if fo > 1:
        y[n - fo:] *= np.linspace(1, 0, fo)
    y *= 10 ** ((FILE_LOUD - loud(y).max()) / 20)
    pk = np.max(np.abs(y))
    if pk > 10 ** (-1 / 20):
        y *= 10 ** (-1 / 20) / pk
    return y


def chroma(y):
    harm = librosa.effects.harmonic(y.astype(np.float32))
    c = librosa.feature.chroma_cqt(y=harm, sr=SR).mean(axis=1)
    return c / (c.sum() + 1e-9)


def key_profile(k):
    return np.roll(MAJOR, NAMES.index(k))


def tune(y, k, c):
    """Best varispeed shift (semitones, -4..4) so the sound sits in key k; small shifts preferred."""
    # Fit: the share of the sound's pitch energy that falls on notes of the key, a little extra for the
    # key note and its fifth (the most restful), minus a little per semitone moved.
    t = NAMES.index(k)
    scale = [(t + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)]
    rest = [t, (t + 7) % 12]
    fit_of = lambda s: float(np.roll(c, s)[scale].sum() + 0.15 * np.roll(c, s)[rest].sum())
    best = max(range(-4, 5), key=lambda s: fit_of(s) - 0.02 * abs(s))
    fit = float(np.roll(c, best)[scale].sum())
    if best == 0:
        return y, 0, fit
    # Varispeed: resample to play 2^(s/12) faster; no phase-vocoder artefacts on transients.
    rate = 2 ** (best / 12)
    out = sg.resample_poly(y, 1000, int(round(1000 * rate)))
    return out, best, fit


def features(y):
    M = np.abs(librosa.stft(y.astype(np.float32), n_fft=2048, hop_length=256))
    S = M**2
    fr = librosa.fft_frequencies(sr=SR, n_fft=2048)
    # Band shares as heard at a low level (A-weighted), so inaudible sub rumble does not count.
    SA = S * (10 ** (librosa.A_weighting(fr) / 10))[:, None]
    tot = SA.sum() + 1e-12
    band = lambda lo, hi: float(SA[(fr >= lo) & (fr < hi)].sum() / tot)
    # Centre of the sound weighted by energy over the whole file (quiet tail frames barely count).
    mtot = M.sum(axis=1)
    cen = float((fr * mtot).sum() / (mtot.sum() + 1e-12))
    L = loud(y, 0.05, 0.005)
    pk = int(np.argmax(L))
    below = np.where(L[pk:] < L[pk] - 30)[0]
    decay = (below[0] if len(below) else len(L) - pk) * 5
    harm, perc = librosa.effects.hpss(y.astype(np.float32))
    tonal = float(np.sum(harm**2) / (np.sum(harm**2) + np.sum(perc**2) + 1e-12))
    f0 = None
    if tonal > 0.5:
        spec = np.abs(np.fft.rfft(harm * np.hanning(len(harm))))
        f = np.fft.rfftfreq(len(harm), 1 / SR)
        m = (f > 60) & (f < 4000)
        f0 = float(f[m][np.argmax(spec[m])])
    jump = float(np.max(np.diff(loud(y, 0.01, 0.0025)))) if len(y) > SR * 0.02 else 0.0
    return dict(
        seconds=round(len(y) / SR, 3),
        centroid=cen,
        presence=band(2000, 6000),
        air=band(6000, 24000),
        low=band(0, 200),
        # What a phone speaker plays: the share of the energy between 250 Hz and 4 kHz.
        phone=band(250, 4000),
        peak_s=pk * 0.005,
        decay_ms=float(decay),
        tonal=tonal,
        f0=f0,
        jump_db=jump,
        flatness=float(librosa.feature.spectral_flatness(S=S).mean()),
    )


# ---------------------------------------------------------------- context: the real narrator and music
VOICE = load(os.path.join(ROOT, "data/smoke/deals/episodes/ep_20261021_b2c11f52/voice.mp3"))
VL = loud(VOICE, 0.4, 0.05)
VOICE_REF = float(np.median(VL[VL > VL.max() - 20]))
MUSIC = {k: [load(os.path.join(ROOT, "public", f))[: SR * 60] for f in fs] for k, fs in BEDS.items()}
rng = np.random.default_rng(7)
SPOTS = sorted(rng.integers(SR * 2, len(VOICE) - SR * 4, 10))


def context_rise(y, gain, k):
    """How far the sound lifts the mix (voice + ducked music) in 400 ms and 50 ms windows, averaged over spots."""
    rises, jolts = [], []
    for i, at in enumerate(SPOTS):
        bed = MUSIC[k][i % len(MUSIC[k])]
        seg = slice(at, at + SR * 3)
        base = VOICE[seg] + 0.085 * bed[i * SR: i * SR + SR * 3][: SR * 3]
        mix = base.copy()
        n = min(len(y), len(mix))
        mix[:n] += gain * 0.75 * y[:n]
        rises.append(float(np.max(loud(mix, 0.4, 0.05) - loud(base, 0.4, 0.05))))
        jolts.append(float(np.max(loud(mix, 0.05, 0.01) - loud(base, 0.05, 0.01))))
    gap = 0.2 * MUSIC[k][0][SR * 5: SR * 8]
    g = gap.copy()
    n = min(len(y), len(g))
    g[:n] += gain * y[:n]
    gap_rise = float(np.max(loud(g, 0.4, 0.05) - loud(gap, 0.4, 0.05)))
    return float(np.mean(rises)), float(np.max(jolts)), gap_rise


def score(role, f, fits):
    s = ROLES[role]
    p = 0.0
    why = []

    def add(v, label):
        nonlocal p
        if v > 0.05:
            p += v
            why.append(f"{label} {v:.1f}")

    lo, hi = s["dur"]
    add(max(0, lo - f["seconds"], f["seconds"] - hi) * 10, "length")
    add(max(0, f["presence"] - 0.03) * 100 + max(0, f["air"] - 0.005) * 400, "harsh top")
    clo, chi = s["centroid"]
    add(max(0, f["centroid"] - chi) / 120, "bright")
    add(max(0, clo - f["centroid"]) / 60, "too dark")
    add(max(0, s["phone"] - f["phone"]) * 20, "lost on phones")
    plo, phi = s["peak_s"]
    add(max(0, plo - f["peak_s"], f["peak_s"] - phi) * 20, "timing")
    dlo, dhi = s["decay"]
    add(max(0, dlo - f["decay_ms"], f["decay_ms"] - dhi) / 60, "decay")
    if f["tonal"] > 0.5:
        if f["f0"] and f["f0"] > 450:
            add(np.log2(f["f0"] / 450) * 6, "high pitch")
        add(max(0, f["tonal"] - s["tonal_max"]) * 10, "pitched")
        # Only a clearly pitched sound can clash; a thump whose pitch energy is spread evenly cannot.
        add(f.get("clarity", 0) * max(0, 0.92 - min(fits)) * 15, "key clash")
        if role in ("air", "tick"):
            add(max(0, f["decay_ms"] - 220) / 80 * f["tonal"], "rings")
    add(max(0, f["jump_db"] - 9) * 0.8, "jolt")
    return round(p, 2), why


def gather(generate_new):
    if generate_new:
        generate()
    cands = []
    for role in ROLES:
        for fn in sorted(os.listdir(RAW)):
            if fn.startswith(role + "_"):
                cands.append((role, os.path.join(RAW, fn), "ElevenLabs", f"generated: {fn}"))
        old = "glint" if role == "tick" else role
        for fn in sorted(os.listdir(LAB)):
            if re.fullmatch(rf"{old}_\d\.mp3", fn):
                cands.append((role, os.path.join(LAB, fn), "ElevenLabs", f"generated: {fn}"))
    lib = [l.strip()[2:] for l in open(os.path.join(LAB, "library.txt"), encoding="utf-8") if l.strip()]
    for role, rx in LIB_RE.items():
        lo, hi = ROLES[role]["dur"]
        for rel in lib:
            name = rel.rsplit("/", 1)[-1]
            if not rx.search(name) or LIB_SKIP.search(rel):
                continue
            try:
                d = sf.info(os.path.join(LIB, rel)).duration
            except Exception:
                continue
            if lo * 0.8 <= d <= hi * 1.6:
                src = "Sonniss GDC 2024 bundle (royalty-free)" if rel.startswith("Sonniss") else "Adobe Audition Production Elements"
                cands.append((role, os.path.join(LIB, rel), src, name.rsplit(".", 1)[0]))
    return cands


def main():
    cands = gather("--no-generate" not in sys.argv)
    print(f"{len(cands)} candidates; narrator reference {VOICE_REF:.1f} dB", flush=True)
    rows = []
    for role, path, src, label in cands:
        try:
            y = finish(load(path), role)
        except Exception as e:
            print("skip", label, e)
            continue
        if y is None or not np.all(np.isfinite(y)):
            continue
        try:
            f = features(y)
            c = chroma(y) if f["tonal"] > 0.5 else None
            f["clarity"] = float(np.clip((c.max() - 0.12) / 0.25, 0, 1)) if c is not None else 0.0
        except Exception as e:
            print("skip", label, e)
            continue
        fits = []
        tuned = {}
        for k in BEDS:
            if c is None:
                tuned[k] = (y, 0)
                fits.append(1.0)
            else:
                yt, shift, fit = tune(y, k, c)
                tuned[k] = (yt, shift)
                fits.append(fit)
        pen, why = score(role, f, fits)
        rows.append(dict(role=role, path=path, src=src, label=label, pen=pen, why=why, f=f, fits=fits, tuned=tuned, y=y))
    with open(os.path.join(LAB, "v3_all.jsonl"), "w", encoding="utf-8") as fh:
        for r in sorted(rows, key=lambda r: (r["role"], r["pen"])):
            fh.write(json.dumps(dict(role=r["role"], origin=r["label"], penalty=r["pen"], flags=r["why"], fits=[round(x, 2) for x in r["fits"]],
                                     features={k: (round(v, 3) if isinstance(v, float) else v) for k, v in r["f"].items()})) + "\n")
    report = {}
    for role, spec in ROLES.items():
        rs = sorted([r for r in rows if r["role"] == role], key=lambda r: r["pen"])
        # Keep the best, then the next best that is distinct (not a near copy) yet of the same character.
        keep = []
        for r in rs:
            if len(keep) >= spec["keep"]:
                break
            if keep:
                a = keep[0]["f"]
                if abs(r["f"]["centroid"] - a["centroid"]) > 450 or abs(r["f"]["seconds"] - a["seconds"]) > 0.5:
                    continue
                if any(np.corrcoef(*[librosa.feature.melspectrogram(y=x["y"][: int(0.4 * SR)].astype(np.float32), sr=SR).mean(axis=1) for x in (r, q)])[0, 1] > 0.995 for q in keep):
                    continue
            keep.append(r)
        level_db = VOICE_REF + spec["offset"] - FILE_LOUD
        gain = 10 ** (level_db / 20)
        report[role] = dict(level=round(gain, 4), offset_db=spec["offset"], considered=len(rs), chosen=[], runners_up=[])
        for i, r in enumerate(keep):
            name = f"{role}-{i + 1}" if spec["keep"] > 1 else role
            files = {}
            tonal = r["f"]["tonal"] > 0.5
            for k, (yt, shift) in r["tuned"].items():
                fn = f"{name}-{k}.mp3" if tonal else f"{name}.mp3"
                wav = os.path.join(LAB, "v3_" + fn.replace(".mp3", ".wav"))
                sf.write(wav, np.stack([yt, yt], axis=1).astype(np.float32), SR)
                os.system(f'ffmpeg -v error -y -i "{wav}" -c:a libmp3lame -b:a 192k "{os.path.join(OUT, fn)}"')
                rise, jolt, gap = context_rise(yt, gain, k)
                files[fn] = dict(peak_s=round(features(yt)["peak_s"], 3), shift_semitones=shift, rise_in_speech_db=round(rise, 2), jolt_db=round(jolt, 2), rise_in_gap_db=round(gap, 2),
                                 sha256=hashlib.sha256(open(os.path.join(OUT, fn), "rb").read()).hexdigest())
                if not tonal:
                    break
            report[role]["chosen"].append(dict(name=name, source=r["src"], origin=r["label"], penalty=r["pen"], flags=r["why"],
                                               features={k: (round(v, 3) if isinstance(v, float) else v) for k, v in r["f"].items()},
                                               key_fit={k: round(v, 2) for k, v in zip(BEDS, r["fits"])}, files=files))
        report[role]["runners_up"] = [dict(origin=r["label"], penalty=r["pen"], flags=r["why"]) for r in rs[len(keep): len(keep) + 6]]
        print(f"\n== {role}: {len(rs)} considered, level {gain:.3f}")
        for c in report[role]["chosen"]:
            print(f"  KEEP {c['name']:8} pen {c['penalty']:5}  {c['origin'][:60]}  {c['flags']}")
            for fn, m in c["files"].items():
                print(f"       {fn:14} shift {m['shift_semitones']:+d}  rise {m['rise_in_speech_db']:.2f} dB  jolt {m['jolt_db']:.2f}  gap {m['rise_in_gap_db']:.2f}")
        for r in report[role]["runners_up"][:4]:
            print(f"  next {r['penalty']:5}  {r['origin'][:60]}  {r['flags']}")
    json.dump(dict(voice_ref_db=round(VOICE_REF, 2), file_loudness_db=FILE_LOUD, roles=report), open(os.path.join(LAB, "v3_report.json"), "w"), indent=1)


main()
