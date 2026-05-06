# Studio V2 Overnight Promotion Packet

Generated: 2026-05-06T22:25:41.477Z
Story: `1szzhy9`
Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists

## Verdict

`AMBER_LOCAL_PROOF` - Queue a morning decision for a one-story Studio V2 pilot; do not switch production defaults.

Production ready: `no`
Morning approval needed: `yes`

## Warnings

- forensic_warnings_remaining
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
- If Martin approves, use this as a one-story manual Studio V2 pilot candidate only.
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
- Add the pilot decision to `MORNING_APPROVAL_QUEUE.md` before any live action.
