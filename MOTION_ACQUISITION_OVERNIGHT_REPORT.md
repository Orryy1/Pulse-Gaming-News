# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Summary

- Ready local Flash proofs: 0
- Blocked Flash proofs: 1
- Closest story: rss_5b3abe925b27a199
- Legacy Steam trailer URLs now backfill provider/app/movie metadata, so old validation scans show concrete source families instead of `unknown`.

## Guardrail Update

- Trailer rating-board references are filtered before planning.
- Segment validation rejects intro/rating/title windows before extraction when the start time or reference metadata is unsafe.
- Segment validation can resume from a previous local report, merge old/new scans and skip both already-sampled windows and exhausted source families.
- Steam CDN trailer URLs are parsed into source families such as `steam / 3240220 / Steam movie 832632`, making it clear when GTA or Red Dead needs alternate official sources instead of another scan of the same trailer.
- Current dry-run with previous scan merge skipped `28` already-sampled refs and `8` exhausted source-family refs for `rss_5b3abe925b27a199`.
- Current verdict for `rss_5b3abe925b27a199`: BioShock has two validated windows, but GTA has `51` failed attempts across `8` source families and Red Dead has `22` failed attempts across `2`, so both need alternate official source families before another Studio V2 proof render.
- This remains local/report-only. No production media, DB rows, Railway settings, OAuth state, render defaults or upload paths were changed.

## rss_5b3abe925b27a199

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_validated_entity_coverage, flash_proof_requires_exact_subject_entity_coverage
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 10
- Motion frames: 4
- Validated clip refs: 2
- Validated clip sources: 2
- Validated entities: BioShock
- Missing entities: GTA, Red Dead
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: fail (1 fail / 1 warn)

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: GTA, Red Dead
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | alternate_source_required | 51 | 0 | 8 | segment_samples_too_repetitive | find_alternate_official_source_family |
| BioShock | validated | 27 | 2 | 3 | segment_lacks_gameplay_action_samples | keep_as_validated_motion_source |
| Red Dead | alternate_source_required | 22 | 0 | 2 | segment_contains_black_frame | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| GTA | steam | 3240220 | Steam movie 832632 | 13 | 13 | segment_samples_too_repetitive |
| GTA | steam | 3240220 | Steam movie 840633 | 8 | 8 | segment_contains_low_detail_frame |
| GTA | steam | 3240220 | Steam movie 840621 | 5 | 5 | segment_contains_black_frame |
| GTA | steam | 3240220 | Steam movie 840623 | 5 | 5 | segment_contains_low_detail_frame |
| GTA | steam | 3240220 | Steam movie 840626 | 5 | 5 | segment_samples_too_repetitive |
| GTA | steam | 3240220 | Steam movie 840628 | 5 | 5 | segment_samples_too_repetitive |
| GTA | steam | 3240220 | Steam movie 840631 | 5 | 5 | segment_contains_title_or_rating_card |
| GTA | steam | 3240220 | Steam movie 840632 | 5 | 5 | segment_samples_too_repetitive |
| BioShock | steam | 8870 | Steam movie 10985 | 12 | 11 | segment_contains_black_frame |
| BioShock | steam | 8870 | Steam movie 10479 | 10 | 10 | segment_lacks_gameplay_action_samples |
| BioShock | steam | 8870 | Steam movie 10662 | 5 | 4 | segment_contains_title_or_rating_card |
| Red Dead | steam | 1174180 | Steam movie 254554 | 12 | 12 | segment_contains_black_frame |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:GTA,Red Dead
- do_not_rescan_same_official_sources_for:GTA,Red Dead
- find_one_more_validated_gameplay_clip_window
- find_one_more_validated_clip_source
- cover_missing_entities:GTA,Red Dead

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- segment_samples_too_repetitive: 28
- segment_lacks_gameplay_action_samples: 9
- segment_contains_low_detail_frame: 22
- segment_contains_black_frame: 25
- segment_contains_title_or_rating_card: 9
- segment_contains_weak_flash_sample: 1
- segment_action_score_below_flash_threshold: 1
- segment_sample_extract_failed: 3

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
