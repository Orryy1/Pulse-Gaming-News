"""Retro sound lab: the sounds of the retro kit (src/render/components/Retro.tsx) by the same measurement as
lab.py: an old TV switching on, a tape going into a VCR, soft static on a cut, and a TV powering off.

It reuses lab.py's finishing, features, scoring and context checks (the real narrator and music beds), with
roles of its own. ElevenLabs takes are made once (skipped when the file exists), so a re-run costs nothing;
--budget caps the credits a run may spend (measured from the account before and after each take).

Usage (from the factory dir): python src/tools/sfxlab/retrolab.py [--no-generate] [--budget 5000]
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "lab.py"), encoding="utf-8").read().rsplit("\nmain()", 1)[0]
# The same chain, writing its own files: the v3 set and its report stay untouched.
for a, b in (
    # Today's references: a long video's narrator (Liam) and the current beds (keys from src/render/soundscape.ts).
    ("data/smoke/deals/episodes/ep_20261021_b2c11f52/voice.mp3", "data/smoke/longdry/episodes/ep_20261021_db8d609b/voice.mp3"),
    ('BEDS = {"D": ["music_1.mp3", "music_2.mp3"], "E": ["music_3.mp3", "music_4.mp3"]}', 'BEDS = {"D": ["music/bed_2.wav", "music/bed_3.wav"], "E": ["music/bed_1.wav", "music/bed_4.wav"]}'),
    ("v3_all.jsonl", "retro_all.jsonl"), ("v3_report.json", "retro_report.json"), ('"v3_" + fn', '"retro_" + fn')):
    assert a in src, a
    src = src.replace(a, b)
L ={"__file__": os.path.join(HERE, "lab.py")}
exec(compile(src, "lab.py", "exec"), L)

L["RAW"] = RAW = os.path.join(L["LAB"], "retroraw")
L["OUT"] = OUT = os.path.join(L["ROOT"], "public", "sfx", "retro")
os.makedirs(RAW, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

FAMILY = "Warm, soft, nostalgic, close and intimate, premium documentary sound design. No harsh highs, no high-pitched whine, no metallic ring, no distortion, no voice, no music."
GEN = {
    "tvon": [
        "an old 1990s CRT television switching on: a soft plastic button click, then a low warm electrical thump as the picture tube warms up, a faint soft crackle of static electricity",
        "a vintage tube television powering on in a quiet living room, a muted click and a deep soft whoomp of the screen charging, gentle and short",
    ],
    "vhs": [
        "a VHS tape being pushed into a 1990s video recorder: a soft plastic slide, a gentle mechanical clunk as it is pulled in, a short quiet motor whirr",
        "a video cassette loading into an old VCR, a muffled mechanical thunk and the soft hum of the tape heads spinning up",
        "a deep, muffled, low thunk of a video cassette being drawn into a VCR in the next room, dull and heavy, with a low soft motor hum, no clicks, no rattle",
    ],
    "static": [
        "a short soft burst of old analogue TV static between channels, muffled and warm as if heard from across a room, gentle fade",
        "a brief gentle crackle of television snow as the channel changes, soft and low, quickly fading",
    ],
    "poweroff": [
        "an old CRT television switching off: a soft click and a low warm electrical collapse as the picture shrinks to a dot, a faint soft fizz fading out",
        "a vintage tube TV powering down, a muted thunk and a gentle descending whoomp of the screen discharging, short and soft",
    ],
}
SECONDS = {"tvon": 1.4, "vhs": 1.8, "static": 0.7, "poweroff": 1.0}
TAKES = 3

L["ROLES"] = ROLES = {
    "tvon": dict(dur=(0.5, 1.8), peak_s=(0.0, 0.6), decay=(120, 1000), lowpass=5000, fade=0.45, keep=1, offset=-18, tonal_max=0.8, centroid=(250, 1100), phone=0.5),
    "vhs": dict(dur=(0.7, 2.4), peak_s=(0.0, 1.0), decay=(100, 1300), lowpass=6000, fade=0.4, keep=1, offset=-18, tonal_max=0.7, centroid=(250, 1200), phone=0.5),
    # Static is broadband by nature: rolled off low so it reads as soft snow, never hiss.
    "static": dict(dur=(0.3, 1.0), peak_s=(0.0, 0.25), decay=(80, 700), lowpass=3500, fade=0.6, keep=1, offset=-22, tonal_max=0.6, centroid=(300, 1300), phone=0.6),
    "poweroff": dict(dur=(0.4, 1.3), peak_s=(0.0, 0.3), decay=(100, 800), lowpass=5000, fade=0.55, keep=1, offset=-18, tonal_max=0.8, centroid=(200, 1000), phone=0.5),
}
LIB_RE = {"static": re.compile(r"^Module Production Element Title Imaging Distortion (Random )?Static 0\d", re.I)}


def credits_used(key):
    req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": key})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["character_count"]


def generate(budget):
    key = L["env_key"]()
    start = credits_used(key)
    estimate = 0
    for role, prompts in GEN.items():
        for pi, prompt in enumerate(prompts):
            for t in range(TAKES):
                dest = os.path.join(RAW, f"{role}_p{pi}_t{t}.mp3")
                if os.path.exists(dest):
                    continue
                # The account's counter lags by minutes: count each take at 40 credits a second as well.
                spent = max(credits_used(key) - start, estimate)
                if spent >= budget:
                    print(f"budget reached: {spent} credits spent", flush=True)
                    return spent
                body = json.dumps({"text": f"{prompt}. {FAMILY}", "duration_seconds": SECONDS[role], "prompt_influence": 0.55}).encode()
                req = urllib.request.Request("https://api.elevenlabs.io/v1/sound-generation", data=body, method="POST",
                                             headers={"xi-api-key": key, "content-type": "application/json"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    open(dest, "wb").write(r.read())
                estimate += 40 * SECONDS[role]
                print("generated", os.path.basename(dest), flush=True)
    spent = credits_used(key) - start
    print(f"generation spent {spent} credits", flush=True)
    return spent


def gather():
    cands = []
    for role in ROLES:
        for fn in sorted(os.listdir(RAW)):
            if fn.startswith(role + "_"):
                cands.append((role, os.path.join(RAW, fn), "ElevenLabs", f"generated: {fn}"))
    lib = [l.strip()[2:] for l in open(os.path.join(L["LAB"], "library.txt"), encoding="utf-8") if l.strip()]
    for role, rx in LIB_RE.items():
        for rel in lib:
            name = rel.rsplit("/", 1)[-1]
            if rx.search(name):
                cands.append((role, os.path.join(L["LIB"], rel), "Adobe Audition Production Elements", name.rsplit(".", 1)[0]))
    return cands


def main():
    if "--no-generate" not in sys.argv:
        budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else 5000
        generate(budget)
    L["gather"] = lambda _gen: gather()
    sys.argv = [sys.argv[0], "--no-generate"]
    L["main"]()


main()
