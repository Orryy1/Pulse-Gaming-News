# Studio V2 Media Repair Action Planner

Visual Evidence Repair Plan compatibility report.

Generated: 2026-05-12T23:13:18.285Z
Mode: read_only_repair_plan

## Summary

- Rows considered: 20
- Repair candidates: 20
- Cover dominated: 5
- Wrong-story assets: 1
- Unverified store assets: 0
- Motion evidence gap: 2
- Exact-subject gameplay-still repairs: 18
- Official source intake needed: 4
- Validated clip windows needed: 20
- Wrong-story deck rejections: 1
- Exhausted bad windows: 7
- Render-ready claims blocked without validated motion: 18

## Repair Queue

| Story | Primary action | Repair | Audio | Media score | Motion ready | Exact | Cover share | Alternate source | Next command |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| rss_2d69aa8506934c5e: Call of Duty won't hit Xbox Game Pass at launch going forwards, as Microsoft's subscription service gets a price cut | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_ef7e6e464509e0bc: MindsEye Has a New Update and a Cheaper Price as Developer Launches Comeback Bid | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_6edbb38dc280fc96: rss_6edbb38dc280fc96 | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_6edbb38dc280fc96 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_6d8aaac7eccad2ff: rss_6d8aaac7eccad2ff | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_6d8aaac7eccad2ff --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_1b7c404fc657548f: rss_1b7c404fc657548f | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | ready | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_1b7c404fc657548f --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_5b3abe925b27a199: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One | wrong_story_deck_rejection | wrong_story_exact_assets | missing | 209.25 | yes | 26 | 0.5 | GTA, BioShock, Red Dead | npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1szzhy9: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists | official_source_intake_needed | cover_dominated_exact_assets | missing | 164 | yes | 6 | 0.667 | Marathon | npm run media:enrich-stills -- --story 1szzhy9 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_4105cb7c837252c3: A New The Division PC Game Is Out Right Now, And It's Free | cover_dominated_deck_repair | cover_dominated_exact_assets | missing | 63 | no | 12 | 0.667 | none | npm run media:enrich-stills -- --story rss_4105cb7c837252c3 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_0e2778be9f97ffa4: The next Tales Of remaster has leaked, and it's probably not what you're expecting | official_source_intake_needed | cover_dominated_exact_assets | missing | 36.25 | no | 6 | 0.667 | Tales Of | npm run media:enrich-stills -- --story rss_0e2778be9f97ffa4 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t0x9ui: It's been a year since release and Oblivion Remastered is still broken- Digital Foundry | cover_dominated_deck_repair | cover_dominated_exact_assets | missing | 24 | no | 6 | 0.667 | none | npm run media:enrich-stills -- --story 1t0x9ui --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t0w9nb: Digital Foundry: Yup, Oblivion Remastered Is Still Broken a Year After Release | cover_dominated_deck_repair | cover_dominated_exact_assets | missing | 24 | no | 6 | 0.667 | none | npm run media:enrich-stills -- --story 1t0w9nb --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| demo_gta_xbox: GTA 6 gets a new Xbox showcase update | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 4 | no | 1 | 0 | none | npm run media:enrich-stills -- --story demo_gta_xbox --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_8ea7f2689732f31a: Even GTA 6's price needs to feel "reasonable", says Take-Two boss: hiking past $70 to match inflation "doesn’t make a whole lot of sense" | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_8ea7f2689732f31a --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_3831c03ef4eaf35c: Invincible VS Global Release Times Confirmed | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_3831c03ef4eaf35c --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t186u4: Reggie says Nintendo stopped selling products on Amazon in the 2010s after they asked for financial support to undercut competitors' prices | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story 1t186u4 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t1hyqc: Even tho I can’t download you. You will always be on my phone. | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story 1t1hyqc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_93fdf53a0c1211ef: PlayStation Plus Free Games For May 2026 Revealed | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_93fdf53a0c1211ef --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| rss_9fb084475142f310: GTA 6 Price Commented On By Rockstar's Owner | exact_subject_gameplay_still_repair | exact_subject_gameplay_still_gap | missing | 0 | no | 0 | 0 | none | npm run media:enrich-stills -- --story rss_9fb084475142f310 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | validated_clip_windows_needed | motion_evidence_gap | ready | 139.75 | no | 24 | 0.333 | none | npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t0zhng.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6 |
| 1t0u9o4: Don’t Expect Product Placement in GTA 6 — the CEO of Take-Two Says It Won't Do Real World Brand Partnerships Because 'All the Brands Are Made Up' | official_source_intake_needed | motion_evidence_gap | missing | 68 | no | 17 | 0.412 | GTA | npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id 1t0u9o4 |

## Command Details

### rss_2d69aa8506934c5e

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: Call of Duty won't
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Call of Duty won't

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_2d69aa8506934c5e --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_2d69aa8506934c5e` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_2d69aa8506934c5e` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_2d69aa8506934c5e --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_2d69aa8506934c5e.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_ef7e6e464509e0bc

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: MindsEye
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: MindsEye

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_ef7e6e464509e0bc --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_ef7e6e464509e0bc` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_ef7e6e464509e0bc` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_ef7e6e464509e0bc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_ef7e6e464509e0bc.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

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
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_6edbb38dc280fc96` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_6edbb38dc280fc96` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_6edbb38dc280fc96 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_6edbb38dc280fc96.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

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
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_6d8aaac7eccad2ff` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_6d8aaac7eccad2ff` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_6d8aaac7eccad2ff --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_6d8aaac7eccad2ff.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_1b7c404fc657548f

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 0
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

### rss_5b3abe925b27a199

Reason: Exact-subject count includes assets for the wrong story/entity.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 209.25
Validated motion ready: yes

Ranked actions:
- 1. reject_wrong_story_deck (P0): Do not use the current deck because exact assets include wrong-story entities. Entities: Red Dead, BioShock
- 2. exact_subject_gameplay_still_repair (P0): Rebuild the exact-subject still deck with entity-filtered gameplay stills. Entities: GTA, BioShock, Red Dead
- 3. official_source_intake_needed (P0): Current source families are exhausted; operator must supply a non-exhausted official reference first. Entities: GTA, BioShock, Red Dead
- 4. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family. Entities: GTA, BioShock, Red Dead
- 5. validated_clip_windows_needed (P1): Validated gameplay clip windows are below the Flash Lane threshold. Entities: GTA, BioShock, Red Dead

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_5b3abe925b27a199 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_5b3abe925b27a199` (report_only)
- validate_operator_official_source_intake: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id rss_5b3abe925b27a199` (report_only_reference_validation)
- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5` (network_metadata_lookup_report_only)
- validate_gameplay_windows_after_intake: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_5b3abe925b27a199.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1szzhy9

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 164
Validated motion ready: yes

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: Marathon
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: Marathon
- 3. official_source_intake_needed (P0): Current source families are exhausted; operator must supply a non-exhausted official reference first. Entities: Marathon
- 4. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family. Entities: Marathon
- 5. validated_clip_windows_needed (P1): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Marathon

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1szzhy9 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1szzhy9 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1szzhy9` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1szzhy9` (report_only)
- validate_operator_official_source_intake: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id 1szzhy9` (report_only_reference_validation)
- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1szzhy9 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5` (network_metadata_lookup_report_only)
- validate_gameplay_windows_after_intake: `npm run media:validate-trailer-segments -- --story-id 1szzhy9 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1szzhy9.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_4105cb7c837252c3

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 63
Validated motion ready: no

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: The Division, Division
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: The Division, Division
- 3. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family.
- 4. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: The Division, Division

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_4105cb7c837252c3 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_4105cb7c837252c3 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_4105cb7c837252c3` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_4105cb7c837252c3` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_4105cb7c837252c3 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_4105cb7c837252c3.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_0e2778be9f97ffa4

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 36.25
Validated motion ready: no

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: Tales Of
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: Tales Of
- 3. official_source_intake_needed (P0): Current source families are exhausted; operator must supply a non-exhausted official reference first. Entities: Tales Of
- 4. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family. Entities: Tales Of
- 5. validated_clip_windows_needed (P1): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Tales Of

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_0e2778be9f97ffa4 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_0e2778be9f97ffa4 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_0e2778be9f97ffa4` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_0e2778be9f97ffa4` (report_only)
- validate_operator_official_source_intake: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id rss_0e2778be9f97ffa4` (report_only_reference_validation)
- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_0e2778be9f97ffa4 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5` (network_metadata_lookup_report_only)
- validate_gameplay_windows_after_intake: `npm run media:validate-trailer-segments -- --story-id rss_0e2778be9f97ffa4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_0e2778be9f97ffa4.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t0x9ui

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 24
Validated motion ready: no

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: Oblivion
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: Oblivion
- 3. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family.
- 4. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Oblivion

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t0x9ui --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t0x9ui --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0x9ui` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0x9ui` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0x9ui --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t0x9ui.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t0w9nb

Reason: Exact-subject count is inflated by covers, capsules or key art.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 24
Validated motion ready: no

Ranked actions:
- 1. cover_dominated_deck_repair (P0): Replace covers, capsules and key art with gameplay stills. Entities: Oblivion
- 2. exact_subject_gameplay_still_repair (P0): Exact-subject count is inflated by covers, capsules or key art. Entities: Oblivion
- 3. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Oblivion

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t0w9nb --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t0w9nb --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0w9nb` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0w9nb` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0w9nb --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t0w9nb.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### demo_gta_xbox

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 4
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: GTA
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: GTA

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story demo_gta_xbox --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story demo_gta_xbox --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story demo_gta_xbox` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story demo_gta_xbox` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id demo_gta_xbox --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_demo_gta_xbox.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_8ea7f2689732f31a

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: GTA
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: GTA

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_8ea7f2689732f31a --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_8ea7f2689732f31a --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_8ea7f2689732f31a` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_8ea7f2689732f31a` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_8ea7f2689732f31a --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_8ea7f2689732f31a.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_3831c03ef4eaf35c

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: Invincible VS
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: Invincible VS

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_3831c03ef4eaf35c --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_3831c03ef4eaf35c --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_3831c03ef4eaf35c` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_3831c03ef4eaf35c` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_3831c03ef4eaf35c --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_3831c03ef4eaf35c.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t186u4

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t186u4 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t186u4 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t186u4` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t186u4` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t186u4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t186u4.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t1hyqc

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t1hyqc --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t1hyqc --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t1hyqc` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t1hyqc` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t1hyqc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t1hyqc.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_93fdf53a0c1211ef

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold.

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_93fdf53a0c1211ef --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_93fdf53a0c1211ef --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_93fdf53a0c1211ef` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_93fdf53a0c1211ef` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_93fdf53a0c1211ef --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_93fdf53a0c1211ef.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### rss_9fb084475142f310

Reason: The proof deck needs more exact-subject gameplay stills before proof rendering.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 0
Validated motion ready: no

Ranked actions:
- 1. exact_subject_gameplay_still_repair (P0): The proof deck needs more exact-subject gameplay stills before proof rendering. Entities: GTA
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: GTA

Commands:
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story rss_9fb084475142f310 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story rss_9fb084475142f310 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story rss_9fb084475142f310` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story rss_9fb084475142f310` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id rss_9fb084475142f310 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_rss_9fb084475142f310.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t0zhng

Reason: Visual stills are not the only blocker; validated motion/entity coverage is still thin.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 139.75
Validated motion ready: no

Ranked actions:
- 1. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family.
- 2. validated_clip_windows_needed (P0): Validated gameplay clip windows are below the Flash Lane threshold. Entities: LEGO Batman, Legacy of the Dark Knight

Commands:
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0zhng` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0zhng` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t0zhng.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

### 1t0u9o4

Reason: Visual stills are not the only blocker; validated motion/entity coverage is still thin.
Render recommendation: do_not_render_yet
Audio ready: no
Media progress score: 68
Validated motion ready: no

Ranked actions:
- 1. official_source_intake_needed (P0): Current source families are exhausted; operator must supply a non-exhausted official reference first. Entities: GTA
- 2. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family. Entities: GTA
- 3. validated_clip_windows_needed (P1): Validated gameplay clip windows are below the Flash Lane threshold. Entities: GTA

Commands:
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0u9o4` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0u9o4` (report_only)
- validate_operator_official_source_intake: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id 1t0u9o4` (report_only_reference_validation)
- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0u9o4 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5` (network_metadata_lookup_report_only)
- validate_gameplay_windows_after_intake: `npm run media:validate-trailer-segments -- --story-id 1t0u9o4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1_story_1t0u9o4.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)

## Safety

- This planner is read-only and writes reports only.
- Suggested apply-local commands are not executed by this planner.
- No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed.
