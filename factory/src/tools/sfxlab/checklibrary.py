"""Checks every music bed in public/music/rights.json (18 Nov 2026): present, its hash as recorded, its loudness at
pickbeds.py's TARGET_LUFS (within LUFS_TOL), and in the key it is listed in (pickbeds.py retune finds no pitch move
and the same key). The voice-pocket copies are checked by data/smoke/pocketbeds.mts check.

Writes data/sfxlab/library_check.json; exits 1 if any bed fails.

Usage (from the factory dir): python src/tools/sfxlab/checklibrary.py [--jobs 6]
"""
import hashlib
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "pickbeds.py"), encoding="utf-8").read().rsplit("\nmain()", 1)[0]
P = {"__file__": os.path.join(HERE, "pickbeds.py"), "__name__": "pickbeds"}
sys.path.insert(0, HERE)
exec(compile(src, "pickbeds.py", "exec"), P)

LUFS_TOL = 0.5
REPORT = os.path.join("data", "sfxlab", "library_check.json")


def check(r):
    path = os.path.join("public", r["file"])
    row = dict(file=r["file"], mood=r.get("mood"), listed_key=r["key"], problems=[])
    if not os.path.exists(path):
        row["problems"].append("missing")
        return row
    row["mb"] = round(os.path.getsize(path) / 1e6, 1)
    if hashlib.sha256(open(path, "rb").read()).hexdigest() != r["sha256"]:
        row["problems"].append("sha256 differs from rights.json")
    row["lufs"] = round(P["lufs"](path), 2)
    if abs(row["lufs"] - P["TARGET_LUFS"]) > LUFS_TOL:
        row["problems"].append(f"loudness {row['lufs']} LUFS, not {P['TARGET_LUFS']} +/- {LUFS_TOL}")
    shift, key, fit = P["retune"](path)
    row.update(key=key, shift=shift, key_fit=round(fit, 3))
    if shift != 0 or key != r["key"]:
        row["problems"].append(f"measures {key} major with a {shift:+d} move, listed {r['key']}")
    return row


def main():
    jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 6
    rights = json.load(open(os.path.join("public", "music", "rights.json"), encoding="utf-8"))
    beds = rights["beds"] + rights.get("moods", [])
    with ProcessPoolExecutor(jobs) as ex:
        rows = list(ex.map(check, beds))
    bad = [r for r in rows if r["problems"]]
    for r in rows:
        print(f"{r['file']:32} {r.get('lufs', '-'):>7} LUFS  {r.get('key', '-')} ({r.get('shift', 0):+d}) fit {r.get('key_fit', '-')}  {'; '.join(r['problems']) or 'ok'}")
    lufs = [r["lufs"] for r in rows if "lufs" in r]
    summary = dict(beds=len(rows), failed=len(bad), lufs_min=min(lufs), lufs_max=max(lufs), target=P["TARGET_LUFS"],
                   key_fit_min=min(r["key_fit"] for r in rows if "key_fit" in r))
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(dict(summary=summary, beds=rows), fh, indent=1)
        fh.write("\n")
    print(json.dumps(summary))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
