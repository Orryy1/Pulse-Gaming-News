# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Summary

- Ready local Flash proofs: 0
- Blocked Flash proofs: 30
- Closest story: rss_5b3abe925b27a199

## rss_5b3abe925b27a199

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_exact_subject_entity_coverage
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 10
- Motion frames: 0
- Validated clip refs: 3
- Validated clip sources: 3
- Validated entities: GTA, BioShock
- Missing entities: Red Dead
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: fail (1 fail / 1 warn)

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: Red Dead
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | validated | 54 | 1 | 9 | segment_samples_too_repetitive | keep_as_validated_motion_source |
| BioShock | validated | 18 | 2 | 3 | segment_contains_low_detail_frame | keep_as_validated_motion_source |
| Red Dead | alternate_source_required | 18 | 0 | 2 | segment_contains_black_frame | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| GTA | steam | Grand Theft Auto V Enhanced | Agents of Sabotage | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Criminal Enterprises | 6 | 6 | segment_contains_black_frame |
| GTA | steam | Grand Theft Auto V Enhanced | Los Santos Tuners | 6 | 6 | segment_contains_low_detail_frame |
| GTA | steam | Grand Theft Auto V Enhanced | San Andreas Mercenaries | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Los Santos Drug Wars | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | The Chop Shop | 6 | 6 | segment_contains_title_or_rating_card |
| GTA | steam | Grand Theft Auto V Enhanced | Cluckin' Bell Farm Raid | 6 | 6 | segment_samples_too_repetitive |
| GTA | steam | Grand Theft Auto V Enhanced | Bottom Dollar Bounties | 6 | 6 | segment_contains_low_detail_frame |
| GTA | steam | Grand Theft Auto V Enhanced | A Safehouse in the Hills - NR | 6 | 5 | segment_lacks_gameplay_action_samples |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Icarus | 6 | 6 | segment_contains_low_detail_frame |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Songbird Lamb | 6 | 5 | segment_contains_low_detail_frame |
| BioShock | steam | BioShock Infinite | BioShock Infinite - False Shepherd | 6 | 5 | segment_contains_black_frame |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:Red Dead
- do_not_rescan_same_official_sources_for:Red Dead
- cover_missing_entities:Red Dead

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- segment_lacks_gameplay_action_samples: 10
- segment_contains_title_or_rating_card: 9
- segment_contains_black_frame: 18
- segment_contains_low_detail_frame: 19
- segment_samples_too_repetitive: 26
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

## 1szzhy9

- Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 6
- Motion frames: 0
- Validated clip refs: 2
- Validated clip sources: 1
- Validated entities: Marathon
- Missing entities: none
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: warn (0 fail / 2 warn)

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: Marathon
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Marathon | alternate_source_required | 63 | 2 | 10 | segment_lacks_gameplay_action_samples | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| Marathon | steam | Marathon | Marathon Gameplay Trailer | 9 | 7 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Marathon - Loop - EN | 6 | 6 | segment_samples_too_repetitive |
| Marathon | steam | Marathon | Marathon Pre-Order Story Trailer | 6 | 6 | segment_contains_low_detail_frame |
| Marathon | steam | Marathon | Marathon \| Reveal Cinematic Short - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Launch Cinematic - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Vision of Marathon \| Bungie ViDoc | 6 | 6 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Launch Gameplay Trailer | 6 | 6 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Marathon - Accolades - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Marathon - Cryo Unlock - EN | 6 | 6 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Marathon \| Official Announce Trailer | 6 | 6 | segment_lacks_gameplay_action_samples |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:Marathon
- do_not_rescan_same_official_sources_for:Marathon
- find_one_more_validated_gameplay_clip_window
- find_2_more_validated_clip_sources

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1szzhy9 --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1szzhy9 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1szzhy9 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1szzhy9 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1szzhy9`

### Segment Rejections

- segment_samples_too_repetitive: 9
- segment_lacks_gameplay_action_samples: 25
- segment_contains_low_detail_frame: 12
- segment_action_score_below_flash_threshold: 2
- segment_contains_weak_flash_sample: 1
- segment_contains_black_frame: 9
- segment_sample_extract_failed: 1
- segment_contains_title_or_rating_card: 2

### Latest Render Forensic Warnings

- Issue codes: visual_repetition, rendered_frame_taste
- Repeat pair count: 2
- Repeat pair times: 46.5s/49.5s, 55.5s/58.5s
- Weak rendered frame count: 2
- Weak rendered frames: 16.5s dead_dark_frame, 22.5s washed_low_detail_frame
- Rating/title frame count: 0

## 1t0u9o4

- Title: Don’t Expect Product Placement in GTA 6 — the CEO of Take-Two Says It Won't Do Real World Brand Partnerships Because 'All the Brands Are Made Up'
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: GTA
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:GTA
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:GTA

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0u9o4`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0u9o4 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0u9o4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0u9o4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0u9o4`

### Segment Rejections

- none

## 1t0x9ui

- Title: It's been a year since release and Oblivion Remastered is still broken- Digital Foundry
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0x9ui`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0x9ui --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0x9ui --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0x9ui --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0x9ui`

### Segment Rejections

- none

## 1t0zhng

- Title: LEGO Batman: Legacy of the Dark Knight PC specs revealed
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_validated_entity_coverage, flash_proof_requires_exact_subject_entity_coverage, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: LEGO Batman, Legacy of the Dark Knight
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: LEGO Batman, Legacy of the Dark Knight
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| LEGO Batman | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |
| Legacy of the Dark Knight | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:LEGO Batman,Legacy of the Dark Knight
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:LEGO Batman,Legacy of the Dark Knight

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0zhng`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0zhng --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0zhng --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0zhng`

### Segment Rejections

- none

## 1t186u4

- Title: Reggie says Nintendo stopped selling products on Amazon in the 2010s after they asked for financial support to undercut competitors' prices
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t186u4`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t186u4 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t186u4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t186u4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t186u4`

### Segment Rejections

- none

## rss_8ea7f2689732f31a

- Title: Even GTA 6's price needs to feel "reasonable", says Take-Two boss: hiking past $70 to match inflation "doesn’t make a whole lot of sense"
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: GTA
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:GTA
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:GTA

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_8ea7f2689732f31a`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_8ea7f2689732f31a --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_8ea7f2689732f31a --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_8ea7f2689732f31a --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_8ea7f2689732f31a`

### Segment Rejections

- none

## 1t0w9nb

- Title: Digital Foundry: Yup, Oblivion Remastered Is Still Broken a Year After Release
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Oblivion
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Oblivion
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Oblivion | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:Oblivion
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:Oblivion
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0w9nb`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0w9nb --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0w9nb --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0w9nb --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0w9nb`

### Segment Rejections

- none

## 1t1hyqc

- Title: Even tho I can’t download you. You will always be on my phone.
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t1hyqc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t1hyqc --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t1hyqc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t1hyqc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t1hyqc`

### Segment Rejections

- none

## rss_01cc6b918b00c9c7

- Title: As if Final Fantasy 14's free trial wasn't already generous enough, it now includes the best expansion in the entire game
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_01cc6b918b00c9c7`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_01cc6b918b00c9c7 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_01cc6b918b00c9c7 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_01cc6b918b00c9c7 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_01cc6b918b00c9c7`

### Segment Rejections

- none

## rss_0e2778be9f97ffa4

- Title: The next Tales Of remaster has leaked, and it's probably not what you're expecting
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Tales Of
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Tales Of
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Tales Of | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:Tales Of
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:Tales Of
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_0e2778be9f97ffa4`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_0e2778be9f97ffa4 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_0e2778be9f97ffa4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_0e2778be9f97ffa4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_0e2778be9f97ffa4`

### Segment Rejections

- none

## rss_3831c03ef4eaf35c

- Title: Invincible VS Global Release Times Confirmed
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Invincible VS
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Invincible VS
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Invincible VS | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:Invincible VS
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:Invincible VS
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_3831c03ef4eaf35c`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_3831c03ef4eaf35c --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_3831c03ef4eaf35c --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_3831c03ef4eaf35c --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_3831c03ef4eaf35c`

### Segment Rejections

- none

## rss_4105cb7c837252c3

- Title: A New The Division PC Game Is Out Right Now, And It's Free
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: The Division
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: The Division
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| The Division | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:The Division
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:The Division
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_4105cb7c837252c3`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_4105cb7c837252c3 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_4105cb7c837252c3 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_4105cb7c837252c3 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_4105cb7c837252c3`

### Segment Rejections

- none

## rss_6fd15f9180205706

- Title: Final Fantasy 7 Rebirth gets a surprise demo today, complete with progression carry-over on Xbox, Switch 2 and PC
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Final Fantasy 7 Rebirth
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Final Fantasy 7 Rebirth
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Final Fantasy 7 Rebirth | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:Final Fantasy 7 Rebirth
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:Final Fantasy 7 Rebirth
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_6fd15f9180205706`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_6fd15f9180205706 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_6fd15f9180205706 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_6fd15f9180205706 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_6fd15f9180205706`

### Segment Rejections

- none

## rss_8086accb94b7770f

- Title: Buried by Silksong, Atari's Adventure of Samsara gets 'relaunch' update
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_8086accb94b7770f`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_8086accb94b7770f --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_8086accb94b7770f --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_8086accb94b7770f --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_8086accb94b7770f`

### Segment Rejections

- none

## rss_8f0173cec5d5d66f

- Title: Get a Free 8BitDo Controller When You Buy the New Viture Beast XR/AR Glasses
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_8f0173cec5d5d66f`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_8f0173cec5d5d66f --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_8f0173cec5d5d66f --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_8f0173cec5d5d66f --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_8f0173cec5d5d66f`

### Segment Rejections

- none

## rss_93fdf53a0c1211ef

- Title: PlayStation Plus Free Games For May 2026 Revealed
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_93fdf53a0c1211ef`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_93fdf53a0c1211ef --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_93fdf53a0c1211ef --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_93fdf53a0c1211ef --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_93fdf53a0c1211ef`

### Segment Rejections

- none

## rss_9fb084475142f310

- Title: GTA 6 Price Commented On By Rockstar's Owner
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: GTA
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:GTA
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:GTA
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_9fb084475142f310`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_9fb084475142f310 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_9fb084475142f310 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_9fb084475142f310 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_9fb084475142f310`

### Segment Rejections

- none

## rss_a110642aa97d0de9

- Title: In the wake of $100 GTA 6 rumours, Take-Two still won't give an actual price, but says "our job is to charge way, way, way less of the value"
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: GTA
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:GTA
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:GTA
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_a110642aa97d0de9`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_a110642aa97d0de9 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_a110642aa97d0de9 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_a110642aa97d0de9 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_a110642aa97d0de9`

### Segment Rejections

- none

## rss_a4eb47e8dd7d1eb1

- Title: The CyberPowerPC RTX 5070 Gaming PC Drops to Just $1399 and Now Includes a Free Copy of Pragmata
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: The CyberPowerPC RTX 5070 Gaming PC
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: The CyberPowerPC RTX 5070 Gaming PC
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| The CyberPowerPC RTX 5070 Gaming PC | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:The CyberPowerPC RTX 5070 Gaming PC
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:The CyberPowerPC RTX 5070 Gaming PC
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_a4eb47e8dd7d1eb1`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_a4eb47e8dd7d1eb1 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_a4eb47e8dd7d1eb1 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_a4eb47e8dd7d1eb1 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_a4eb47e8dd7d1eb1`

### Segment Rejections

- none

## rss_a8e7d56725bf20cc

- Title: All The Evidence That GTA 6‘s Next Trailer Is Nearly Here
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: GTA
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:GTA
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:GTA
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_a8e7d56725bf20cc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_a8e7d56725bf20cc --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_a8e7d56725bf20cc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_a8e7d56725bf20cc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_a8e7d56725bf20cc`

### Segment Rejections

- none

## rss_b04c319be4e8e51d

- Title: The Steam controller release date may have been leaked online
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_b04c319be4e8e51d`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_b04c319be4e8e51d --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_b04c319be4e8e51d --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_b04c319be4e8e51d --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_b04c319be4e8e51d`

### Segment Rejections

- none

## rss_bfb13e642d536b03

- Title: The Blood of Dawnwalker gets a late summer release date, system requirements, and another, very Witchery, gameplay look-in
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_validated_entity_coverage, flash_proof_requires_exact_subject_entity_coverage, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA, The Blood of Dawnwalker
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: GTA, The Blood of Dawnwalker
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |
| The Blood of Dawnwalker | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:GTA,The Blood of Dawnwalker
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:GTA,The Blood of Dawnwalker
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_bfb13e642d536b03`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_bfb13e642d536b03 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_bfb13e642d536b03 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_bfb13e642d536b03 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_bfb13e642d536b03`

### Segment Rejections

- none

## rss_c3c6731708e35fc0

- Title: Marathon update just made Cryo Archive Sponsored Kits a weekly freebie
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_c3c6731708e35fc0`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_c3c6731708e35fc0 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_c3c6731708e35fc0 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_c3c6731708e35fc0 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_c3c6731708e35fc0`

### Segment Rejections

- none

## rss_c4cabfc862af7b64

- Title: Final Fantasy 7 Rebirth demo now available for Nintendo Switch 2 and Xbox
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Acquisition strategy: no_story_entities
- Latest render proof: not available

### Acquisition Strategy

- Status: no_story_entities
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_c4cabfc862af7b64`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_c4cabfc862af7b64 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_c4cabfc862af7b64 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_c4cabfc862af7b64 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_c4cabfc862af7b64`

### Segment Rejections

- none

## rss_ca673f22ddbbbdfc

- Title: Mega Mewtwo's Pokémon Go debut finally announced and Go Fest Global is free for all players
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Pokémon
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Pokémon
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Pokémon | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:Pokémon
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:Pokémon
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_ca673f22ddbbbdfc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_ca673f22ddbbbdfc --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_ca673f22ddbbbdfc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_ca673f22ddbbbdfc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_ca673f22ddbbbdfc`

### Segment Rejections

- none

## rss_d795d8d622707d2c

- Title: 'Eventually the slop will just fall to the bottom': Garry's Mod sequel launches to 'mixed' reviews, but Garry himself isn't worried about AI games on the main page
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Garry's Mod
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Garry's Mod
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Garry's Mod | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:Garry's Mod
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:Garry's Mod
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_d795d8d622707d2c`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_d795d8d622707d2c --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_d795d8d622707d2c --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_d795d8d622707d2c --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_d795d8d622707d2c`

### Segment Rejections

- none

## rss_ef7e6e464509e0bc

- Title: MindsEye Has a New Update and a Cheaper Price as Developer Launches Comeback Bid
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: MindsEye
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: MindsEye
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| MindsEye | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:MindsEye
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:MindsEye
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_ef7e6e464509e0bc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_ef7e6e464509e0bc --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_ef7e6e464509e0bc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_ef7e6e464509e0bc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_ef7e6e464509e0bc`

### Segment Rejections

- none

## rss_f1cfb0788a691037

- Title: House of the Dragon Season 3 Trailer and Launch Date Confirmed
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: House of the Dragon Season 3
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: House of the Dragon Season 3
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| House of the Dragon Season 3 | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:House of the Dragon Season 3
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:House of the Dragon Season 3
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_f1cfb0788a691037`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_f1cfb0788a691037 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_f1cfb0788a691037 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_f1cfb0788a691037 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_f1cfb0788a691037`

### Segment Rejections

- none

## rss_ff6860f012b8d600

- Title: PowerWash Simulator 2 Star Wars DLC Announced
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: PowerWash Simulator 2 Star Wars DLC
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: PowerWash Simulator 2 Star Wars DLC
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| PowerWash Simulator 2 Star Wars DLC | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

### Next Steps

- run_initial_segment_scan_for:PowerWash Simulator 2 Star Wars DLC
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- cover_missing_entities:PowerWash Simulator 2 Star Wars DLC
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_ff6860f012b8d600`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_ff6860f012b8d600 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_ff6860f012b8d600 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_ff6860f012b8d600 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_ff6860f012b8d600`

### Segment Rejections

- none

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
