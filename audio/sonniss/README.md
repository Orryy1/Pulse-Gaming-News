# Sonniss GameAudioGDC bundle drop-zone

This directory is auto-scanned by `lib/studio/v2/audio-library.js`. Drop an
unzipped Sonniss GameAudioGDC bundle (any year, 2017+) into this folder and the
audio library indexes the files automatically next time the orchestrator runs.

## How to use

1. Download from <https://sonniss.com/gameaudiogdc>. The bundles are huge
   (25-50 GB unzipped) and free for any commercial use under the Sonniss
   Royalty-Free License.
2. Unzip into this directory. The full publisher tree is fine —
   `audio/sonniss/Boom Library — Cinematic Trailer Tools/...wav` works.
   Alternative for large bundles: leave the unzipped bundle wherever you
   downloaded it and create a Windows junction inside this directory
   (e.g. `mklink /J GDC2024 "C:\Users\you\Downloads\Sonniss... GDC 2024..."`).
   The indexer follows symlinks/junctions, so 25-50 GB stays out of the
   working drive.
3. Next time you run the orchestrator (or `node -e "require('./lib/studio/v2/audio-library').listAllSfx()"`),
   the library will print a one-line index summary:

   `[audio-library] Sonniss indexed 24812 files: transition=50,impact=50,reveal=50,glitch=50,tick=50,boom=50`

   Each category is capped at 50 files to keep the no-repeat picker pool
   sensible.

## Why this is here

The committed `resolveAudioPlan` is forensic-safe — it returns 0 SFX cues so
the existing minimal-mode opener sting path keeps the rubric clean. The
bespoke SFX library (`audio/sfx/{transition,impact,reveal,glitch,tick,boom}/`)
and any Sonniss content here are indexed for FUTURE use by:

- operator-side cue tooling
- manual sound-design probes
- an opt-in expressive cue planner (env-gated)

## Categorisation rules

Files are matched to categories by case-insensitive keywords found anywhere in
the path (folder + filename). Patterns:

| Category   | Keywords                                                  |
| ---------- | --------------------------------------------------------- |
| transition | whoosh, swipe, swoosh, transition, pass-by, passby, sweep |
| impact     | impact, hit, punch, thump, slam, thud, smash              |
| reveal     | riser, swell, drone, ambient pad, build-up, buildup       |
| glitch     | glitch, stutter, static, digital, bitcrush, broken        |
| tick       | tick, blip, click, beep, ui, interface                    |
| boom       | boom, sub, bass-drop, explosion, cinematic                |

A file matches the FIRST category whose keyword fires (no double-tagging).
Files that don't match any category are ignored.

## .gitignore

Sonniss content is never committed to the repo. The `.gitignore` already
ignores everything under this directory except this README, so you can drop a
30 GB bundle in here without polluting the working tree.
