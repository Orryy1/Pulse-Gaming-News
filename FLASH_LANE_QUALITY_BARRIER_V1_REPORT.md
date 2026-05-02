# Flash Lane Quality Barrier v1

## Purpose

This pass turns the failed `studio_v2_rss_5b3abe925b27a199_enriched.mp4` proof into a hard lesson for the pipeline.

The render looked weak because Studio V2 accepted media that was only broadly "official", not proven usable at the exact segment used in the video. That allowed rating boards, title cards, low-detail frames, boring cover art, dense captions and unapproved local voice paths to pass too far down the proof-render path.

## What changed

- Controlled trailer frame sampling now avoids the start of trailers and uses later non-intro probe points.
- Official trailer clip references now start later and are marked as unvalidated by default.
- Flash Lane preflight blocks unvalidated official clip segments before FFmpeg render.
- Flash Lane preflight blocks low-quality clip anchors instead of treating them as a warning.
- Quality Gate v2 now treats a red Flash Lane preflight as a hard local proof failure.
- Flash captions can be capped to two-word punch phrases for more TikTok-native rhythm.
- The still-deck proof command now reports all voice and visual blockers together instead of failing on the first issue.

## Current proof result

Command:

```text
npm run studio:v2:still-deck -- --story rss_5b3abe925b27a199 --use-official-trailer-clips --audio test/output/flash-lane-voice-workbench-pitch210/flash-lane-voice-workbench-assets/fixture_flash_lane_story_voxcpm2_1_9.mp3 --timestamps test/output/flash-lane-voice-workbench-pitch210/flash-lane-voice-workbench-assets/fixture_flash_lane_story_voxcpm2_1_9_timestamps.json
```

Result:

- No MP4 rendered.
- Studio V2 suitability: `blocked_by_flash_lane_preflight`.
- Runtime plan: 66.857s.
- Spoken pace: 141.8 WPM.
- Clip dominance: 0.43.
- Card ratio: 0.36.

Blockers:

- `unapproved_local_tts_voice_path`
- `flash_lane_clip_dominance_below_target`
- `flash_visual_requires_three_unique_clip_refs_for_60s`
- `flash_visual_unvalidated_official_clip_segment`

Warnings:

- `flash_lane_card_ratio_high`
- `flash_visual_card_ratio_high`

## Why this matters

The pipeline now refuses to create another misleading "passed QA" Studio V2 proof from unvalidated trailer footage. That is the correct move. A bad render should fail before spending time on FFmpeg and before anyone mistakes it for a pilot candidate.

## Safety boundaries

- Local-only.
- No Railway changes.
- No OAuth changes.
- No production DB mutation.
- No social posting.
- No production renderer switch.
- No hard production gate enabled.
- No trailer/video downloads enabled by default.

## Validation

- Targeted Studio V2/frame tests: passed.
- `npm test`: passed, 1,728/1,728.
- `npm run build`: passed.

## Next required build

Build `Official Trailer Segment Validator v1`.

It should sample inside each proposed clip segment, reject rating boards/title cards/black frames/blurry dead frames and only then mark a clip reference as:

```json
{
  "segment_validated": true,
  "allowed_for_flash_lane": true
}
```

Until that exists, official trailer clip references should remain report-only support, not trusted Flash Lane backbone.
