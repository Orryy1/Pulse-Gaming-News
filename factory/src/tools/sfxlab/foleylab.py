"""Foley lab: the documentary's small sounds (public/sfx/foley), synthesised and measured like the v3 set.

Every photo, sketch and paper treatment and every Pulse device used to arrive in silence or on a shared
whoosh (creator study, 31 Oct 2026: foley tied to each graphic is what makes them feel tactile). These are
made here from numpy noise and tones, deterministically (fixed seeds, no downloads, no credits), so the set is
Pulse's own and a re-run writes the same files. Each recipe is finished by lab.py's own chain (trim, 38 Hz
high-pass, low-pass, fades, loudness-matched to its loudest 200 ms at -20 dB), then scored by lab.py's role
profile (length, harsh top, brightness, phone share, timing, decay, pitch, key clash, jolts) and its context
check against a real narrator and the music beds: how far the sound lifts the mix at its planned level.
A sound that fails a rule fails the run, and nothing is written for it.

Pitched sounds (the phone buzz, the bar tone, the riser and the chapter button) are made in both bed keys
(D and E) from the key's own notes, so the key fit is part of the recipe rather than a varispeed afterwards.

Usage (from the factory dir):
  python src/tools/sfxlab/foleylab.py [--voice path/to/voice.mp3] [--check]
--check measures the files already in public/sfx/foley against the same rules without writing.
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.getcwd()
LIVE_VOICE = "C:/PulseFactory/factory/data/episodes/ep_20261027_865858f8/voice.mp3"
voice = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else LIVE_VOICE
os.makedirs(os.path.join(ROOT, "data", "sfxlab"), exist_ok=True)
REF = os.path.join(ROOT, "data", "sfxlab", "foley_voice_ref.wav")
if not os.path.exists(REF):
    # Three minutes of the narrator is plenty for the context check and keeps lab.py's buffers small.
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "600", "-t", "180", "-i", voice, "-ac", "1", "-ar", "48000", REF], check=True)

src = open(os.path.join(HERE, "lab.py"), encoding="utf-8").read().rsplit("\nmain()", 1)[0]
for a, b in (
    ("data/smoke/deals/episodes/ep_20261021_b2c11f52/voice.mp3", "data/sfxlab/foley_voice_ref.wav"),
    ('BEDS = {"D": ["music_1.mp3", "music_2.mp3"], "E": ["music_3.mp3", "music_4.mp3"]}', 'BEDS = {"D": ["music/bed_2.wav", "music/bed_3.wav"], "E": ["music/bed_1.wav", "music/bed_4.wav"]}'),
):
    assert a in src, a
    src = src.replace(a, b)
L = {"__file__": os.path.join(HERE, "lab.py")}
exec(compile(src, "lab.py", "exec"), L)

import numpy as np  # noqa: E402
import scipy.signal as sg  # noqa: E402
import soundfile as sf  # noqa: E402

SR = L["SR"]
OUT = os.path.join(ROOT, "public", "sfx", "foley")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- building blocks (all seeded)


def rng(seed):
    return np.random.default_rng(seed)


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def band(y, lo, hi, order=2):
    return sg.sosfilt(sg.butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), y)


def lowp(y, f, order=2):
    return sg.sosfilt(sg.butter(order, f, "lowpass", fs=SR, output="sos"), y)


def pink(n, seed):
    # Voss-style approximation: white noise through the classic -3 dB/octave filter.
    w = rng(seed).standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return sg.lfilter(b, a, w)


def burst(seconds, lo, hi, decay_ms, seed, attack_ms=3.0):
    """A short filtered noise transient with an exponential decay. The house set has soft attacks (the v3
    tick's sharpest 10 ms step is under 2 dB), so even a click takes a few milliseconds to arrive."""
    t = t_of(seconds)
    e = np.exp(-t / (decay_ms / 1000)) * np.clip(t / (attack_ms / 1000 + 1e-9), 0, 1)
    return band(rng(seed).standard_normal(len(t)), lo, hi, 4) * e


def underlay(seconds, lo, hi, seed):
    """A soft continuous rustle under a run of hits (keys, flaps, ticks), so the sound never drops to silence
    between them and each hit rises from a floor rather than from nothing (no jolts)."""
    t = t_of(seconds)
    env = np.clip(t / 0.01, 0, 1) * np.clip((seconds - t) / 0.06, 0, 1)
    return band(pink(len(t), seed), lo, hi, 4) * env


def tone(seconds, f, decay_ms, phase=0.0):
    t = t_of(seconds)
    return np.sin(2 * np.pi * f * t + phase) * np.exp(-t / (decay_ms / 1000))


def place(total, parts):
    """Mix (offset seconds, signal, gain) parts into one buffer `total` seconds long."""
    out = np.zeros(int(total * SR))
    for at, y, g in parts:
        i = int(at * SR)
        n = min(len(y), len(out) - i)
        if n > 0:
            out[i: i + n] += g * y[:n]
    return out


def glide(seconds, f0, f1, shape=2.0):
    """A sine gliding from f0 to f1 (ease-out), its phase integrated so it never clicks."""
    t = t_of(seconds)
    x = t / seconds
    f = f0 + (f1 - f0) * (1 - (1 - x) ** shape)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# Notes of the two bed keys (Hz).
NOTE = {"D": {"root2": 73.42, "root3": 146.83, "third3": 185.0, "fifth3": 220.0, "root4": 293.66, "fifth4": 440.0},
        "E": {"root2": 82.41, "root3": 164.81, "third3": 207.65, "fifth3": 246.94, "root4": 329.63, "fifth4": 493.88}}

# ---------------------------------------------------------------- the recipes


def tape(_k=None):
    # A strip of tape torn off the roll: a dense run of tiny crackles over a soft ripping body.
    n = 0.42
    r = rng(101)
    grains = []
    at = 0.0
    while at < 0.34:
        dens = 0.004 + 0.012 * abs(at - 0.17) / 0.17
        grains.append((at, burst(0.012, 400, 1500, 4, int(r.integers(1e6)), 1.5), 0.3 + 0.4 * r.random()))
        at += dens * (0.6 + 0.8 * r.random())
    body = band(pink(int(n * SR), 102), 250, 1400, 4) * np.sin(np.pi * np.clip(t_of(n) / 0.36, 0, 1)) ** 0.7
    return place(n, grains + [(0, body, 1.0)])


def pin(_k=None):
    # A push pin into cork: the point's small tick, then the head's soft thock into the board.
    return place(0.2, [(0, burst(0.02, 600, 1500, 4, 201, 2), 0.3), (0.004, tone(0.1, 380, 25), 0.35), (0.004, burst(0.12, 180, 800, 40, 202), 1.0)])


def shutter(_k=None):
    # An instant camera firing: the blade's two clicks and the spring's short whirr between them.
    whirr = band(rng(301).standard_normal(int(0.12 * SR)), 400, 1100, 4) * (0.6 + 0.4 * np.sin(2 * np.pi * 90 * t_of(0.12)))
    whirr *= np.hanning(len(whirr))
    return place(0.34, [(0, burst(0.03, 500, 1600, 8, 302), 0.6), (0.0, burst(0.08, 150, 600, 25, 303), 0.9),
                        (0.02, whirr, 0.35), (0.11, burst(0.03, 500, 1500, 8, 304), 0.45), (0.11, burst(0.08, 150, 600, 20, 305), 0.6)])


def paper(_k=None):
    # A print or a page slid across a desk: soft pink friction that swells and settles.
    n = 0.5
    t = t_of(n)
    env = np.clip(t / 0.06, 0, 1) * np.exp(-np.clip(t - 0.12, 0, None) / 0.12)
    flutter = 0.8 + 0.2 * np.sin(2 * np.pi * 23 * t + 1.3)
    return band(pink(len(t), 401), 200, 1500, 4) * env * flutter


def page(_k=None):
    # A page turned: a swish that builds as the leaf lifts and a soft flap as it lands.
    n = 0.62
    t = t_of(n)
    env = np.sin(np.pi * np.clip(t / 0.45, 0, 1)) ** 1.5
    flutter = 0.7 + 0.3 * np.abs(np.sin(2 * np.pi * 9 * t))
    swish = band(pink(len(t), 501), 180, 1500, 4) * env * flutter
    return place(n, [(0, swish, 0.8), (0.34, burst(0.2, 120, 600, 50, 502, 12), 0.6)])


def typewriter(_k=None):
    # A few keys struck on a typewriter: each a muffled strike and the type bar's thunk, unevenly spaced,
    # over the machine's own faint rattle.
    r = rng(601)
    parts = []
    at = 0.0
    for i in range(6):
        g = 0.75 + 0.25 * r.random()
        parts += [(at, burst(0.02, 600, 1600, 4, 610 + i, 5), 0.35 * g), (at, burst(0.06, 150, 650, 25, 620 + i, 5), 1.0 * g)]
        at += 0.075 + 0.06 * r.random()
    total = at + 0.08
    return place(total, parts + [(0, underlay(total, 150, 900, 640), 0.3)])


def splitflap(_k=None):
    # A departures board's flaps: a fast clatter that slows to the last flap settling.
    r = rng(701)
    parts = []
    at = 0.0
    gap = 0.016
    for i in range(18):
        parts += [(at, burst(0.02, 500, 1500, 5, 710 + i, 4), 0.35 + 0.15 * r.random()), (at, burst(0.03, 150, 600, 9, 730 + i, 4), 0.4)]
        at += gap
        gap *= 1.07
    parts += [(at, burst(0.05, 150, 700, 18, 799, 6), 0.4)]
    total = at + 0.08
    return place(total, parts + [(0, underlay(total, 200, 1000, 798), 1.0)])


def crt(_k=None):
    # An old set's switch: a plastic click, then the tube's low soft thump and a breath of static.
    thump = glide(0.3, 62, 44) * np.exp(-t_of(0.3) / 0.09) * np.clip(t_of(0.3) / 0.006, 0, 1)
    static = band(rng(801).standard_normal(int(0.16 * SR)), 700, 1600, 4) * np.exp(-t_of(0.16) / 0.05)
    return place(0.38, [(0, burst(0.02, 500, 1500, 4, 802), 0.5), (0, burst(0.06, 150, 600, 15, 803), 0.8), (0.02, thump, 0.8), (0.03, static, 0.08)])


def click(_k=None):
    # A soft plastic switch or button: lamp on, carousel advance, a screen waking.
    return place(0.12, [(0, burst(0.02, 500, 1500, 3, 901), 0.35), (0, tone(0.05, 260, 12), 0.3), (0, burst(0.08, 120, 600, 20, 902), 0.9)])


def buzz(k):
    # A phone vibrating on a desk: two pulses of the motor at the key's root (its octave and fifth above
    # for a phone speaker). Between them the motor only spins down, never to silence, so the second pulse
    # swells from a floor instead of jolting in.
    f = NOTE[k]["root3"]
    n = 0.62
    t = t_of(n)
    motor = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) + 0.3 * np.sin(2 * np.pi * 3 * f * t)
    pulse = lambda a, b: np.clip((t - a) / 0.05, 0, 1) * np.clip((b - t) / 0.08, 0, 1)
    env = np.maximum(np.maximum(pulse(0, 0.24), 0.9 * pulse(0.34, 0.58)), 0.18 * pulse(0, 0.6))
    return motor * env


def tickroll(_k=None):
    # A counter rolling to its figure: soft woody taps that slow down, the last a touch firmer.
    r = rng(1101)
    parts = []
    at = 0.0
    gap = 0.045
    for i in range(12):
        last = i == 11
        parts += [(at, burst(0.03, 450, 1400, 9, 1110 + i, 5), (0.55 if not last else 0.9) * (0.85 + 0.15 * r.random())), (at, burst(0.04, 150, 500, 10, 1130 + i, 5), 0.5 if not last else 0.8)]
        at += gap
        gap *= 1.09
    total = at + 0.06
    return place(total, parts + [(0, underlay(total, 200, 900, 1199), 0.3)])


def bars(k):
    # Bars growing: three soft notes stepping up the key's chord (root, third, fifth), never a glide (a glide
    # passes through every note between and clashes with the bed), in the octave a phone speaker plays, an
    # octave under each for body; each note a little softer, so the root stays the sound's pitch.
    nn = NOTE[k]
    notes = [nn["root3"], nn["third3"], nn["fifth3"]]
    parts = []
    for i, f in enumerate(notes):
        t = t_of(0.5)
        e = np.clip(t / 0.04, 0, 1) * np.exp(-t / 0.18)
        parts.append((i * 0.16, (np.sin(2 * np.pi * 2 * f * t) + 0.4 * np.sin(2 * np.pi * f * t)) * e, 1.0 - 0.15 * i))
    return place(0.85, parts)


def riser(k):
    # Into a reveal: filtered noise opening upward over the key's root and fifth swelling, building to a peak at
    # about 1.45 s (the cue is placed so that lands on the revealed word), then gone in a breath.
    n = 1.6
    t = t_of(n)
    x = np.clip(t / 1.45, 0, 1)
    rise = x ** 2.0 * np.clip((n - t) / 0.15, 0, 1) ** 0.5
    noise = pink(len(t), 1301)
    # The band's centre sweeps 250 Hz to 1.6 kHz: filtered in short blocks with the centre for each block.
    out = np.zeros(len(t))
    blk = 1024
    for i in range(0, len(t), blk):
        c = 250 * (1600 / 250) ** (i / len(t))
        seg = noise[max(0, i - blk): i + blk]
        f = band(seg, c / 1.6, c * 1.6)
        out[i: i + blk] = f[min(i, blk): min(i, blk) + len(out[i: i + blk])]
    nn = NOTE[k]
    tonal = np.sin(2 * np.pi * nn["root3"] * t) + 0.6 * np.sin(2 * np.pi * nn["fifth3"] * t) + 0.3 * np.sin(2 * np.pi * nn["root4"] * t)
    return (out * 0.6 + tonal * 0.12) * rise


def button(k):
    # A chapter's last word: a soft felt-mallet hit on the key's root, its octave and fifth above for a phone
    # speaker, ringing out.
    t = t_of(1.4)
    nn = NOTE[k]
    y = (np.sin(2 * np.pi * nn["root2"] * t) * np.exp(-t / 0.6) * 0.35
         + np.sin(2 * np.pi * nn["root3"] * t) * np.exp(-t / 0.5) * 1.0
         + np.sin(2 * np.pi * nn["fifth3"] * t) * np.exp(-t / 0.35) * 0.5
         + np.sin(2 * np.pi * nn["root4"] * t) * np.exp(-t / 0.3) * 0.5)
    y *= np.clip(t / 0.006, 0, 1)
    return place(1.4, [(0, y, 1.0), (0, lowp(burst(0.05, 100, 900, 8, 1401), 1000), 0.25)])


# What each sound must be, in lab.py's terms (dur, peak_s, decay ms, low-pass, fade share, the level offset
# under the narrator in dB, how tonal it may be, its centre of energy, its phone-speaker share), plus RISE:
# how far it may lift the mix (voice and ducked music) at its level before it reads as intrusive.
ROLES = {
    "tape": dict(dur=(0.25, 0.7), peak_s=(0.0, 0.3), decay=(60, 450), lowpass=2800, fade=0.35, offset=-20, tonal_max=0.6, centroid=(350, 1100), phone=0.6, rise=1.5, make=tape),
    "pin": dict(dur=(0.08, 0.4), peak_s=(0.0, 0.05), decay=(30, 260), lowpass=2800, fade=0.6, offset=-20, tonal_max=0.9, centroid=(200, 900), phone=0.5, rise=1.5, make=pin),
    "shutter": dict(dur=(0.15, 0.5), peak_s=(0.0, 0.15), decay=(40, 380), lowpass=2800, fade=0.5, offset=-20, tonal_max=0.7, centroid=(250, 1000), phone=0.55, rise=1.5, make=shutter),
    "paper": dict(dur=(0.25, 0.8), peak_s=(0.0, 0.25), decay=(60, 500), lowpass=2800, fade=0.45, offset=-20, tonal_max=0.6, centroid=(300, 1000), phone=0.6, rise=1.5, make=paper),
    "page": dict(dur=(0.3, 0.9), peak_s=(0.05, 0.5), decay=(40, 500), lowpass=2800, fade=0.35, offset=-20, tonal_max=0.6, centroid=(250, 1000), phone=0.55, rise=1.5, make=page),
    "typewriter": dict(dur=(0.3, 1.0), peak_s=(0.0, 0.6), decay=(20, 900), lowpass=2800, fade=0.3, offset=-20, tonal_max=0.7, centroid=(250, 1000), phone=0.5, rise=1.5, make=typewriter),
    "splitflap": dict(dur=(0.25, 0.9), peak_s=(0.0, 0.6), decay=(20, 900), lowpass=2800, fade=0.3, offset=-20, tonal_max=0.6, centroid=(250, 1000), phone=0.55, rise=1.5, make=splitflap),
    "crt": dict(dur=(0.15, 0.6), peak_s=(0.0, 0.12), decay=(40, 450), lowpass=2800, fade=0.5, offset=-20, tonal_max=1.0, centroid=(120, 800), phone=0.3, rise=1.5, make=crt),
    "click": dict(dur=(0.05, 0.3), peak_s=(0.0, 0.04), decay=(20, 220), lowpass=2800, fade=0.6, offset=-20, tonal_max=0.9, centroid=(150, 900), phone=0.4, rise=1.5, make=click),
    "buzz": dict(dur=(0.4, 0.9), peak_s=(0.0, 0.5), decay=(20, 700), lowpass=2500, fade=0.15, offset=-21, tonal_max=1.0, centroid=(150, 700), phone=0.5, rise=1.5, make=buzz, tonal=True),
    "tickroll": dict(dur=(0.5, 1.4), peak_s=(0.0, 1.2), decay=(20, 1300), lowpass=2800, fade=0.25, offset=-21, tonal_max=0.8, centroid=(250, 1000), phone=0.55, rise=1.5, make=tickroll),
    "bars": dict(dur=(0.4, 1.0), peak_s=(0.0, 0.6), decay=(80, 600), lowpass=2800, fade=0.3, offset=-21, tonal_max=1.0, centroid=(150, 700), phone=0.5, rise=1.5, make=bars, tonal=True),
    "riser": dict(dur=(1.0, 2.0), peak_s=(1.1, 1.55), decay=(40, 400), lowpass=3500, fade=0.06, offset=-18, tonal_max=1.0, centroid=(200, 900), phone=0.5, rise=3.0, make=riser, tonal=True),
    "button": dict(dur=(0.6, 1.8), peak_s=(0.0, 0.2), decay=(250, 1300), lowpass=2500, fade=0.4, offset=-17, tonal_max=1.0, centroid=(120, 500), phone=0.3, rise=3.0, make=button, tonal=True),
}
PENALTY_MAX = 2.0
JOLT_MAX = 7.0
# A run of hits (keys, flaps, ticks) decays from the last hit, so those roles allow a longer decay; the key
# floor is the house sting's own measured fit (0.87, src/tools/sfxlab/v3_report.json) less a margin, since a
# synthetic tone's chroma leaks into the semitones beside it (a pure D4 sine measures 0.97).
KEY_FIT_MIN = 0.85


def measure(name, y, k):
    spec = ROLES[name]
    L["ROLES"][name] = {kk: v for kk, v in spec.items() if kk not in ("make", "rise", "tonal")} | {"keep": 1}
    f = L["features"](y)
    fit = 1.0
    if spec.get("tonal"):
        c = L["chroma"](y)
        f["clarity"] = float(np.clip((c.max() - 0.12) / 0.25, 0, 1))
        t = L["NAMES"].index(k)
        scale = [(t + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)]
        fit = float(c[scale].sum())
    else:
        f["clarity"] = 0.0
    pen, why = L["score"](name, f, [fit])
    level_db = L["VOICE_REF"] + spec["offset"] - L["FILE_LOUD"]
    gain = 10 ** (level_db / 20)
    rise, jolt, gap = L["context_rise"](y, gain, k or "D")
    fails = []
    if pen > PENALTY_MAX:
        fails.append(f"penalty {pen} ({', '.join(why)})")
    if rise > spec["rise"]:
        fails.append(f"lifts the mix {rise:.2f} dB (max {spec['rise']})")
    if jolt > JOLT_MAX:
        fails.append(f"jolt {jolt:.1f} dB")
    if spec.get("tonal") and fit < KEY_FIT_MIN:
        fails.append(f"key fit {fit:.2f} in {k}")
    if spec["offset"] > -14:
        fails.append("level less than 14 dB under the narrator")
    return dict(penalty=pen, flags=why, key_fit=round(fit, 3), rise_in_speech_db=round(rise, 2), jolt_db=round(jolt, 2), rise_in_gap_db=round(gap, 2),
                level_offset_db=spec["offset"], features={kk: (round(v, 3) if isinstance(v, float) else v) for kk, v in f.items()}), fails


def files_of(name):
    return [(f"{name}-{k}", k) for k in ("D", "E")] if ROLES[name].get("tonal") else [(name, None)]


def main():
    check_only = "--check" in sys.argv
    report, rights, failed = {}, [], []
    print(f"narrator reference {L['VOICE_REF']:.1f} dB")
    for name, spec in ROLES.items():
        for fn, k in files_of(name):
            path = os.path.join(OUT, f"{fn}.mp3")
            if check_only:
                if not os.path.exists(path):
                    failed.append(f"{fn}: missing")
                    continue
                y = L["load"](path)
            else:
                L["ROLES"][name] = {kk: v for kk, v in spec.items() if kk not in ("make", "rise", "tonal")} | {"keep": 1}
                y = L["finish"](spec["make"](k).astype(np.float64), name)
            m, fails = measure(name, y, k)
            print(f"{fn:12} pen {m['penalty']:5}  rise {m['rise_in_speech_db']:4.2f} dB  jolt {m['jolt_db']:4.1f}  fit {m['key_fit']:.2f}  "
                  f"{m['features']['seconds']:.2f}s peak {m['features']['peak_s']:.3f}s  {'FAIL ' + '; '.join(fails) if fails else 'ok'}  {m['flags']}")
            report[fn] = m
            if fails:
                failed.append(f"{fn}: {'; '.join(fails)}")
                continue
            if not check_only:
                wav = os.path.join(ROOT, "data", "sfxlab", f"foley_{fn}.wav")
                sf.write(wav, np.stack([y, y], axis=1).astype(np.float32), SR)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", path], check=True)
                rights.append(dict(file=f"foley/{fn}.mp3", sha256=hashlib.sha256(open(path, "rb").read()).hexdigest(),
                                   origin=f"synthesised by src/tools/sfxlab/foleylab.py ({spec['make'].__name__}, numpy noise and tones, fixed seeds); no third-party audio",
                                   licence="Pulse's own; no claim possible",
                                   finishing=f"lab.py finish(): trimmed, 38 Hz high-pass, {spec['lowpass']} Hz low-pass, fades, loudness-matched (-20.0 dB K-weighted 200 ms max); peak at {m['features']['peak_s']} s"))
    if not check_only:
        json.dump({"schema": "pulse-audio-rights-v1", "sfx": rights}, open(os.path.join(OUT, "rights.json"), "w", encoding="utf-8"), indent=2)
        json.dump(dict(voice_ref_db=round(L["VOICE_REF"], 2), file_loudness_db=L["FILE_LOUD"], penalty_max=PENALTY_MAX, sounds=report),
                  open(os.path.join(HERE, "foley_report.json"), "w", encoding="utf-8"), indent=1)
    if failed:
        print("\nFAIL\n  " + "\n  ".join(failed))
        sys.exit(1)
    print("\nPASS")


main()
