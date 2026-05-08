# Studio V2 Overnight Promotion Packet

Generated: 2026-05-08T02:08:44.304Z
Story: `rss_5b3abe925b27a199`
Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One

## Verdict

`RED_BLOCKED` - Do not pilot Studio V2 yet; fix blockers and regenerate the local proof packet.

Production ready: `no`
Morning approval needed: `no`

## Blockers

- qa_lane_unknown
- flash_lane_preflight_not_allowed
- preflight_flash_lane_requires_two_actual_clip_scenes
- preflight_flash_lane_clip_dominance_below_target
- preflight_flash_visual_requires_three_unique_clip_refs_for_60s
- preflight_flash_visual_not_enough_distinct_scene_beats
- forensic_warnings_remaining
- visual_repeat_pairs_remaining
- not_a_60s_local_proof_candidate
- voice_grade_unknown

## Warnings

- thin_official_clip_reference_count
- thin_official_frame_count
- preflight_flash_lane_card_ratio_high
- preflight_flash_visual_card_ratio_high
- preflight_flash_visual_cover_art_should_only_support

## Evidence

- MP4: `unknown`
- Contact sheet: `unknown`
- QA JSON: `unknown`
- Forensic JSON: `unknown`
- Forensic Markdown: `unknown`
- Media package: `test/output/studio-v2-still-deck/enriched_media_package.json`
- Frame report: `test/output/controlled_frame_extraction_worker_apply_local.json`
- Segment validation report: `test/output/official_trailer_segment_validation_apply_local.json`

## Metrics

| Check | Value |
| --- | ---: |
| Runtime | 72.48s |
| QA lane | unknown |
| QA green / amber / red | 0 / 0 / 0 |
| Voice | provided-local-tts-audio (unknown) |
| Official clip refs | 0 |
| Official trailer frames | 2 |
| Current validated clip refs | 6 |
| Current validated clip sources | 5 |
| Current validated clip entities | 3 |
| Current segment rejections | 46 |
| Forensic verdict | warn |
| Forensic fails / warns | 0 / 2 |
| Visual repeat pairs after | 2 |
| Visual repeat pairs delta | -14 |
| Unique scene sources | 0 |
| Clip dominance | 0 |
| Caption gaps over 2s | 0 |

## Proposed Pilot Plan

- Do not switch production renderer.
- Do not change Railway env vars.
- Do not enable hard production gates.
- Do not publish automatically.
- No Studio V2 pilot should be run until blockers are fixed and a clean packet is regenerated.
- Keep legacy `assemble.js` as the rollback path.

## Rollback

Keep legacy assemble.js as canonical; if pilot underperforms or fails, publish via existing legacy path and do not set any Studio V2 production flag.

## Safety Boundaries

- Local-only report.
- No Railway mutation.
- No OAuth trigger.
- No production DB mutation.
- No platform post.
- No production render default change.
- Keep the blocked proof out of the live approval queue until it is clean.
