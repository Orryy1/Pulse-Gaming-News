"""Generates candidate music beds with ElevenLabs Music (paid-plan commercial use) into data/sfxlab/beds.

Every prompt shares the brief for a bed under a narrator; the styles vary so the scoring has a real
choice. Existing files are kept, so a re-run only fills gaps.

Usage (from the factory dir): python src/tools/sfxlab/genbeds.py
"""
import concurrent.futures as cf
import json
import os
import urllib.request

BRIEF = (
    "Instrumental background bed for a friendly gaming news show that sits under a narrator. "
    "No lead melody, no vocals, no build-ups, drops or breaks, consistent energy from start to finish, "
    "keep the midrange where a voice sits clear, the mix sits back."
)
STYLES = [
    ("warm", "Warm modern electronic, soft punchy kick, gentle hi-hats, warm bass, airy pads, light plucked texture, 100 BPM, D major."),
    ("synth", "Chill synthwave, soft retro pads, gentle arpeggiated texture low in the mix, steady drum machine, 96 BPM, E major."),
    ("lofi", "Upbeat lo-fi hip hop, dusty drums, mellow electric piano chords used only as texture, round bass, 90 BPM, D major."),
    ("garage", "Light future garage, airy shuffled drums, deep sub bass, washed-out pads, 110 BPM, E major."),
    ("house", "Minimal deep house groove, muted kick, soft claps, warm chord stabs far in the background, 112 BPM, D major."),
    ("pulse", "Modern cinematic pulse, ticking percussion, warm low strings and synth bass, quietly driving, 100 BPM, E major."),
    ("funk", "Smooth nu-disco groove, tight drums, warm slap-free bass line, filtered guitar chops as texture, 108 BPM, D major."),
    ("ambient", "Bright ambient electronica, soft broken beat, shimmering pads, gentle bass, 92 BPM, E major."),
    # Second round: more of the styles that scored best, in E major.
    ("warm3", "Warm modern electronic, soft punchy kick, gentle hi-hats, warm bass, airy pads, light plucked texture, 104 BPM, E major."),
    ("synth2", "Chill synthwave, soft retro pads, gentle arpeggiated texture low in the mix, steady drum machine, 98 BPM, E major."),
    ("glow", "Soft modern electronic groove, light shaker and rimshot, warm bass, glassy pads, steady and even throughout, 100 BPM, E major."),
]
SECONDS = 150


def key():
    for line in open(".env", encoding="utf-8"):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')


def make(style):
    name, text = style
    dest = os.path.join("data", "sfxlab", "beds", f"el_{name}.mp3")
    if os.path.exists(dest):
        return dest, "kept"
    body = json.dumps({"prompt": f"{BRIEF} {text}", "music_length_ms": SECONDS * 1000}).encode()
    req = urllib.request.Request("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", data=body, method="POST",
                                 headers={"xi-api-key": key(), "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        open(dest, "wb").write(r.read())
    return dest, "generated"


os.makedirs(os.path.join("data", "sfxlab", "beds"), exist_ok=True)
with cf.ThreadPoolExecutor(1) as ex:
    for f in cf.as_completed([ex.submit(make, s) for s in STYLES]):
        try:
            print(*f.result(), flush=True)
        except Exception as e:
            print("failed", e, flush=True)
