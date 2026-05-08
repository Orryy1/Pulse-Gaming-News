# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Summary

- Ready local Flash proofs: 0
- Blocked Flash proofs: 1
- Closest story: rss_5b3abe925b27a199

## rss_5b3abe925b27a199

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Recommendation: do_not_render_yet
- Blockers: footage_backbone_clip_dominance_too_low, flash_proof_requires_footage_backbone_dominance
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 39
- Motion frames: 3
- Validated clip refs: 9
- Validated clip sources: 4
- Projected clip dominance: 0.4
- Validated entities: BioShock, Red Dead, GTA
- Missing entities: none
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: warn (0 fail / 3 warn)

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: GTA, BioShock, Red Dead
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | alternate_source_required | 102 | 2 | 9 | segment_samples_too_repetitive | find_alternate_official_source_family |
| BioShock | alternate_source_required | 41 | 6 | 3 | segment_contains_low_detail_frame | find_alternate_official_source_family |
| Red Dead | alternate_source_required | 48 | 1 | 4 | segment_contains_black_frame | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| GTA | steam | Grand Theft Auto V Enhanced | A Safehouse in the Hills - NR | 19 | 17 | segment_samples_too_repetitive |
| GTA | steam | 3240220 | Steam movie 832632 | 12 | 12 | segment_samples_too_repetitive |
| GTA | steam | 3240220 | Steam movie 840633 | 11 | 11 | segment_contains_low_detail_frame |
| GTA | steam | Grand Theft Auto V Enhanced | Criminal Enterprises | 10 | 10 | segment_contains_black_frame |
| GTA | steam | Grand Theft Auto V Enhanced | Los Santos Tuners | 10 | 10 | segment_contains_low_detail_frame |
| GTA | steam | Grand Theft Auto V Enhanced | San Andreas Mercenaries | 10 | 10 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Los Santos Drug Wars | 10 | 10 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | The Chop Shop | 10 | 10 | segment_contains_title_or_rating_card |
| GTA | steam | Grand Theft Auto V Enhanced | Cluckin' Bell Farm Raid | 10 | 10 | segment_samples_too_repetitive |
| BioShock | steam | 8870 | Steam movie 10985 | 19 | 16 | segment_contains_low_detail_frame |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Songbird Lamb | 16 | 13 | segment_contains_low_detail_frame |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Icarus | 6 | 6 | segment_contains_low_detail_frame |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:GTA,BioShock,Red Dead
- do_not_rescan_same_official_sources_for:GTA,BioShock,Red Dead
- find_more_validated_gameplay_seconds_for_flash_lane

### Safe Commands

- validate_operator_official_source_intake: `npm run media:intake-official-sources -- --input test/output/official_source_intake_template.json --story-id rss_5b3abe925b27a199`
- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --official-source-intake-report test/output/official_source_intake_report.json --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- segment_action_score_below_flash_threshold: 2
- segment_samples_too_repetitive: 54
- segment_contains_black_frame: 44
- segment_contains_low_detail_frame: 39
- segment_lacks_gameplay_action_samples: 13
- segment_contains_weak_flash_sample: 2
- segment_sample_extract_failed: 1
- segment_source_is_localised_non_english_reference: 12
- segment_contains_title_or_rating_card: 15

### Latest Render Forensic Warnings

- Issue codes: subtitle_density, visual_repetition, rendered_frame_taste
- Repeat pair count: 1
- Repeat pair times: 3s/15s
- Weak rendered frame count: 1
- Weak rendered frames: 30s dead_dark_frame
- Rating/title frame count: 0

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
