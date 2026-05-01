# Motion Reference Integration v1 Report

Date: 2026-05-01

## What Was Built

Motion Acquisition Pro now consumes `test/output/official_trailer_references_v1.json` when present.

This means verified official trailer references from the resolver are reflected in the normal motion-readiness report instead of sitting in a separate diagnostic file.

Changed:

- `lib/motion-acquisition-pro.js`
- `tools/motion-acquisition-pro.js`
- `tests/services/motion-acquisition-pro.test.js`

## Command

```bash
npm run media:plan-motion
```

Useful forms:

```bash
npm run media:plan-motion -- --story-id rss_5b3abe925b27a199
npm run media:plan-motion -- --limit 5
npm run media:plan-motion -- --no-trailer-references
npm run media:plan-motion -- --trailer-references test/output/official_trailer_references_v1.json
```

## Local Proof Result

Story:

- `rss_5b3abe925b27a199`

Before reference integration:

- readiness: `official_reference_search_required`
- official references: 0

After reference integration:

- readiness: `reference_ready_for_local_frame_plan`
- official references: 15
- planned action: `trailer_frame_extract_plan`
- blockers remaining: `needs_three_trailer_frames`, `needs_three_clip_slices`

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

The integrated references are treated as planning metadata only.

## Validation

- `node --test tests/services/motion-acquisition-pro.test.js`: 7/7 pass
- `node --test tests/services/motion-acquisition-pro.test.js tests/services/official-trailer-reference-resolver.test.js`: 14/14 pass
- `npm run media:plan-motion -- --story-id rss_5b3abe925b27a199`: pass
- `npm test`: 1,601/1,601 pass
- `npm run build`: pass

## Next Recommended Step

Build a controlled local frame-extraction planning packet, still without downloading. It should choose which official references would be used first, define frame timestamps and quality rules, then refuse stories that do not have enough exact-subject motion coverage.
