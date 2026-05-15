# Flash Lane Current State

Read-only control report. No Railway, OAuth, production DB, render default, TTS or social posting changes.

## Summary

- Candidates considered: 10
- Ready for local Flash proof: 0
- Need local Liam audio: 3
- Need Liam audio duration repair: 0
- Need format router decision: 5
- Need exact subject assets: 1
- Need visual evidence repair: 0
- Need motion validation: 1
- Need alternate official motion source: 0

## Input Freshness

- Motion gap report: 2026-05-13T10:21:10.203Z
- Alternate source report: 2026-05-08T13:47:22.047Z
- Reference counts: current

- Warning: alternate_source_report_older_than_motion_gap - The alternate-source handoff is older than the motion-gap report; alternate source entities may be incomplete.
  Recommended: `npm run studio:v2:alternate-sources`

## Current Queue

| Story | Stage | Distance | Audio | Exact | Visual gate | Clips | Clip gap | Missing motion entities | Next action |
| --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | needs_motion_window_validation | one_blocker | ready 71.5s | 24 | pass | 4/2 | 27.6s | none | validate_more_official_gameplay_windows |
| rss_2d69aa8506934c5e: Call of Duty won't hit Xbox Game Pass at launch going forwards, as Microsoft's subscription service gets a price cut | needs_exact_subject_assets | two_blockers | ready 68.5s | 0 | pass | 0/0 | unknown | none | run_exact_subject_still_acquisition |
| rss_6edbb38dc280fc96: rss_6edbb38dc280fc96 | needs_format_router_decision | two_blockers | ready 62.1s | 0 | pass | 0/0 | unknown | none | route_to_briefing_or_context_card_lane |
| rss_7945f462187bd7f8: rss_7945f462187bd7f8 | needs_format_router_decision | two_blockers | ready 70.6s | 0 | pass | 0/0 | unknown | none | route_to_briefing_or_context_card_lane |
| rss_ef7e6e464509e0bc: rss_ef7e6e464509e0bc | needs_format_router_decision | two_blockers | ready 73.9s | 0 | pass | 0/0 | unknown | none | route_to_briefing_or_context_card_lane |
| rss_6d8aaac7eccad2ff: rss_6d8aaac7eccad2ff | needs_format_router_decision | two_blockers | ready 62.7s | 0 | pass | 0/0 | unknown | none | route_to_briefing_or_context_card_lane |
| rss_1b7c404fc657548f: rss_1b7c404fc657548f | needs_format_router_decision | two_blockers | ready 66.1s | 0 | pass | 0/0 | unknown | none | route_to_briefing_or_context_card_lane |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | needs_local_liam_audio | hard_blocked | approved_local_liam_audio_missing | 26 | block cover 0.5 | 9/4 | unknown | none | generate_or_repair_local_liam_audio |
| 1szzhy9: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists | needs_local_liam_audio | two_blockers | approved_local_liam_audio_missing | 6 | block cover 0.667 | 13/8 | unknown | none | generate_or_repair_local_liam_audio |
| 1t0u9o4: Don’t Expect Product Placement in GTA 6 — the CEO of Take-Two Says It Won't Do Real World Brand Partnerships Because 'All the Brands Are Made Up' | needs_local_liam_audio | two_blockers | approved_local_liam_audio_missing | 17 | pass | 0/0 | unknown | GTA | generate_or_repair_local_liam_audio |

## Next Commands

### 1t0zhng
- Command: `npm run media:resolve-trailers -- --story-id 1t0zhng --no-latest-report`
- Command: `npm run media:plan-frames -- --story-id 1t0zhng --trailer-references test/output/official_trailer_references_v1_story_1t0zhng.json`
- Command: `npm run media:extract-frames -- --story-id 1t0zhng --apply-local`

### rss_2d69aa8506934c5e
- No safe render command yet. Work the blocker above first.

### rss_6edbb38dc280fc96
- No safe render command yet. Work the blocker above first.

### rss_7945f462187bd7f8
- No safe render command yet. Work the blocker above first.

### rss_ef7e6e464509e0bc
- No safe render command yet. Work the blocker above first.

### rss_6d8aaac7eccad2ff
- No safe render command yet. Work the blocker above first.

### rss_1b7c404fc657548f
- No safe render command yet. Work the blocker above first.

### rss_5b3abe925b27a199
- Alternate source for GTA: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id rss_5b3abe925b27a199`
- Alternate source for GTA: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Alternate source for GTA: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_5b3abe925b27a199.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- Search targets: GTA official trailer; GTA gameplay trailer; GTA Steam trailer; GTA gameplay; BioShock official trailer; BioShock gameplay trailer; BioShock official gameplay; BioShock platform storefront trailer; Red Dead official trailer; Red Dead gameplay trailer; Red Dead official gameplay; Red Dead platform storefront trailer

## Safety

- Report-only and local-only.
- Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth.
- Use this report to decide the next local acquisition/validation step before any new Studio V2 proof render.
