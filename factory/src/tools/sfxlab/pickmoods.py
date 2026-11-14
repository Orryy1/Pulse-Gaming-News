"""Chooses one bed per mood (data/sfxlab/moods, made by genmoods.py) by pickbeds.py's measurement and writes
it to public/music/mood_<mood>_<n>.wav (the best two): the same seamless loop, the same move to D or E major so the tuned sound
effects fit, the same loudness. A mood whose best take scores worse than MAX_PENALTY is left out, and its
chapters keep the house beds.

Usage (from the factory dir): python src/tools/sfxlab/pickmoods.py
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

WORK = os.path.join("data", "sfxlab", "moods")
OUT = os.path.join("public", "music")
# The house beds kept on 21 Oct scored 2.0 to 5.3; a mood bed may be a little freer (it plays one chapter).
MAX_PENALTY = 8.0
# Slower moods are slow on purpose: the tempo flag only counts below 76 BPM for them, and a reading under 60
# or over 130 is the beat tracker hearing half or double time.
SLOW = {"reflective", "tense"}


def main():
    rows = []
    for path in sorted(glob.glob(os.path.join(WORK, "*_[0-9].mp3"))):
        name = os.path.basename(path)[:-4]
        mood = name.rsplit("_", 1)[0]
        loop = os.path.join(WORK, f"{name}_loop.wav")
        if not os.path.exists(loop):
            r = subprocess.run([sys.executable, os.path.join(HERE, "loop.py"), path, loop], capture_output=True, text=True)
            if r.returncode:
                print("skip", name, r.stdout.strip(), r.stderr.strip()[-200:])
                continue
        shift, key, fit = P["retune"](loop)
        tuned = os.path.join(WORK, f"{name}_final.wav")
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
        rows.append(dict(name=name, mood=mood, file=tuned, key=key, shift=shift, penalty=pen, flags=flags, metrics=m))
        print(f"{name:14} pen {pen:5}  {key} ({shift:+d})  {flags}", flush=True)
    rights_path = os.path.join(OUT, "rights.json")
    rights = json.load(open(rights_path, encoding="utf-8"))
    kept = [r for r in rights.get("moods", []) if not any(x["mood"] == r["mood"] for x in rows)]
    for mood in sorted({r["mood"] for r in rows}):
        # Up to two takes per mood, so a long run of old games alternates instead of looping one bed.
        good = sorted((r for r in rows if r["mood"] == mood and r["penalty"] <= MAX_PENALTY), key=lambda r: r["penalty"])[:2]
        if not good:
            best = min((r for r in rows if r["mood"] == mood), key=lambda r: r["penalty"])
            print(f"NONE for {mood}: best {best['name']} scored {best['penalty']} {best['flags']}")
            continue
        for n, best in enumerate(good, 1):
            dest = os.path.join(OUT, f"mood_{mood}_{n}.wav")
            with open(best["file"], "rb") as f, open(dest, "wb") as g:
                g.write(f.read())
            kept.append(dict(
                mood=mood,
                file=f"music/mood_{mood}_{n}.wav",
                key=best["key"],
                sha256=hashlib.sha256(open(dest, "rb").read()).hexdigest(),
                origin=f"ElevenLabs Music, generated 2026-10-28 ({best['name']})",
                licence="ElevenLabs paid-plan commercial use; retire the bed on any Content ID claim",
                finishing=f"beat-aligned seamless loop, pitch {best['shift']:+d} semitones (rubberband, tempo kept), {P['TARGET_LUFS']} LUFS (src/tools/sfxlab/pickmoods.py)",
            ))
            print(f"KEEP mood_{mood}_{n} <- {best['name']} ({best['key']} major, penalty {best['penalty']})")
    rights["moods"] = sorted(kept, key=lambda r: r["mood"])
    with open(rights_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rights, fh, indent=2)
        fh.write("\n")
    json.dump(rows, open(os.path.join(WORK, "report.json"), "w"), indent=1, default=str)


main()
