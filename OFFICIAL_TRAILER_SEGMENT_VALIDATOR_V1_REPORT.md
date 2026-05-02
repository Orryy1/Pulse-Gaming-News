# Official Trailer Segment Validator v1

## Purpose

This build closes the gap that created bad Studio V2 proof frames: the system was checking extracted still frames, then assuming the nearby trailer clip window would also be good. That assumption was wrong. Trailer intros, rating cards, black frames, title cards and low-detail dead shots can appear seconds away from an otherwise acceptable frame.

## What was built

- New local-only module: `lib/studio/v2/official-trailer-segment-validator.js`.
- New command: `npm run media:validate-trailer-segments`.
- New ops alias: `npm run ops:validate-trailer-segments`.
- Segment validation integration for Studio V2 still-deck proofs.
- Tests for dry-run safety, apply-local output limits, rating-card rejection, black-frame rejection, low-detail rejection, repetitive-frame rejection and Flash Lane ref promotion.

## How it works

For every proposed official trailer clip reference, the validator samples three frames inside the exact segment window:

- near the start;
- middle;
- near the end.

It only marks the segment as Flash Lane eligible when the sampled frames are clean enough. Rejected segments remain blocked and are excluded from the render package when a validation report is supplied.

## Local proof result

Command:

```text
npm run media:validate-trailer-segments -- --story rss_5b3abe925b27a199 --apply-local
```

Output:

- JSON: `test/output/official_trailer_segment_validation_v1.json`
- Markdown: `test/output/official_trailer_segment_validation_v1.md`
- Sample frames: `test/output/official-trailer-segment-validation-v1/assets`

Result:

- segments checked: 2
- segments validated: 1
- segments rejected: 1
- BioShock segment: allowed
- GTA segment: blocked, `segment_contains_black_frame`

## Studio V2 impact

After applying the segment validation report, the GTA/Take-Two proof still does not render. That is correct.

Current blockers:

- `unapproved_local_tts_voice_path`
- `flash_lane_requires_two_actual_clip_scenes`
- `flash_lane_clip_dominance_below_target`
- `flash_visual_requires_three_unique_clip_refs_for_60s`

This is a better failure than before: bad GTA/Red Dead trailer material is no longer carried into the render package as usable footage.

## Safety boundaries

- Dry-run by default.
- Apply-local writes only under `test/output`.
- No retained trailer/video downloads.
- No yt-dlp.
- No browser scraping.
- No Railway changes.
- No OAuth changes.
- No production DB mutation.
- No social posting.
- No production renderer/default switch.

## Validation

- Targeted segment/clip/Flash tests: passed.
- Full `npm test`: passed, 1,728/1,728.
- `npm run build`: passed.

## Next build

The next creative blocker is not another proof render. It is `Flash Lane Footage Backbone v1`:

- acquire or identify at least three validated clip windows per premium story;
- require clip dominance above the Flash target;
- route stories with only one validated clip back to standard/card-led Shorts;
- then add creator-native overlays and pop cards on top of real footage.
