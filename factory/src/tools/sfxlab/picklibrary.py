"""Chooses the second round of music beds (data/sfxlab/library, made by genlibrary.py) by pickbeds.py's own
measurement and adds them to public/music beside the beds already there, which are never touched: house takes
become bed_5.wav onwards, mood takes mood_<mood>_<n>.wav after the mood's existing ones. Every take gets the
same finishing as before (a seamless beat-cut loop, moved to D or E major so the tuned sounds fit, matched to
-12.7 LUFS) and the same scoring (little in the speech band, no lead melody, steady, not frantic, no breakdown,
a clean loop, not bass-heavy, a sane tempo).

Two rules on top: a house bed must score within MAX_HOUSE (the beds kept on 21 Oct scored 2.0 to 5.3), a mood
bed within pickmoods.py's MAX_PENALTY; and a take that sounds too much like a bed already kept (its averaged
timbre and harmony correlate above SAME) is passed over, so a bigger library is really more varied.

Writes public/music/rights.json (appended), data/sfxlab/library/report.json, and prints the lines for
src/render/soundscape.ts (BEDS, MOOD_BEDS, BED_GRID).

Usage (from the factory dir): python src/tools/sfxlab/picklibrary.py [--extra data/sfxlab/beds/el_synth.mp3 ...] [--jobs 6] [--dry]
"""
import glob
import hashlib
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import librosa
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
src = open(os.path.join(HERE, "pickbeds.py"), encoding="utf-8").read().rsplit("\nmain()", 1)[0]
P = {"__file__": os.path.join(HERE, "pickbeds.py"), "__name__": "pickbeds"}
exec(compile(src, "pickbeds.py", "exec"), P)

# BEDS_WORK moves the takes and their working audio off the factory drive (15 Nov 2026: C: was short of space).
WORK = os.environ.get("BEDS_WORK") or os.path.join("data", "sfxlab", "library")
OUT = os.path.join("public", "music")
MAX_HOUSE = 6.0
MAX_MOOD = 8.0
# At most this many beds per mood in all (a mood plays one chapter at a time; four keep a run of chapters fresh).
PER_MOOD = 4
# At most this many house beds in all.
HOUSE_CAP = 24
# Two beds whose averaged chroma, timbre (MFCC), spectral contrast and tempo, each standardised across every
# bed and take measured, correlate above this sound like the same track. Calibrated 15 Nov 2026 on the beds
# kept so far: distinct tracks reach 0.61 at most (two "warm modern electronic" takes), the same take 1.0.
SAME = 0.8
# Slower moods are slow on purpose (pickmoods.py SLOW): the tempo flag only counts below 76 BPM for them, and a
# reading under 60 or over 130 is the beat tracker hearing half or double time.
SLOW = {"reflective", "tense", "mystery", "chill"}
DATE = "2026-11-15"
LICENCE = "ElevenLabs paid-plan commercial use; retire the bed on any Content ID claim"


def profile(path):
    y, sr = librosa.load(path, sr=22050, mono=True, duration=90)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)[1:].mean(axis=1) / 50
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr).mean(axis=1) / 20
    tempo = float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0]) / 120
    return np.concatenate([chroma / (chroma.max() + 1e-9), mfcc, contrast, [tempo]]).tolist()


def grid(path):
    """bedgrid.py's numbers: the bar (four beats), the first beat and the loop's length, in seconds."""
    y, sr = librosa.load(path, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    tempo = float(np.atleast_1d(tempo)[0])
    if len(beats) > 8:
        beat, first = (float(v) for v in np.polyfit(np.arange(len(beats)), beats, 1))
        first %= beat
    else:
        beat, first = 60 / tempo, 0.0
    length = len(y) / sr
    bars = length / (4 * beat)
    return dict(bar=round(4 * beat, 4), first=round(first, 4), loop=round(length, 4), whole=abs(bars - round(bars)) < 0.05)


def measure(path):
    name = os.path.basename(path)[:-4]
    group = name.rsplit("_", 1)[0] if name[-1].isdigit() else "house"
    if os.path.dirname(os.path.abspath(path)) != os.path.abspath(WORK):
        group, name = "house", f"r1_{name}"  # a 21 Oct candidate passed with --extra
    loop = os.path.join(WORK, f"{name}_loop.wav")
    if not os.path.exists(loop):
        r = subprocess.run([sys.executable, os.path.join(HERE, "loop.py"), path, loop], capture_output=True, text=True)
        if r.returncode:
            return dict(name=name, group=group, skip=(r.stdout.strip() + " " + r.stderr.strip()[-200:]))
    shift, key, fit = P["retune"](loop)
    tuned = os.path.join(WORK, f"{name}_final.wav")
    if not os.path.exists(tuned):
        chain = [f"rubberband=pitch={2 ** (shift / 12):.6f}:transients=crisp"] if shift else []
        tmp = os.path.join(WORK, f"{name}_tmp.wav")
        P["ff"]("-i", loop, "-af", ",".join(chain) or "anull", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", tmp)
        gain = P["TARGET_LUFS"] - P["lufs"](tmp)
        P["ff"]("-i", tmp, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.95:level=false", "-c:a", "pcm_s16le", tuned)
        os.remove(tmp)
    m = P["bed"](tuned)
    m["seam"], m["dip"] = P["flow"](tuned)
    if group in SLOW:
        t = m["tempo"] * 2 if m["tempo"] < 60 else m["tempo"] / 2 if m["tempo"] > 130 else m["tempo"]
        m = dict(m, tempo=max(t, 88) if t >= 76 else t)
    pen, flags = P["score"](m)
    return dict(name=name, group=group, src=path, file=tuned, key=key, shift=shift, penalty=pen, flags=flags,
                metrics=m, profile=profile(tuned))


def corr(a, b):
    return float(np.corrcoef(np.array(a), np.array(b))[0, 1])


TS = os.path.join("src", "render", "bedlibrary.ts")


def write_ts(rights, grids):
    """src/render/bedlibrary.ts from every bed this script added (rights.json is the record; grids by file)."""
    mine = lambda r: "picklibrary.py" in r.get("finishing", "")
    beds = [r for r in rights["beds"] if mine(r)]
    moods = [r for r in rights.get("moods", []) if mine(r)]
    lines = [
        "// GENERATED by src/tools/sfxlab/picklibrary.py from public/music/rights.json: do not edit by hand.",
        "// The music beds added on 15 Nov 2026 (ElevenLabs Music, picked by measurement); src/render/soundscape.ts adds",
        "// them to BEDS, MOOD_BEDS and BED_GRID.",
        'import type { Mood } from "./musicplan.ts";',
        "",
        'export const LIBRARY_BEDS: ReadonlyArray<{ file: string; key: "D" | "E" }> = [',
        *[f'  {{ file: "{r["file"]}", key: "{r["key"]}" }},' for r in beds],
        "];",
        "",
        'export const LIBRARY_MOODS: ReadonlyArray<{ mood: Mood; file: string; key: "D" | "E" }> = [',
        *[f'  {{ mood: "{r["mood"]}", file: "{r["file"]}", key: "{r["key"]}" }},' for r in moods],
        "];",
        "",
        "// The bar grid (seconds), as src/tools/sfxlab/bedgrid.py measures it; a loop that is not a whole number of",
        "// bars is left out (its grid would drift), as the retro bed was.",
        "export const LIBRARY_GRID: Record<string, { bar: number; first: number; loop: number }> = {",
    ]
    for r in beds + moods:
        g = grids.get(r["file"]) or grid(os.path.join("public", r["file"]))
        if g["whole"] and 1.5 <= g["bar"] <= 4:
            lines.append(f'  "{r["file"].split("/")[-1]}": {{ bar: {g["bar"]}, first: {g["first"]}, loop: {g["loop"]} }},')
    lines += ["};", ""]
    with open(TS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {TS}: {len(beds)} house beds, {len(moods)} mood beds")


def main():
    jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 6
    extra = [a for i, a in enumerate(sys.argv) if i and sys.argv[i - 1] == "--extra"]
    dry = "--dry" in sys.argv
    takes = sorted(glob.glob(os.path.join(WORK, "*_[0-9].mp3")) + glob.glob(os.path.join(WORK, "*_[0-9][0-9].mp3"))) + extra
    with ProcessPoolExecutor(jobs) as ex:
        rows = list(ex.map(measure, takes))
    for r in rows:
        if "skip" in r:
            print(f"skip {r['name']}: {r['skip']}")
        else:
            print(f"{r['name']:14} pen {r['penalty']:6}  {r['key']} ({r['shift']:+d})  {r['flags']}", flush=True)
    rows = [r for r in rows if "skip" not in r]
    rights_path = os.path.join(OUT, "rights.json")
    rights = json.load(open(rights_path, encoding="utf-8"))
    # The beds already kept: never replaced, and the yardstick for "sounds the same".
    kept_profiles = {}
    with ProcessPoolExecutor(jobs) as ex:
        old = [os.path.join("public", r["file"]) for r in rights["beds"] + rights.get("moods", [])]
        for f, p in zip(old, ex.map(profile, old)):
            kept_profiles[f.replace("\\", "/").split("public/", 1)[1]] = p
    # Standardise each feature across everything measured, so the comparison hears differences, not the shared shape.
    allp = np.array([r["profile"] for r in rows] + list(kept_profiles.values()))
    mu, sd = allp.mean(axis=0), allp.std(axis=0) + 1e-9
    z = lambda p: ((np.array(p) - mu) / sd).tolist()
    kept_profiles = {k: z(p) for k, p in kept_profiles.items()}
    for r in rows:
        r["z"] = z(r["profile"])
    house_n = len(rights["beds"])
    added = []

    def novel(r):
        worst = max((corr(r["z"], p) for p in kept_profiles.values()), default=0)
        return worst <= SAME, round(worst, 3)

    def keep(r, dest_rel, entry):
        dest = os.path.join("public", dest_rel)
        if not dry:
            with open(r["file"], "rb") as f, open(dest, "wb") as g:
                g.write(f.read())
        kept_profiles[dest_rel] = r["z"]
        entry.update(
            file=dest_rel,
            key=r["key"],
            sha256=hashlib.sha256(open(r["file"], "rb").read()).hexdigest(),
            origin=(f"ElevenLabs Music, generated 2026-10-21 ({r['name'][3:]})" if r["name"].startswith("r1_")
                    else f"ElevenLabs Music, generated {DATE} ({r['name']})"),
            licence=LICENCE,
            finishing=f"beat-aligned seamless loop, pitch {r['shift']:+d} semitones (rubberband, tempo kept), {P['TARGET_LUFS']} LUFS (src/tools/sfxlab/picklibrary.py)",
        )
        added.append(dict(entry, penalty=r["penalty"], grid=grid(r["file"])))

    for r in sorted((r for r in rows if r["group"] == "house"), key=lambda r: r["penalty"]):
        if r["penalty"] > MAX_HOUSE or house_n >= HOUSE_CAP:
            continue
        ok, worst = novel(r)
        if not ok:
            print(f"same as a kept bed: {r['name']} ({worst})")
            continue
        house_n += 1
        entry = {}
        keep(r, f"music/bed_{house_n}.wav", entry)
        rights["beds"].append(entry)
        print(f"KEEP bed_{house_n} <- {r['name']} ({r['key']} major, penalty {r['penalty']})")
    moods = rights.setdefault("moods", [])
    for mood in sorted({r["group"] for r in rows} - {"house"}):
        have = [m for m in moods if m["mood"] == mood]
        n = max((int(m["file"].rsplit("_", 1)[1].split(".")[0]) for m in have), default=0)
        for r in sorted((r for r in rows if r["group"] == mood), key=lambda r: r["penalty"]):
            if r["penalty"] > MAX_MOOD or len(have) >= PER_MOOD:
                continue
            ok, worst = novel(r)
            if not ok:
                print(f"same as a kept bed: {r['name']} ({worst})")
                continue
            n += 1
            entry = {"mood": mood}
            keep(r, f"music/mood_{mood}_{n}.wav", entry)
            moods.append(entry)
            have.append(entry)
            print(f"KEEP mood_{mood}_{n} <- {r['name']} ({r['key']} major, penalty {r['penalty']})")
        if not have:
            best = min((r for r in rows if r["group"] == mood), key=lambda r: r["penalty"])
            print(f"NONE for {mood}: best {best['name']} scored {best['penalty']} {best['flags']}")
    rights["moods"] = sorted(moods, key=lambda r: (r["mood"], r["file"]))
    if not dry:
        with open(rights_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(rights, fh, indent=2)
            fh.write("\n")
    json.dump(dict(rows=rows, added=added), open(os.path.join(WORK, "report.json"), "w"), indent=1, default=str)
    if not dry:
        write_ts(rights, {x["file"]: x["grid"] for x in added})
    print("\n// soundscape.ts BED_GRID additions")
    for a in added:
        g = a["grid"]
        print(f'  "{a["file"].split("/")[-1]}": {{ bar: {g["bar"]}, first: {g["first"]}, loop: {g["loop"]} }},{"" if g["whole"] else "  // not whole bars"}')
    print("\n// BEDS additions")
    for a in added:
        if "mood" not in a:
            print(f'  {{ file: "{a["file"]}", key: "{a["key"]}" }},')
    print("\n// MOOD_BEDS additions")
    for a in added:
        if "mood" in a:
            print(f'  {a["mood"]}: {{ file: "{a["file"]}", key: "{a["key"]}" }},')


if __name__ == "__main__":
    main()
