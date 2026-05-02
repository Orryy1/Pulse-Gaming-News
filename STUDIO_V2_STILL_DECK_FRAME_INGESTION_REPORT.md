# Studio V2 Still-Deck + Official Frame Ingestion Report

Generated: 2026-05-01

## What Changed

Studio V2 still-deck ingestion now accepts a local frame-extraction report, maps accepted official trailer frames into the Studio V2 media package and can optionally use official Steam trailer references as local-only FFmpeg clip inputs.

The current proof also requires explicit narration input. Silent fixture renders are treated as visual diagnostics only and unapproved local TTS is now rejected by the quality gate for pilot approval.

## Local Proof

Story:

`rss_5b3abe925b27a199`

Title:

`GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One`

Command:

```powershell
node tools\studio-v2-still-deck-ingestion.js --story rss_5b3abe925b27a199 --frame-report test\output\controlled_frame_extraction_worker_apply_local.json --with-sound-design --generate-local-tts --use-official-trailer-clips
```

Outputs:

- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_baseline.mp4`
- `test/output/studio-v2-still-deck/studio_v2_rss_5b3abe925b27a199_enriched.mp4`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_baseline_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/rss_5b3abe925b27a199_enriched_contact_sheet.jpg`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.json`
- `test/output/studio-v2-still-deck/studio_v2_still_deck_report.md`
- `test/output/studio-v2-still-deck/forensic_comparison.json`

## Proof Result

The enriched Studio V2 package used:

- accepted stills: 10
- accepted official trailer frames: 3
- official trailer references: 2
- rejected official trailer frames: 3
- distinct entities: 3
- unique scene sources: 14
- runtime: 66.126s
- voice: local VoxCPM, present, red/unapproved
- QA lane: reject
- forensic verdict: warn
- visual repeat pairs: 0
- subtitle verdict: pass
- in-image entity popups: GTA, Red Dead, BioShock

Latest comparison:

| metric | baseline | enriched |
| --- | ---: | ---: |
| Forensic verdict | fail | warn |
| Fails | 1 | 0 |
| Runtime | 40.00s | 66.126s |
| Accepted trailer frames | 0 | 3 |
| Source diversity score | 84 | 100 |
| Unique scene sources | 4 | 14 |
| Visual repeat pairs | 29 | 0 |

## Review Fixes

- Added real local narration to the proof path.
- Quality gate rejects silent fixture audio for pilot-readiness.
- RSS source cards no longer label publishers as subreddits.
- RSS article excerpts no longer render as fake Reddit comments.
- Non-release publisher stories no longer get irrelevant `NO DATE YET` cards.
- Hook QA now uses the complete hook when the first sentence is too short.
- Kinetic subtitles now cap at three words per phrase.
- Visual scenes now carry exact entity labels into compact in-image popups.
- The opener hook overlay is now a smaller timed plate instead of the old full-width black slab.
- The generated report no longer claims the proof is silent or still-image-only.
- Official trailer clips now seek from selected frame timestamps instead of starting at the beginning of the trailer.
- Trailer title/rating-card frames are rejected.
- Low-detail official trailer frames are rejected.
- Unapproved local Studio V2 voices are now QA blockers.

## Remaining Blockers

- The proof is local-only and currently blocked by QA.
- FFmpeg emitted packet/NAL warnings while reading remote Steam HLS references; this must be hardened before production.
- The local VoxCPM voice path is red until it is consistently approved against the ElevenLabs production voice.
- Clip dominance is too low for the high-energy Shorts lane.
- Cards still need stronger HyperFrames-style polish before a live pilot.

## Safety

No Railway variables were changed.

No OAuth flow was triggered.

No production DB rows were mutated.

No publish or produce job was manually triggered.

No social platform was posted to.

No production render default was changed.

The proof used local output paths under `test/output`.

## Recommendation

Keep this local-only. Do not pilot this render. The next engineering step should be a high-energy Shorts creator-edit lane with approved voice, stronger trailer segment selection, gameplay-first motion, sharper subtitles and HyperFrames-style card polish before any live pilot is considered.
