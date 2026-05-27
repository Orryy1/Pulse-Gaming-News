# Studio V2 Overnight Promotion Packet

Generated: 2026-05-16T10:45:53.097Z
Story: `1t0zhng`
Title: LEGO Batman: Legacy of the Dark Knight PC specs revealed

## Verdict

`AMBER_LOCAL_PROOF` - Queue a morning decision for a one-story Studio V2 pilot; do not switch production defaults.

Production ready: `no`
Morning approval needed: `yes`

## Warnings

- preflight_flash_lane_clip_dominance_supported_by_trailer_frames

## Evidence

- MP4: `test/output/studio-v2-still-deck/studio_v2_1t0zhng_enriched.mp4`
- Contact sheet: `test/output/studio-v2-still-deck/1t0zhng_enriched_contact_sheet.jpg`
- QA JSON: `test/output/studio-v2-still-deck/1t0zhng_enriched_qa.json`
- Forensic JSON: `test/output/studio-v2-still-deck/qa_forensic_1t0zhng_enriched_report.json`
- Forensic Markdown: `test/output/studio-v2-still-deck/qa_forensic_1t0zhng_enriched.md`
- Media package: `test/output/studio-v2-still-deck/enriched_media_package.json`
- Frame report: `test/output/controlled_frame_extraction_worker_apply_local.json`
- Segment validation report: `test/output/official_trailer_segment_validation_apply_local.json`

## Metrics

| Check | Value |
| --- | ---: |
| Runtime | 73.72s |
| QA lane | pass |
| QA green / amber / red | 14 / 4 / 0 |
| Voice | approved-provided-local-tts (green) |
| Official clip refs | 4 |
| Official trailer frames | 18 |
| Current validated clip refs | 13 |
| Current validated clip sources | 3 |
| Current validated clip entities | 1 |
| Current segment rejections | 351 |
| Forensic verdict | pass |
| Forensic fails / warns | 0 / 0 |
| Visual repeat pairs after | 0 |
| Visual repeat pairs delta | -93 |
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
