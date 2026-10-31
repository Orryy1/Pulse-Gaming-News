"""Generates candidate mood beds for long videos with ElevenLabs Music (paid-plan commercial use) into
data/sfxlab/moods: a chapter's music follows its mood or era (owner, 28 Oct 2026: music scored to the edit,
era sound) instead of rotating one family of beds.

Every prompt keeps genbeds.py's brief for a bed under a narrator; only the character changes. Existing
files are kept, so a re-run only fills gaps. --only MOOD and --takes N limit a run; the account's credit
use is printed before and after.

Usage (from the factory dir): python src/tools/sfxlab/genmoods.py [--only tense] [--takes 1]
"""
import json
import os
import sys
import urllib.request

BRIEF = (
    "Instrumental background bed for a gaming documentary that sits under a narrator. "
    "No lead melody, no vocals, no build-ups, drops or breaks, consistent energy from start to finish, "
    "keep the midrange where a voice sits clear, the mix sits back."
)
MOODS = {
    # A chapter about trouble: delays, crunch, a studio in crisis, a mystery.
    "tense": [
        "Dark investigative documentary underscore, low pulsing synth bass, soft ticking percussion, distant muted strings, restrained and suspenseful, 92 BPM, D minor feel resolving to D major colour.",
        "Quiet tension bed, slow heartbeat-like kick, low drones, soft analogue synth pulses, subtle and serious, 88 BPM, E major with minor colour.",
        # Second round: the first takes were bass-heavy (lost on phone speakers).
        "Suspenseful documentary bed, light low end, steady soft ticking hi-hats and muted plucks, gentle low string pulse, serious but light, 96 BPM, D major with minor colour.",
        "Investigative tension bed, steady soft electronic percussion, muted synth plucks, airy dark pads, little sub bass, even and restrained, 100 BPM, E major with minor colour.",
    ],
    # Older games: the era heard, 80s and 90s synths and drum machines, warm and nostalgic.
    "retro": [
        "Warm nostalgic late-80s synth bed, analogue pads, soft gated drum machine, gentle chorus bass, VHS-era warmth, 96 BPM, D major.",
        "Mellow 90s console-era electronic bed, soft FM synth textures, light breakbeat drums low in the mix, warm and nostalgic, 98 BPM, E major.",
        "Warm retro synthwave bed, soft analogue pads, gentle steady drum machine, round chorus bass, nostalgic arcade warmth, 100 BPM, E major.",
    ],
    # The payoff: a launch, a record, a comeback.
    "triumph": [
        "Uplifting modern cinematic bed, warm driving pulse, soft rising strings and synth pads held steady, hopeful and proud, 104 BPM, D major.",
        "Bright confident electronic bed, steady four-on-the-floor kick kept soft, shimmering pads, warm bass, optimistic, 108 BPM, E major.",
    ],
    # The ending: legacy, what it meant, a quiet close.
    "reflective": [
        "Soft reflective ambient bed, warm felt-piano texture far in the background, slow pads, gentle brushed percussion, thoughtful, 80 BPM, D major.",
        "Calm late-night electronic bed, soft sub bass, airy pads, sparse gentle beat, wistful and warm, 84 BPM, E major.",
        # Second round: the first takes broke down and drifted; a gentle beat that never stops.
        "Gentle reflective electronic bed, soft steady beat that never stops, warm pads, light felt-piano texture far back, wistful, 92 BPM, D major.",
        "Warm thoughtful downtempo bed, steady brushed beat throughout, soft bass, mellow pads, nostalgic and calm, even from start to finish, 90 BPM, E major.",
    ],
}
SECONDS = 150


def key():
    for line in open(".env", encoding="utf-8"):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')


def used():
    req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": key()})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["character_count"]


def make(mood, i, text):
    dest = os.path.join("data", "sfxlab", "moods", f"{mood}_{i}.mp3")
    if os.path.exists(dest):
        return dest, "kept"
    body = json.dumps({"prompt": f"{BRIEF} {text}", "music_length_ms": SECONDS * 1000}).encode()
    req = urllib.request.Request("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", data=body, method="POST",
                                 headers={"xi-api-key": key(), "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        open(dest, "wb").write(r.read())
    return dest, "generated"


os.makedirs(os.path.join("data", "sfxlab", "moods"), exist_ok=True)
only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
takes = int(sys.argv[sys.argv.index("--takes") + 1]) if "--takes" in sys.argv else 99
start = used()
print("credits used before:", start, flush=True)
for mood, prompts in MOODS.items():
    if only and mood != only:
        continue
    for i, text in enumerate(prompts[:takes]):
        try:
            print(*make(mood, i, text), flush=True)
        except Exception as e:
            print("failed", mood, i, e, flush=True)
print("credits used after:", used(), "(the counter can lag a few minutes)", flush=True)
