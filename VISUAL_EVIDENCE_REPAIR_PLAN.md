# Visual Evidence Repair Plan

Generated: 2026-05-08T05:28:20.594Z
Mode: read_only_repair_plan

## Summary

- Rows considered: 8
- Repair candidates: 4
- Cover dominated: 4
- Wrong-story assets: 0
- Unverified store assets: 0
- Motion evidence gap: 0

## Repair Queue

| Story | Repair | Exact | Cover share | Missing motion | Next command |
| --- | --- | ---: | ---: | --- | --- |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | cover_dominated_exact_assets | 12 | 0.667 | Legacy of the Dark Knight | npm run media:enrich-stills -- --story 1t0zhng --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t0x9ui: It's been a year since release and Oblivion Remastered is still broken- Digital Foundry | cover_dominated_exact_assets | 6 | 0.667 | Oblivion | npm run media:enrich-stills -- --story 1t0x9ui --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1szzhy9: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists | cover_dominated_exact_assets | 6 | 0.667 | none | npm run media:enrich-stills -- --story 1szzhy9 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |
| 1t0w9nb: Digital Foundry: Yup, Oblivion Remastered Is Still Broken a Year After Release | cover_dominated_exact_assets | 6 | 0.667 | Oblivion | npm run media:enrich-stills -- --story 1t0w9nb --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12 |

## Command Details

### 1t0zhng

Reason: Exact-subject count is inflated by covers, capsules or key art.
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t0zhng --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t0zhng --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id 1t0zhng --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0zhng` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0zhng` (report_only)

### 1t0x9ui

Reason: Exact-subject count is inflated by covers, capsules or key art.
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t0x9ui --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t0x9ui --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id 1t0x9ui --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0x9ui --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0x9ui` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0x9ui` (report_only)

### 1szzhy9

Reason: Exact-subject count is inflated by covers, capsules or key art.
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1szzhy9 --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1szzhy9 --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1szzhy9` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1szzhy9` (report_only)

### 1t0w9nb

Reason: Exact-subject count is inflated by covers, capsules or key art.
- gameplay_still_dry_run: `npm run media:enrich-stills -- --story 1t0w9nb --dry-run --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (dry_run_only)
- gameplay_still_apply_local: `npm run media:enrich-stills -- --story 1t0w9nb --apply-local --prefer-gameplay-stills --require-verified-store --max-store-search-entities 5 --max-store-assets-per-entity 3 --max-downloads-per-story 12` (apply_local_under_test_output_only)
- resolve_official_motion_refs: `npm run media:resolve-trailers -- --story-id 1t0w9nb --no-latest-report` (report_only)
- validate_gameplay_windows: `npm run media:validate-trailer-segments -- --story-id 1t0w9nb --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6` (apply_local_under_test_output_only)
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0w9nb` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0w9nb` (report_only)

## Safety

- This planner is read-only and writes reports only.
- Suggested apply-local commands are not executed by this planner.
- No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed.
