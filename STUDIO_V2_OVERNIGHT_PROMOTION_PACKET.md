# Studio V2 Overnight Promotion Packet

Generated: 2026-05-07T02:43:11.617Z
Story: `1szzhy9`
Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists

## Verdict

`RED_BLOCKED` - Do not pilot Studio V2 yet; fix blockers and regenerate the local proof packet.

Production ready: `no`
Morning approval needed: `no`

## Blockers

- forensic_warnings_remaining
- visual_repeat_pairs_remaining
- weak_rendered_frames_remaining

## Warnings

- preflight_flash_lane_spoken_wpm_outside_target_range
- preflight_flash_lane_clip_dominance_supported_by_trailer_frames

## Forensic Warning Details

- Issue codes: visual_repetition, rendered_frame_taste
- Repeat pair count: 2
- Repeat pair times: 46.5s/49.5s, 55.5s/58.5s
- Weak rendered frame count: 2
- Weak rendered frames: 16.5s dead_dark_frame, 22.5s washed_low_detail_frame
- Rating/title frame count: 0

## Evidence

- MP4: `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4`
- Contact sheet: `test/output/studio-v2-still-deck/1szzhy9_enriched_contact_sheet.jpg`
- QA JSON: `test/output/studio-v2-still-deck/1szzhy9_enriched_qa.json`
- Forensic JSON: `test/output/studio-v2-still-deck/qa_forensic_1szzhy9_enriched_report.json`
- Forensic Markdown: `test/output/studio-v2-still-deck/qa_forensic_1szzhy9_enriched.md`
- Media package: `test/output/studio-v2-still-deck/enriched_media_package.json`
- Frame report: `test/output/controlled_frame_extraction_worker_apply_local.json`
- Segment validation report: `test/output/official_trailer_segment_validation_apply_local.json`

## Metrics

| Check | Value |
| --- | ---: |
| Runtime | 74.666016s |
| QA lane | pass |
| QA green / amber / red | 14 / 4 / 0 |
| Voice | approved-provided-local-tts (green) |
| Official clip refs | 7 |
| Official trailer frames | 9 |
| Current validated clip refs | unknown |
| Current validated clip sources | unknown |
| Current validated clip entities | unknown |
| Current segment rejections | unknown |
| Forensic verdict | warn |
| Forensic fails / warns | 0 / 2 |
| Visual repeat pairs after | 2 |
| Visual repeat pairs delta | -14 |
| Unique scene sources | 14 |
| Clip dominance | 0.88 |
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
