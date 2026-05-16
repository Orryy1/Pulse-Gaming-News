# Flash Lane Current State

Read-only control report. No Railway, OAuth, production DB, render default, TTS or social posting changes.

## Summary

- Candidates considered: 1
- Ready for local Flash proof: 1
- Need local Liam audio: 0
- Need Liam audio duration repair: 0
- Need format router decision: 0
- Need exact subject assets: 0
- Need visual evidence repair: 0
- Need motion validation: 0
- Need alternate official motion source: 0

## Input Freshness

- Motion gap report: 2026-05-16T10:41:00.236Z
- Alternate source report: 2026-05-16T10:45:30.650Z
- Reference counts: current

## Current Queue

| Story | Stage | Distance | Audio | Exact | Visual gate | Clips | Clip gap | Missing motion entities | Next action |
| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | ready_for_local_flash_proof | ready | ready 71.5s | 24 | pass | 13/3 | unknown | none | render_local_flash_proof |

## Next Commands

### 1t0zhng
- Render local proof: `npm run studio:v2:still-deck -- --story 1t0zhng --audio "test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3" --timestamps "test/output/local-script-extension/audio/1t0zhng_liam_extended_timestamps.json" --frame-report "test/output/controlled_frame_extraction_worker_apply_local.json" --segment-validation-report "test/output/official_trailer_segment_validation_apply_local.json" --use-official-trailer-clips --with-sound-design`

## Safety

- Report-only and local-only.
- Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth.
- Use this report to decide the next local acquisition/validation step before any new Studio V2 proof render.
