"""Chooses the Epidemic Sound beds (data/sfxlab/epidemic/mix, made by epidemic.mjs) by pickbeds.py's
measurement: the same seamless loop, the same move to D or E major so the tuned sound effects fit, the same
loudness. Up to KEEP per mood that score MAX_PENALTY or better go to public/music/es/<mood>_<n>-<key>.wav
(the key in the name tells the renderer which tuned sounds to play over it).

The beds are too large for git, so public/music/es is ignored and src/assets/epidemic_beds.json (committed)
lists them with each track's Epidemic ID; the pipeline offers the renderer only the beds present on disk.
`node src/tools/sfxlab/epidemic.mjs --restore` remakes the mixes from that list on another machine.

Usage (from the factory dir): python src/tools/sfxlab/pickepidemic.py
"""
import glob
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
src = open(os.path.join(HERE, "pickbeds.py"), encoding="utf-8").read().rsplit("\nmain()", 1)[0]
P = {"__file__": os.path.join(HERE, "pickbeds.py"), "__name__": "pickbeds"}
exec(compile(src, "pickbeds.py", "exec"), P)

WORK = os.path.join("data", "sfxlab", "epidemic", "mix")
OUT = os.path.join("public", "music", "es")
LIST = os.path.join("src", "assets", "epidemic_beds.json")
MAX_PENALTY = 8.0
KEEP = 6
SLOW = {"reflective", "tense"}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = json.load(open(os.path.join("data", "sfxlab", "epidemic", "manifest.json"), encoding="utf-8"))
    by_file = {os.path.basename(v["file"]): (k, v) for k, v in manifest.items()}
    rows = []
    for path in sorted(glob.glob(os.path.join(WORK, "es_*.wav"))):
        if path.endswith(("_loop.wav", "_final.wav", "_tmp.wav")):
            continue
        base = os.path.basename(path)
        if base not in by_file:
            continue
        rid, meta = by_file[base]
        name = base[:-4]
        mood = meta["mood"]
        loop = os.path.join(WORK, f"{name}_loop.wav")
        if not os.path.exists(loop):
            r = subprocess.run([sys.executable, os.path.join(HERE, "loop.py"), path, loop], capture_output=True, text=True)
            if r.returncode:
                print("skip", name, r.stdout.strip()[-120:])
                continue
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
        if mood in SLOW:
            t = m["tempo"] * 2 if m["tempo"] < 60 else m["tempo"] / 2 if m["tempo"] > 130 else m["tempo"]
            m = dict(m, tempo=max(t, 88) if t >= 76 else t)
        pen, flags = P["score"](m)
        rows.append(dict(id=rid, meta=meta, name=name, mood=mood, file=tuned, key=key, shift=shift, penalty=pen, flags=flags))
        print(f"{mood:10} {meta['title'][:30]:30} pen {pen:6}  {key} ({shift:+d})  {flags}", flush=True)
    beds = []
    for f in glob.glob(os.path.join(OUT, "*.wav")):
        os.remove(f)
    for mood in sorted({r["mood"] for r in rows}):
        good = sorted((r for r in rows if r["mood"] == mood and r["penalty"] <= MAX_PENALTY), key=lambda r: r["penalty"])[:KEEP]
        for n, r in enumerate(good, 1):
            fn = f"{mood}_{n}-{r['key']}.wav"
            dest = os.path.join(OUT, fn)
            with open(r["file"], "rb") as a, open(dest, "wb") as b:
                b.write(a.read())
            beds.append(dict(
                mood=mood,
                file=f"music/es/{fn}",
                key=r["key"],
                epidemic_id=r["id"],
                title=r["meta"]["title"],
                artists=r["meta"]["artists"],
                parts=r["meta"]["parts"],
                penalty=r["penalty"],
                sha256=hashlib.sha256(open(dest, "rb").read()).hexdigest(),
                licence="Epidemic Sound Creator plan; Pulse's YouTube, TikTok, Facebook and Instagram are safelisted",
                finishing=f"{'+'.join(p.lower() for p in r['meta']['parts'])} stems (no melody), beat-aligned seamless loop, pitch {r['shift']:+d} semitones, {P['TARGET_LUFS']} LUFS (src/tools/sfxlab/pickepidemic.py)",
            ))
            print(f"KEEP {fn} <- {r['meta']['title']} ({r['penalty']})")
        if not good:
            print(f"NONE for {mood}")
    with open(LIST, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(dict(schema="pulse-epidemic-beds-v1", beds=beds), fh, indent=1)
        fh.write("\n")


main()
