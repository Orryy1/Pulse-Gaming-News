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
- Exact assets: 26
- Motion frames: 2
- Validated clip refs: 6
- Validated clip sources: 5
- Projected clip dominance: 0.3
- Validated entities: BioShock, Red Dead, GTA
- Missing entities: none
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: fail (1 fail / 1 warn)

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: GTA, BioShock, Red Dead
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | alternate_source_required | 55 | 1 | 9 | segment_samples_too_repetitive | find_alternate_official_source_family |
| BioShock | alternate_source_required | 20 | 3 | 3 | segment_contains_low_detail_frame | find_alternate_official_source_family |
| Red Dead | alternate_source_required | 25 | 2 | 4 | segment_contains_black_frame | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| GTA | steam | 3240220 | Steam movie 832632 | 7 | 7 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Criminal Enterprises | 6 | 6 | segment_contains_black_frame |
| GTA | steam | Grand Theft Auto V Enhanced | Los Santos Tuners | 6 | 6 | segment_contains_low_detail_frame |
| GTA | steam | Grand Theft Auto V Enhanced | San Andreas Mercenaries | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Los Santos Drug Wars | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | The Chop Shop | 6 | 6 | segment_contains_title_or_rating_card |
| GTA | steam | Grand Theft Auto V Enhanced | Cluckin' Bell Farm Raid | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Bottom Dollar Bounties | 6 | 6 | segment_contains_low_detail_frame |
| GTA | steam | Grand Theft Auto V Enhanced | A Safehouse in the Hills - NR | 6 | 5 | segment_lacks_gameplay_action_samples |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Icarus | 6 | 6 | segment_contains_low_detail_frame |
| BioShock | steam | 8870 | Steam movie 10985 | 8 | 6 | segment_action_score_below_flash_threshold |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Songbird Lamb | 6 | 5 | segment_contains_low_detail_frame |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:GTA,BioShock,Red Dead
- do_not_rescan_same_official_sources_for:GTA,BioShock,Red Dead
- find_more_validated_gameplay_seconds_for_flash_lane

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- segment_action_score_below_flash_threshold: 2
- segment_samples_too_repetitive: 27
- segment_contains_black_frame: 20
- segment_contains_low_detail_frame: 21
- segment_lacks_gameplay_action_samples: 11
- segment_contains_weak_flash_sample: 1
- segment_sample_extract_failed: 4
- segment_contains_title_or_rating_card: 8

### Latest Render Forensic Warnings

- Issue codes: visual_repetition, rendered_frame_taste
- Repeat pair count: 7
- Repeat pair times: 4.5s/7.5s, 19.5s/22.5s, 19.5s/24s, 21s/24s, 45s/48s, 51s/54s, 55.5s/58.5s
- Weak rendered frame count: 3
- Weak rendered frames: 0s text_card_frame, 1.5s text_card_frame, 3s text_card_frame
- Rating/title frame count: 3

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
