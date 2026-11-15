"""Generates the second round of music-bed candidates (15 Nov 2026, owner: "Shouldn't we have way more than 4
beds?") with ElevenLabs Music (paid-plan commercial use) into data/sfxlab/library: more house beds for the
Shorts and long videos, more takes for the four long-video moods, and five new moods (mystery, hype, chill,
playful, synthwave). Every prompt keeps genbeds.py's brief for a bed under a narrator; only the character
changes. pickbeds.py and pickmoods.py then choose by measurement (pickmoods.py --library).

Spending is capped: before every take the account's counter is read, and the run stops once it has used
--budget credits since it started (others' use in that time counts too, so the cap errs low). It never
asks for more than the plan's limit: a take that would cross the cycle's limit is not made. What it spent
goes to data/sfxlab/library/spend.json. Existing files are kept, so a re-run only fills gaps.

Usage (from the factory dir): python src/tools/sfxlab/genlibrary.py --budget 500000 [--only house] [--takes N] [--jobs 1]
The API key comes from ELEVENLABS_API_KEY or the factory's .env; it is never printed.
"""
import concurrent.futures as cf
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

BRIEF = {
    "house": (
        "Instrumental background bed for a friendly gaming news show that sits under a narrator. "
        "No lead melody, no vocals, no build-ups, drops or breaks, consistent energy from start to finish, "
        "keep the midrange where a voice sits clear, the mix sits back."
    ),
    "mood": (
        "Instrumental background bed for a gaming video that sits under a narrator. "
        "No lead melody, no vocals, no build-ups, drops or breaks, consistent energy from start to finish, "
        "keep the midrange where a voice sits clear, the mix sits back."
    ),
}
# The house beds: what scored best on 21 Oct (warm modern electronic, glow, chill synthwave) in new colours,
# and new families kept to the same rules (steady, light low end, 96-112 BPM, D or E major).
HOUSE = [
    "Warm modern electronic, soft punchy kick, crisp shaker, warm round bass, airy pads, light marimba texture far back, 102 BPM, D major.",
    "Soft modern electronic groove, light rimshot and shaker, glassy pads, gentle bass, steady and even throughout, 104 BPM, D major.",
    "Bright minimal electronic, soft four-on-the-floor kick, ticking hi-hats, warm sustained chords low in the mix, 108 BPM, E major.",
    "Chill synthwave, soft retro pads, gentle arpeggiated texture low in the mix, steady drum machine, 102 BPM, D major.",
    "Light indie electronic, soft live-feel drums, muted guitar plucks as texture, warm bass, easy and upbeat, 100 BPM, E major.",
    "Clean future bass-free electronic bed, soft claps, filtered pads, gentle sidechain pulse, light and steady, 106 BPM, D major.",
    "Upbeat chillhop, crisp tight drums, warm bass, soft Rhodes chords far back as texture only, steady groove, 96 BPM, E major.",
    "Modern tech news bed, light electronic percussion, soft synth pulses, warm pads, quietly driving and even, 110 BPM, D major.",
    "Warm nu-disco lite, tight soft drums, muted bass groove, filtered chord stabs far in the background, 110 BPM, E major.",
    "Soft UK garage-inspired groove, light shuffled hats, warm sub kept low, airy pads, no breaks, 108 BPM, D major.",
    "Gentle electro-pop bed, soft kick and snap, bright pads held steady, warm bass, optimistic and even, 104 BPM, E major.",
    "Airy electronic bed, light glitchy percussion kept soft, warm plucks as texture, glassy pads, steady energy, 100 BPM, D major.",
    "Warm lo-fi house, dusty soft kick, gentle hats, mellow chords far back, round bass, steady throughout, 112 BPM, E major.",
    "Clean minimal tech groove, soft ticking percussion, light bass pulse, subtle pads, focused and calm, 106 BPM, E major.",
    "Bright acoustic-electronic hybrid, soft hand percussion and light kick, muted acoustic guitar texture, warm pads, 98 BPM, D major.",
    "Soft synth-pop bed, gated drum machine kept gentle, warm analogue pads, round bass, steady and friendly, 100 BPM, E major.",
    "Smooth electronic soul bed, soft tight drums, warm electric bass, gentle pad chords as texture, 96 BPM, D major.",
    "Light breakbeat-lite bed, soft steady breaks low in the mix, warm pads, gentle bass, even energy, 104 BPM, E major.",
    "Calm progressive electronic, soft steady kick, evolving but even pads, light plucks far back, 110 BPM, D major.",
    "Warm vaporwave-tinged bed, soft drum machine, washed pads, gentle chorus bass, steady and smooth, 98 BPM, E major.",
    "Modern cinematic electronic bed, light ticking percussion, warm synth bass, soft pads held steady, quietly driving, 102 BPM, E major.",
    "Soft funk-lite groove, tight gentle drums, muted bass, light clavinet texture far back, steady, 102 BPM, D major.",
    "Friendly upbeat electronic, soft claps and kick, warm bass, shimmering pads, consistent from start to finish, 106 BPM, E major.",
    "Easy-going downtempo groove, steady soft beat, warm bass, airy pads, light vinyl texture, 96 BPM, D major.",
    "Glossy electronic bed, crisp soft percussion, warm round bass, bright pads far back, even and modern, 108 BPM, D major.",
    "Gentle trap-free hip hop bed, soft boom-bap drums, warm bass, mellow pad texture, steady groove, 94 BPM, E major.",
    "Warm house-lite groove, soft kick, gentle claps, warm bass line, muted organ chords far back, 112 BPM, D major.",
    "Chill electronic bed with soft steel-drum texture far back, light percussion, warm bass, sunny and even, 100 BPM, E major.",
    "Light retro-modern synth bed, soft drum machine, warm pads, gentle arpeggio far back, steady, 104 BPM, E major.",
    "Soft cinematic pop bed, light steady drums, warm bass, soft string pad held steady, hopeful and even, 100 BPM, D major.",
    "Clean electronic groove, light shaker and kick, glassy plucks low in the mix, warm pads, 102 BPM, E major.",
    "Mellow nu-jazz electronic bed, soft brushed electronic drums, warm upright-style bass, pad chords far back, 98 BPM, D major.",
]
MOODS = {
    # A story with something hidden: a leak, an unexplained file, a secret level, a datamine.
    "mystery": [
        "Mysterious investigation bed, soft ticking percussion, low airy pads, gentle muted plucks, curious not scary, light low end, 96 BPM, D major with minor colour.",
        "Curious detective-style electronic bed, soft steady pulse, muted bass, glassy pads, intriguing and calm, 100 BPM, E major with minor colour.",
        "Quiet puzzle-solving bed, light clockwork percussion, soft synth plucks far back, airy dark pads, little sub bass, 98 BPM, D major with minor colour.",
        "Investigative documentary pulse, soft steady electronic beat, low warm drone, muted bell texture far back, intriguing, 92 BPM, E major with minor colour.",
        "Mysterious lo-fi bed, soft dusty drums, muted bass, hazy pads, curious late-night mood, steady, 94 BPM, D major with minor colour.",
        "Subtle sci-fi mystery bed, soft ticking hats, gentle analogue pulses, wide airy pads, light low end, 100 BPM, E major with minor colour.",
        "Calm intrigue bed, steady soft percussion, pizzicato texture far back, warm low pads, curious and even, 96 BPM, D major with minor colour.",
    ],
    # Breaking news: a reveal, a date, a showcase.
    "hype": [
        "Energetic news bed, driving soft kick, tight claps, pulsing synth bass kept light, bright pads, exciting but even, 118 BPM, E major.",
        "Upbeat breaking-news electronic bed, punchy soft drums, ticking hats, warm pulsing bass, bright and urgent but steady, 116 BPM, D major.",
        "High-energy gaming news groove, tight electronic drums, light sidechained pads, warm bass, consistent energy, 114 BPM, E major.",
        "Driving modern electronic bed, steady four-on-the-floor, crisp hats, bright stabs far back, energetic and even, 118 BPM, D major.",
        "Confident hype bed, punchy soft drums, rolling light bass, bright synth texture low in the mix, no drops, 112 BPM, E major.",
        "Exciting reveal-show bed, steady electronic percussion, pulsing bass kept light, shimmering pads, 116 BPM, E major.",
        "Fast-paced electronic news groove, tight drums, warm bass pulse, bright pads, energetic, never frantic, 114 BPM, D major.",
    ],
    # An explainer: how a system works, a guide, the numbers.
    "chill": [
        "Chill explainer bed, soft steady lo-fi drums, warm bass, mellow pads, relaxed and clear, 92 BPM, D major.",
        "Calm modern electronic bed, light soft percussion, gentle bass, airy pads, easy to think to, 96 BPM, E major.",
        "Relaxed downtempo bed, soft brushed beat, warm round bass, gentle chord pad far back, 90 BPM, D major.",
        "Light chillhop bed, crisp soft drums, warm bass, mellow keys as texture only, focused and calm, 94 BPM, E major.",
        "Soft ambient groove, gentle steady beat, warm bass, glassy pads, unhurried, 92 BPM, E major.",
        "Easy study-beat bed, dusty soft drums, warm bass, soft pads, steady from start to finish, 90 BPM, D major.",
        "Calm electronic explainer bed, soft shaker and kick, gentle plucks far back, warm pads, 98 BPM, D major.",
    ],
    # Memes and funny clips: light, bouncy, a wink.
    "playful": [
        "Playful bouncy bed, soft pizzicato texture far back, light hand claps, bouncy bass, cheeky and light, 108 BPM, D major.",
        "Quirky light electronic bed, soft marimba texture far back, bouncy plucked bass, gentle claps, fun and even, 104 BPM, E major.",
        "Funny cartoonish groove, light tuba-style bass kept soft, soft snappy drums, playful but not silly, 106 BPM, D major.",
        "Cheeky lo-fi bed, bouncy soft drums, playful bass, light toy-piano texture far back, steady, 100 BPM, E major.",
        "Light comedic swing bed, soft brushed drums, walking bass, muted horns far back as texture, 110 BPM, D major.",
        "Bouncy chiptune-lite bed, soft square-wave texture far back, light drums, round bass, playful and even, 108 BPM, E major.",
        "Goofy upbeat bed, soft ukulele texture far back, light claps and shaker, bouncy bass, sunny, 104 BPM, D major.",
    ],
    # Vice City and the 80s: GTA VI, neon nights, Miami.
    "synthwave": [
        "Neon 80s synthwave bed, warm analogue pads, gated drum machine kept soft, pulsing chorus bass, sunset Miami night drive, 100 BPM, E major.",
        "Retro outrun bed, steady drum machine, rolling analogue bass kept light, lush pads, palm trees and neon, even, 104 BPM, D major.",
        "Smooth 80s night-drive synth bed, soft gated snare, warm arpeggio far back, chorus bass, cool and steady, 98 BPM, E major.",
        "Miami vice-era electronic bed, soft electronic toms and claps, warm synth bass, glossy pads, sunny and cool, 106 BPM, D major.",
        "Dreamy synthwave bed, soft steady drums, warm pads, gentle pulsing bass, nostalgic neon glow, 96 BPM, E major.",
        "Retro synth-funk bed, soft drum machine, bouncy analogue bass kept light, bright pads far back, 80s cool, 108 BPM, D major.",
        "Dark-but-warm synthwave bed, steady soft drum machine, low pulsing bass, lush pads, night city, 102 BPM, E major.",
    ],
    # The long-video moods, more takes each so a run of chapters alternates (genmoods.py's prompts, new colours).
    "tense": [
        "Suspenseful documentary bed, light low end, steady soft ticking hi-hats and muted plucks, gentle low string pulse, serious but light, 98 BPM, E major with minor colour.",
        "Restrained tension bed, steady soft electronic percussion, muted synth pulses, airy dark pads, little sub bass, 102 BPM, D major with minor colour.",
        "Serious investigative bed, soft steady pulse, muted strings far back, ticking percussion, light low end, 94 BPM, D major with minor colour.",
        "Quiet pressure bed, soft steady kick, low analogue pulses kept light, dark airy pads, even throughout, 96 BPM, E major with minor colour.",
    ],
    "retro": [
        "Warm nostalgic late-80s synth bed, analogue pads, soft gated drum machine, gentle chorus bass, VHS-era warmth, 98 BPM, E major.",
        "Mellow 16-bit console-era bed, soft FM synth textures, light drums low in the mix, warm and nostalgic, steady, 100 BPM, D major.",
        "Warm 90s arcade-era electronic bed, soft breakbeat low in the mix, warm pads, round bass, nostalgic, 96 BPM, E major.",
        "Cosy retro computer-era bed, soft drum machine, warm square-wave pads far back, gentle bass, steady, 98 BPM, D major.",
    ],
    "triumph": [
        "Uplifting modern cinematic bed, warm steady pulse, soft strings and synth pads held steady, hopeful and proud, no build, 104 BPM, E major.",
        "Bright confident electronic bed, soft four-on-the-floor, shimmering pads, warm bass, optimistic, even throughout, 106 BPM, D major.",
        "Warm victorious bed, steady soft drums, warm bass, bright pads held steady, proud and calm, 100 BPM, E major.",
        "Hopeful driving bed, soft steady percussion, warm pulsing bass kept light, glowing pads, 108 BPM, D major.",
    ],
    "reflective": [
        "Gentle reflective electronic bed, soft steady beat that never stops, warm pads, light felt-piano texture far back, wistful, 92 BPM, E major.",
        "Warm thoughtful downtempo bed, steady brushed beat throughout, soft bass, mellow pads, nostalgic and calm, 90 BPM, D major.",
        "Calm wistful bed, soft steady lo-fi beat, warm pads, gentle bass, even from start to finish, 88 BPM, E major.",
        "Quiet legacy bed, soft steady pulse, warm low strings far back, airy pads, thoughtful, never breaks, 90 BPM, D major.",
    ],
}
SECONDS = 150
WORK = os.path.join("data", "sfxlab", "library")


def key():
    if os.environ.get("ELEVENLABS_API_KEY"):
        return os.environ["ELEVENLABS_API_KEY"].strip()
    for line in open(".env", encoding="utf-8"):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("no ELEVENLABS_API_KEY")


def account():
    req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": key()})
    with urllib.request.urlopen(req, timeout=30) as r:
        a = json.load(r)
    return a["character_count"], a["character_limit"]


def jobs(only, takes):
    out = []
    if only in (None, "house"):
        out += [("house", i, t) for i, t in enumerate(HOUSE[:takes])]
    for mood, prompts in MOODS.items():
        if only in (None, mood):
            out += [(mood, i, t) for i, t in enumerate(prompts[:takes])]
    return out


def main():
    budget = int(sys.argv[sys.argv.index("--budget") + 1])
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    takes = int(sys.argv[sys.argv.index("--takes") + 1]) if "--takes" in sys.argv else 99
    workers = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 1
    os.makedirs(WORK, exist_ok=True)
    start, limit = account()
    # Never more than the cycle has left, whatever --budget says.
    budget = min(budget, limit - start)
    print(f"credits used before: {start} of {limit}; this run may use {budget}", flush=True)
    lock = threading.Lock()
    per = {"cost": None}
    made = []

    def make(group, i, text):
        dest = os.path.join(WORK, f"{group}_{i}.mp3")
        if os.path.exists(dest):
            return dest, "kept"
        with lock:
            used, _ = account()
            # Leave room for the takes already in flight (each costs about `per`).
            if used - start + (per["cost"] or 0) * workers > budget:
                return dest, "skipped (budget)"
        brief = BRIEF["house" if group == "house" else "mood"]
        body = json.dumps({"prompt": f"{brief} {text}", "music_length_ms": SECONDS * 1000}).encode()
        req = urllib.request.Request("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", data=body, method="POST",
                                     headers={"xi-api-key": key(), "content-type": "application/json"})
        # The plan allows only so many music takes at once (the factory may be using some): wait and retry.
        for attempt in range(8):
            try:
                with urllib.request.urlopen(req, timeout=600) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == 7:
                    raise
                time.sleep(30 * (attempt + 1))
        with open(dest, "wb") as f:
            f.write(data)
        made.append(dict(file=os.path.basename(dest), group=group, prompt=text, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))
        return dest, "generated"

    todo = jobs(only, takes)
    # One take first, alone, to learn what a take costs.
    spend_path = os.path.join(WORK, "spend.json")
    past = [r["spent"] / r["takes"] for r in (json.load(open(spend_path, encoding="utf-8")) if os.path.exists(spend_path) else []) if r["takes"]]
    per["cost"] = round(max(past)) if past else None
    first = None if per["cost"] else next((j for j in todo if not os.path.exists(os.path.join(WORK, f"{j[0]}_{j[1]}.mp3"))), None)
    if first:
        print(*make(*first), flush=True)
        # The counter lags a little: wait up to a minute for it to move.
        for _ in range(12):
            time.sleep(5)
            if account()[0] > start:
                break
        per["cost"] = max(1, account()[0] - start)
        print("one take cost about", per["cost"], "credits", flush=True)
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(make, *j): j for j in todo if j is not first}
        for f in cf.as_completed(futs):
            try:
                print(*f.result(), flush=True)
            except Exception as e:
                print("failed", futs[f][:2], e, flush=True)
    time.sleep(10)
    end, limit = account()
    log = json.load(open(spend_path, encoding="utf-8")) if os.path.exists(spend_path) else []
    log.append(dict(at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), before=start, after=end, limit=limit,
                    spent=end - start, takes=len(made), per_take=per["cost"], files=made))
    json.dump(log, open(spend_path, "w", encoding="utf-8"), indent=1)
    print(f"credits used after: {end} of {limit} (spent {end - start}, {len(made)} takes; the counter can lag)", flush=True)


main()
