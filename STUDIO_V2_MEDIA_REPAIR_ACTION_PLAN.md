# Studio V2 Media Repair Action Planner

Visual Evidence Repair Plan compatibility report.

Generated: 2026-05-16T01:23:35.403Z
Mode: read_only_repair_plan

## Summary

- Rows considered: 20
- Repair candidates: 20
- Cover dominated: 5
- Wrong-story assets: 1
- Unverified store assets: 0
- Motion evidence gap: 2
- Exact-subject gameplay-still repairs: 18
- Official source intake needed: 1
- Validated clip windows needed: 20
- Wrong-story deck rejections: 1
- Exhausted bad windows: 2
- Render-ready claims blocked without validated motion: 18

## Repair Queue

| Story | Primary action | Repair | Audio | Media score | Motion ready | Exact | Cover share | Alternate source | Next command |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| rss_2d69aa8506934c5e: Call of Duty won't hit Xbox Game Pass at launch going forwards, as Microsoft's subscription service gets a price cut | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_6edbb38dc280fc96: rss_6edbb38dc280fc96 | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_7945f462187bd7f8: rss_7945f462187bd7f8 | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_7945f462187bd7f8 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_ef7e6e464509e0bc: rss_ef7e6e464509e0bc | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_6d8aaac7eccad2ff: rss_6d8aaac7eccad2ff | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |

## Command Details

### rss_2d69aa8506934c5e

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: Call of Duty
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Call of Duty

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id rss_2d69aa8506934c5e --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_2d69aa8506934c5e --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_2d69aa8506934c5e.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_2d69aa8506934c5e` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_2d69aa8506934c5e` (report_only)

### rss_6edbb38dc280fc96

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id rss_6edbb38dc280fc96 --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_6edbb38dc280fc96 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_6edbb38dc280fc96.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_6edbb38dc280fc96` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_6edbb38dc280fc96` (report_only)

### rss_7945f462187bd7f8

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_7945f462187bd7f8 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_7945f462187bd7f8 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id rss_7945f462187bd7f8 --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_7945f462187bd7f8 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_7945f462187bd7f8.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_7945f462187bd7f8` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_7945f462187bd7f8` (report_only)

### rss_ef7e6e464509e0bc

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id rss_ef7e6e464509e0bc --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_ef7e6e464509e0bc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_ef7e6e464509e0bc.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_ef7e6e464509e0bc` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_ef7e6e464509e0bc` (report_only)

### rss_6d8aaac7eccad2ff

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id rss_6d8aaac7eccad2ff --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_6d8aaac7eccad2ff --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_6d8aaac7eccad2ff.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_6d8aaac7eccad2ff` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_6d8aaac7eccad2ff` (report_only)

## Safety

- This planner is read-only and writes reports only.
- Suggested apply-local commands are not executed by this planner.
- No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed.
