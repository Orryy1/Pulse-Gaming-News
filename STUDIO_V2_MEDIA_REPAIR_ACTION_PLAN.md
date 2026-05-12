# Studio V2 Media Repair Action Planner

Visual Evidence Repair Plan compatibility report.

Generated: 2026-05-12T22:41:40.143Z
Mode: read_only_repair_plan

## Summary

- Rows considered: 11
- Repair candidates: 11
- Cover dominated: 2
- Wrong-story assets: 0
- Unverified store assets: 0
- Motion evidence gap: 0
- Exact-subject gameplay-still repairs: 11
- Official source intake needed: 1
- Validated clip windows needed: 10
- Wrong-story deck rejections: 0
- Exhausted bad windows: 2
- Render-ready claims blocked without validated motion: 10

## Repair Queue

| Story | Primary action | Repair | Motion ready | Exact | Cover share | Alternate source | Next command |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 1s49ty7: Star Wars Zero Company is more than just 'Star Wars XCOM'—it feels like Mass Effect but with turn-based tactics and permadeath | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story 1s49ty7 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1s4denn: The Expanse: Osiris Reborn \| Official Gameplay Trailer \| Xbox Partner Preview 2026 | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story 1s4denn --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1s4e2ws: Hades II - Xbox & PlayStation Trailer (Coming April 14th!) | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story 1s4e2ws --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1s4j81q: It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story 1s4j81q --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | cover_dominated_deck_repair | cover_dominated_exact_assets | no | 12 | 0.667 | none | npm run media:enrich-stills -- --story 1t0zhng --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_1b7c404fc657548f: rss_1b7c404fc657548f | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_1b7c404fc657548f --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_2d69aa8506934c5e: rss_2d69aa8506934c5e | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | official_source_intake_needed | cover_dominated_exact_assets | yes | 39 | 0.333 | GTA, BioShock, Red Dead | npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_6d8aaac7eccad2ff: rss_6d8aaac7eccad2ff | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_6edbb38dc280fc96: rss_6edbb38dc280fc96 | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_ef7e6e464509e0bc: rss_ef7e6e464509e0bc | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |

## Command Details

### 1s49ty7

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: Star Wars Zero Company
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Star Wars Zero Company

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1s49ty7 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1s49ty7 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1s49ty7` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1s49ty7` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1s49ty7 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1s49ty7.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1s4denn

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: The Expanse, Osiris Reborn Official Gameplay
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: The Expanse, Osiris Reborn Official Gameplay

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1s4denn --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1s4denn --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1s4denn` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1s4denn` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1s4denn --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1s4denn.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1s4e2ws

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1s4e2ws --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1s4e2ws --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1s4e2ws` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1s4e2ws` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1s4e2ws --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1s4e2ws.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1s4j81q

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: It's brutal out there
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: It's brutal out there

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1s4j81q --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1s4j81q --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1s4j81q` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1s4j81q` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1s4j81q --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1s4j81q.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t0zhng

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: LEGO Batman, Legacy of the Dark Knight
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: LEGO Batman, Legacy of the Dark Knight
- 3. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family.
- 4. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: LEGO Batman, Legacy of the Dark Knight

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t0zhng --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t0zhng --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0zhng` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0zhng` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t0zhng.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_1b7c404fc657548f

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_1b7c404fc657548f --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_1b7c404fc657548f --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_1b7c404fc657548f` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_1b7c404fc657548f` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_1b7c404fc657548f --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_1b7c404fc657548f.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_2d69aa8506934c5e

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_2d69aa8506934c5e` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_2d69aa8506934c5e` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_2d69aa8506934c5e --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_2d69aa8506934c5e.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_5b3abe925b27a199

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Validated motion ready: yes

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: GTA, BioShock, Red Dead
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: GTA, BioShock, Red Dead
- 3. official_source_intake_needed (P0): Current source families are exhausted; operator must supply a non-exhausted official reference first. Entities: GTA, BioShock, Red Dead
- 4. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family. Entities: GTA, BioShock, Red Dead

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_5b3abe925b27a199` (report_only)
- validate_operator_official_source_intake: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id rss_5b3abe925b27a199` (report_only_reference_validation)
- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5` (network_metadata_lookup_report_only)

### rss_6d8aaac7eccad2ff

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_6d8aaac7eccad2ff` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_6d8aaac7eccad2ff` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_6d8aaac7eccad2ff --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_6d8aaac7eccad2ff.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_6edbb38dc280fc96

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_6edbb38dc280fc96` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_6edbb38dc280fc96` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_6edbb38dc280fc96 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_6edbb38dc280fc96.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_ef7e6e464509e0bc

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_ef7e6e464509e0bc` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_ef7e6e464509e0bc` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_ef7e6e464509e0bc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_ef7e6e464509e0bc.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

## Safety

- This planner is read-only and writes reports only.
- Suggested apply-local commands are not executed by this planner.
- No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed.
