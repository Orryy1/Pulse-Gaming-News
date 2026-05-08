# Flash Lane Current State

Read-only control report. No Railway, OAuth, production DB, render default, TTS or social posting changes.

## Summary

- Candidates considered: 8
- Ready for local Flash proof: 0
- Need local Liam audio: 1
- Need Liam audio duration repair: 1
- Need format router decision: 1
- Need exact subject assets: 0
- Need motion validation: 1
- Need alternate official motion source: 4

## Input Freshness

- Motion gap report: 2026-05-08T02:41:07.172Z
- Alternate source report: 2026-05-08T04:34:42.824Z
- Reference counts: current

## Current Queue

| Story | Stage | Distance | Audio | Exact | Clips | Missing motion entities | Next action |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 1t186u4: Reggie says Nintendo stopped selling products on Amazon in the 2010s after they asked for financial support to undercut competitors' prices | needs_format_router_decision | two_blockers | ready 68.5s | 0 | 0/0 | none | route_to_briefing_or_context_card_lane |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | needs_motion_window_validation | one_blocker | ready 66.7s | 12 | 3/1 | Legacy of the Dark Knight | validate_more_official_gameplay_windows |
| 1t0x9ui: It's been a year since release and Oblivion Remastered is still broken- Digital Foundry | needs_alternate_official_motion_source | two_blockers | ready 69.3s | 6 | 0/0 | Oblivion | find_non_exhausted_official_motion_source |
| 1t1hyqc: Even tho I can’t download you. You will always be on my phone. | needs_liam_audio_duration_repair | hard_blocked | local_liam_audio_not_flash_ready | 0 | 0/0 | none | repair_script_length_or_regenerate_local_liam_audio |
| 1t0u9o4: Don’t Expect Product Placement in GTA 6 — the CEO of Take-Two Says It Won't Do Real World Brand Partnerships Because 'All the Brands Are Made Up' | needs_alternate_official_motion_source | two_blockers | ready 71.2s | 17 | 0/0 | GTA | find_non_exhausted_official_motion_source |
| 1szzhy9: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists | needs_alternate_official_motion_source | one_blocker | ready 74.6s | 6 | 13/8 | none | find_more_validated_gameplay_seconds_or_downgrade_story |
| 1t0w9nb: Digital Foundry: Yup, Oblivion Remastered Is Still Broken a Year After Release | needs_local_liam_audio | two_blockers | approved_local_liam_audio_missing | 6 | 0/0 | Oblivion | generate_or_repair_local_liam_audio |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | needs_alternate_official_motion_source | one_blocker | ready 72.5s | 26 | 6/5 | none | find_more_validated_gameplay_seconds_or_downgrade_story |

## Next Commands

### 1t186u4
- No safe render command yet. Work the blocker above first.

### 1t0zhng
- Command: `npm run media:resolve-trailers -- --story-id 1t0zhng --no-latest-report`
- Command: `npm run media:plan-frames -- --story-id 1t0zhng --trailer-references test/output/official_trailer_references_v1.json`
- Command: `npm run media:extract-frames -- --story-id 1t0zhng --apply-local`

### 1t0x9ui
- Command: `npm run media:resolve-trailers -- --story-id 1t0x9ui --no-latest-report`
- Command: `npm run media:plan-frames -- --story-id 1t0x9ui --trailer-references test/output/official_trailer_references_v1.json`
- Command: `npm run media:extract-frames -- --story-id 1t0x9ui --apply-local`
- Search targets: Oblivion official trailer; Oblivion gameplay trailer; Oblivion Steam trailer; Oblivion gameplay

### 1t1hyqc
- Command: `npm run media:resolve-trailers -- --story-id 1t1hyqc --no-latest-report`
- Command: `npm run media:plan-frames -- --story-id 1t1hyqc --trailer-references test/output/official_trailer_references_v1.json`
- Command: `npm run media:extract-frames -- --story-id 1t1hyqc --apply-local`

### 1t0u9o4
- Command: `npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id 1t0u9o4`
- Command: `npm run media:resolve-trailers -- --story-id 1t0u9o4 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Command: `npm run media:plan-frames -- --story-id 1t0u9o4 --trailer-references test/output/official_trailer_references_v1.json`
- Search targets: GTA official trailer; GTA gameplay trailer; GTA official gameplay; GTA platform storefront trailer

### 1szzhy9
- Command: `npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id 1szzhy9`
- Command: `npm run media:resolve-trailers -- --story-id 1szzhy9 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Command: `npm run media:plan-frames -- --story-id 1szzhy9 --trailer-references test/output/official_trailer_references_v1.json`
- Search targets: Marathon official trailer; Marathon gameplay trailer; Marathon official gameplay; Marathon platform storefront trailer

### 1t0w9nb
- Command: `npm run media:resolve-trailers -- --story-id 1t0w9nb --no-latest-report`
- Command: `npm run media:plan-frames -- --story-id 1t0w9nb --trailer-references test/output/official_trailer_references_v1.json`
- Command: `npm run media:extract-frames -- --story-id 1t0w9nb --apply-local`

### rss_5b3abe925b27a199
- Command: `npm run media:intake-official-sources -- --input test/input/official_sources.json --story-id rss_5b3abe925b27a199`
- Command: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- Command: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199 --trailer-references test/output/official_trailer_references_v1.json`
- Search targets: BioShock official trailer; BioShock gameplay trailer; BioShock official gameplay; BioShock platform storefront trailer; Red Dead official trailer; Red Dead gameplay trailer; Red Dead official gameplay; Red Dead platform storefront trailer

## Safety

- Report-only and local-only.
- Does not download media, render video, call TTS, post, mutate the DB, touch Railway or trigger OAuth.
- Use this report to decide the next local acquisition/validation step before any new Studio V2 proof render.
