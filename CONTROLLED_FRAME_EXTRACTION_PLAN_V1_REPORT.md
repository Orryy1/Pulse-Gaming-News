# Controlled Frame Extraction Plan v1 Report

Date: 2026-05-01

## What Was Built

Controlled Frame Extraction Plan v1 creates a no-download frame-planning packet from Motion Acquisition Pro output.

It adds:

- `lib/controlled-frame-extraction-plan.js`
- `tools/controlled-frame-extraction-plan.js`
- `tests/services/controlled-frame-extraction-plan.test.js`
- `npm run media:plan-frames`
- `npm run ops:frame-plan`

The command reads the latest motion report or builds a fresh local motion plan, then selects which official trailer references would be used for future frame extraction.

## Command

```bash
npm run media:plan-frames
```

Useful forms:

```bash
npm run media:plan-frames -- --story-id rss_5b3abe925b27a199
npm run media:plan-frames -- --motion-report test/output/motion_acquisition_v1.json
npm run media:plan-frames -- --fixture
```

Outputs:

- `test/output/controlled_frame_extraction_v1.json`
- `test/output/controlled_frame_extraction_v1.md`

## Local Proof Result

Story:

- `rss_5b3abe925b27a199`

Result:

- frame-plan readiness: `frame_plan_ready`
- selected official references: 3
- unique entities: GTA, Red Dead, BioShock
- target frames: 6
- blockers: clear
- downloads: 0
- frames extracted: 0

## Safety Position

Still report-only.

It does not:

- download videos
- extract frames
- slice clips
- use `yt-dlp`
- use browser scraping
- mutate the DB
- post anything
- change Railway
- change OAuth
- change render defaults
- enable hard gates

## Why This Matters

The project now has the full pre-download motion planning chain:

```text
verified still deck
→ official trailer references
→ motion acquisition readiness
→ controlled frame extraction plan
```

This gives Pulse a concrete way to say “this story is ready for local trailer-frame extraction” before touching any video media.

## Validation

- `node --test tests/services/controlled-frame-extraction-plan.test.js`: 5/5 pass
- Targeted frame/motion/reference suite: 19/19 pass
- `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,606/1,606 pass
- `npm run build`: pass

## Next Recommended Step

The next step is either:

- keep the system report-only and connect these readiness packets into Creator Studio OS, or
- build a controlled local extraction worker behind `--apply-local` that downloads only approved official references into `test/output`, extracts planned frames and still never touches production.

The safer next move is Creator Studio OS integration first, because it improves the control room without adding media-download behaviour.
