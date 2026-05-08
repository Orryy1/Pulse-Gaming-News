# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Summary

- Ready local Flash proofs: 0
- Blocked Flash proofs: 10
- Closest story: rss_5b3abe925b27a199

## rss_5b3abe925b27a199

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, footage_backbone_clip_dominance_too_low, flash_proof_requires_footage_backbone_dominance
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 26
- Motion frames: 1
- Validated clip refs: 6
- Validated clip sources: 5
- Projected clip dominance: 0.3
- Validated entities: BioShock, Red Dead, GTA
- Missing entities: none
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: fail (1 fail / 1 warn)

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: BioShock, Red Dead
- Unattempted entities: none
- Keep-sampling entities: GTA

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | keep_sampling | 7 | 1 | 2 | segment_samples_too_repetitive | find_additional_validated_clip_window_for_existing_entity |
| BioShock | alternate_source_required | 20 | 3 | 3 | segment_contains_low_detail_frame | find_alternate_official_source_family |
| Red Dead | alternate_source_required | 25 | 2 | 4 | segment_contains_black_frame | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| GTA | steam | Grand Theft Auto V Enhanced | A Safehouse in the Hills - NR | 6 | 5 | segment_lacks_gameplay_action_samples |
| GTA | steam | 3240220 | Steam movie 832632 | 1 | 1 | segment_samples_too_repetitive |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Icarus | 6 | 6 | segment_contains_low_detail_frame |
| BioShock | steam | 8870 | Steam movie 10985 | 8 | 6 | segment_action_score_below_flash_threshold |
| BioShock | steam | BioShock Infinite | BioShock Infinite - Songbird Lamb | 6 | 5 | segment_contains_low_detail_frame |
| Red Dead | steam | Red Dead Redemption 2 | RDR2 Launch Trailer (GB) | 6 | 6 | segment_contains_black_frame |
| Red Dead | steam | 1174180 | Steam movie 254554 | 7 | 6 | segment_contains_black_frame |
| Red Dead | steam | Red Dead Redemption 2 | RDR2 Launch Trailer (DE) | 6 | 6 | segment_contains_black_frame |
| Red Dead | steam | Red Dead Redemption 2 | RDR2 60 FPS Trailer (DE) | 6 | 5 | segment_contains_black_frame |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:BioShock,Red Dead
- do_not_rescan_same_official_sources_for:BioShock,Red Dead
- find_more_validated_gameplay_seconds_for_flash_lane

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199 --no-latest-report --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- segment_action_score_below_flash_threshold: 2
- segment_samples_too_repetitive: 3
- segment_contains_black_frame: 18
- segment_contains_low_detail_frame: 11
- segment_lacks_gameplay_action_samples: 9
- segment_contains_weak_flash_sample: 1
- segment_sample_extract_failed: 2

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
- Blockers: flash_proof_requires_motion_backbone, footage_backbone_clip_dominance_too_low, flash_proof_requires_footage_backbone_dominance
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 6
- Motion frames: 0
- Validated clip refs: 13
- Validated clip sources: 8
- Projected clip dominance: 0.42
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
| Marathon | alternate_source_required | 160 | 13 | 10 | segment_samples_too_repetitive | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| Marathon | steam | Marathon | Marathon - Loop - EN | 16 | 16 | segment_samples_too_repetitive |
| Marathon | steam | Marathon | Marathon \| Official Announce Trailer | 16 | 16 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Marathon \| Reveal Cinematic Short - EN | 16 | 15 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Vision of Marathon \| Bungie ViDoc | 16 | 15 | segment_contains_black_frame |
| Marathon | steam | Marathon | Marathon - Accolades - EN | 16 | 15 | segment_samples_too_repetitive |
| Marathon | steam | Marathon | Marathon Gameplay Trailer | 16 | 14 | segment_samples_too_repetitive |
| Marathon | steam | Marathon | Marathon Pre-Order Story Trailer | 16 | 14 | segment_contains_black_frame |
| Marathon | steam | Marathon | Launch Cinematic - EN | 16 | 14 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Launch Gameplay Trailer | 16 | 14 | segment_lacks_gameplay_action_samples |
| Marathon | steam | Marathon | Marathon - Cryo Unlock - EN | 16 | 14 | segment_samples_too_repetitive |

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_alternate_official_sources_for:Marathon
- do_not_rescan_same_official_sources_for:Marathon
- find_more_validated_gameplay_seconds_for_flash_lane

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1szzhy9 --no-latest-report --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1szzhy9 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1szzhy9 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1szzhy9 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1szzhy9`

### Segment Rejections

- segment_samples_too_repetitive: 44
- segment_lacks_gameplay_action_samples: 44
- segment_contains_low_detail_frame: 18
- segment_action_score_below_flash_threshold: 3
- segment_contains_weak_flash_sample: 3
- segment_contains_black_frame: 28
- segment_sample_extract_failed: 4
- segment_contains_title_or_rating_card: 3

### Latest Render Forensic Warnings

- Issue codes: visual_repetition, rendered_frame_taste
- Repeat pair count: 2
- Repeat pair times: 46.5s/49.5s, 55.5s/58.5s
- Weak rendered frame count: 2
- Weak rendered frames: 16.5s dead_dark_frame, 22.5s washed_low_detail_frame
- Rating/title frame count: 0

## 1t0zhng

- Title: LEGO Batman: Legacy of the Dark Knight PC specs revealed
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_sources, footage_backbone_clip_dominance_too_low, flash_proof_requires_validated_entity_coverage, flash_proof_requires_exact_subject_entity_coverage
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 12
- Motion frames: 0
- Validated clip refs: 3
- Validated clip sources: 1
- Projected clip dominance: 0.16
- Validated entities: LEGO Batman
- Missing entities: Legacy of the Dark Knight
- Acquisition strategy: needs_first_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: needs_first_segment_scan
- Alternate-source entities: none
- Unattempted entities: Legacy of the Dark Knight
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| LEGO Batman | validated | 30 | 3 | 5 | segment_lacks_gameplay_action_samples | keep_as_validated_motion_source |
| Legacy of the Dark Knight | not_sampled | 0 | 0 | 0 | none | run_initial_segment_scan |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Launch Trailer WW | 6 | 6 | segment_contains_low_detail_frame |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Reveal Trailer WW | 6 | 6 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Heroes & Villains Trailer WW | 6 | 6 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Building the Legacy WW | 6 | 6 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | The Joker Cinematic Trailer WW | 6 | 3 | segment_lacks_gameplay_action_samples |

### Next Steps

- run_initial_segment_scan_for:Legacy of the Dark Knight
- find_2_more_validated_clip_sources
- find_more_validated_gameplay_seconds_for_flash_lane
- cover_missing_entities:Legacy of the Dark Knight

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0zhng --no-latest-report`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0zhng --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0zhng --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0zhng`

### Segment Rejections

- segment_contains_low_detail_frame: 4
- segment_lacks_gameplay_action_samples: 21
- segment_contains_black_frame: 1
- segment_contains_title_or_rating_card: 1

## rss_0e2778be9f97ffa4

- Title: The next Tales Of remaster has leaked, and it's probably not what you're expecting
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_clip_dominance_too_low
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 6
- Motion frames: 0
- Validated clip refs: 1
- Validated clip sources: 1
- Projected clip dominance: 0.04
- Validated entities: Tales Of
- Missing entities: none
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: not available

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: Tales Of
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Tales Of | alternate_source_required | 12 | 1 | 2 | segment_samples_too_repetitive | find_alternate_official_source_family |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| Tales Of | steam | Tales of the Shire: A The Lord of The Rings™ Game | Tales of the Shire - Available Now | 6 | 6 | segment_samples_too_repetitive |
| Tales Of | steam | Tales of the Shire: A The Lord of The Rings™ Game | Tales of the Shire - Gameplay Trailer | 6 | 5 | segment_lacks_gameplay_action_samples |

### Next Steps

- find_alternate_official_sources_for:Tales Of
- do_not_rescan_same_official_sources_for:Tales Of
- find_2_more_validated_gameplay_clip_windows
- find_2_more_validated_clip_sources
- find_more_validated_gameplay_seconds_for_flash_lane
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_0e2778be9f97ffa4 --no-latest-report --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_0e2778be9f97ffa4 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_0e2778be9f97ffa4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_0e2778be9f97ffa4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_0e2778be9f97ffa4`

### Segment Rejections

- segment_samples_too_repetitive: 6
- segment_lacks_gameplay_action_samples: 4
- segment_contains_weak_flash_sample: 1

## rss_4105cb7c837252c3

- Title: A New The Division PC Game Is Out Right Now, And It's Free
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_clip_dominance_too_low
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 12
- Motion frames: 0
- Validated clip refs: 1
- Validated clip sources: 1
- Projected clip dominance: 0.08
- Validated entities: Division
- Missing entities: The Division
- Acquisition strategy: continue_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: continue_segment_scan
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: The Division

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| The Division | keep_sampling | 6 | 0 | 1 | segment_contains_black_frame | continue_segment_scan_with_resume |
| Division | validated | 30 | 1 | 5 | segment_contains_low_detail_frame | keep_as_validated_motion_source |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| The Division | steam | The Division 2 - Warlords of New York - Expansion | Trailer | 6 | 6 | segment_contains_black_frame |
| Division | steam | Tom Clancy’s The Division® 2 | Gameplay Trailer | 6 | 6 | segment_samples_too_repetitive |
| Division | steam | Tom Clancy’s The Division® 2 | WONY Launch | 6 | 6 | segment_contains_low_detail_frame |
| Division | steam | Tom Clancy’s The Division® 2 | Gamescom Trailer | 6 | 6 | segment_contains_low_detail_frame |
| Division | steam | Tom Clancy’s The Division® 2 | Battle for Brooklyn Trailer | 6 | 6 | segment_contains_low_detail_frame |
| Division | steam | Tom Clancy’s The Division® 2 | Rise Up Trailer | 6 | 5 | segment_lacks_gameplay_action_samples |

### Next Steps

- find_2_more_validated_gameplay_clip_windows
- find_2_more_validated_clip_sources
- find_more_validated_gameplay_seconds_for_flash_lane
- cover_missing_entities:The Division
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_4105cb7c837252c3 --no-latest-report`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_4105cb7c837252c3 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_4105cb7c837252c3 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_4105cb7c837252c3 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_4105cb7c837252c3`

### Segment Rejections

- segment_contains_black_frame: 6
- segment_lacks_gameplay_action_samples: 8
- segment_contains_low_detail_frame: 14
- segment_contains_title_or_rating_card: 3
- segment_sample_extract_failed: 1
- segment_contains_weak_flash_sample: 1
- segment_samples_too_repetitive: 2

## 1t0u9o4

- Title: Don’t Expect Product Placement in GTA 6 — the CEO of Take-Two Says It Won't Do Real World Brand Partnerships Because 'All the Brands Are Made Up'
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_entity_coverage_too_thin, footage_backbone_clip_dominance_too_low
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 17
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Projected clip dominance: 0
- Validated entities: none
- Missing entities: GTA
- Acquisition strategy: alternate_official_sources_required
- Latest render proof: not available

### Acquisition Strategy

- Status: alternate_official_sources_required
- Alternate-source entities: GTA
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| GTA | alternate_source_required | 48 | 0 | 8 | segment_samples_too_repetitive | find_alternate_official_source_family |

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

### Next Steps

- find_alternate_official_sources_for:GTA
- do_not_rescan_same_official_sources_for:GTA
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- find_more_validated_gameplay_seconds_for_flash_lane
- cover_missing_entities:GTA

### Safe Commands

- resolve_alternate_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0u9o4 --no-latest-report --segment-validation-report test/output/official_trailer_segment_validation_apply_local.json --exhausted-source-family-threshold 5`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0u9o4 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0u9o4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0u9o4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0u9o4`

### Segment Rejections

- segment_samples_too_repetitive: 24
- segment_contains_low_detail_frame: 10
- segment_contains_title_or_rating_card: 8
- segment_lacks_gameplay_action_samples: 2
- segment_sample_extract_failed: 2
- segment_contains_black_frame: 2

## 1t0x9ui

- Title: It's been a year since release and Oblivion Remastered is still broken- Digital Foundry
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_entity_coverage_too_thin, footage_backbone_clip_dominance_too_low
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 6
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Projected clip dominance: 0
- Validated entities: none
- Missing entities: Oblivion
- Acquisition strategy: continue_segment_scan
- Latest render proof: not available

### Acquisition Strategy

- Status: continue_segment_scan
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: Oblivion

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Oblivion | keep_sampling | 6 | 0 | 1 | segment_lacks_gameplay_action_samples | continue_segment_scan_with_resume |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | --- |
| Oblivion | steam | The Elder Scrolls IV: Oblivion Remastered | Launch Trailer | 6 | 6 | segment_lacks_gameplay_action_samples |

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- find_more_validated_gameplay_seconds_for_flash_lane
- cover_missing_entities:Oblivion

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0x9ui --no-latest-report`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0x9ui --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0x9ui --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0x9ui --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0x9ui`

### Segment Rejections

- segment_contains_low_detail_frame: 1
- segment_lacks_gameplay_action_samples: 3
- segment_contains_black_frame: 2

## 1t0w9nb

- Title: Digital Foundry: Yup, Oblivion Remastered Is Still Broken a Year After Release
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_entity_coverage_too_thin, footage_backbone_clip_dominance_too_low
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 6
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Projected clip dominance: 0
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
- find_more_validated_gameplay_seconds_for_flash_lane
- cover_missing_entities:Oblivion
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0w9nb --no-latest-report`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0w9nb --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0w9nb --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0w9nb --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0w9nb`

### Segment Rejections

- none

## 1t186u4

- Title: Reggie says Nintendo stopped selling products on Amazon in the 2010s after they asked for financial support to undercut competitors' prices
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_entity_coverage_too_thin, footage_backbone_clip_dominance_too_low, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Projected clip dominance: 0
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
- find_more_validated_gameplay_seconds_for_flash_lane
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t186u4 --no-latest-report`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t186u4 --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t186u4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t186u4 --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t186u4`

### Segment Rejections

- none

## 1t1hyqc

- Title: Even tho I can’t download you. You will always be on my phone.
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, footage_backbone_needs_three_validated_clip_windows, footage_backbone_needs_gameplay_action_clip_windows, footage_backbone_entity_coverage_too_thin, footage_backbone_clip_dominance_too_low, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Projected clip dominance: 0
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
- find_more_validated_gameplay_seconds_for_flash_lane
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t1hyqc --no-latest-report`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t1hyqc --trailer-references test/output/official_trailer_references_v1.json`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t1hyqc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t1hyqc --apply-local --deep-scan --reference-report test/output/official_trailer_references_v1.json --previous-validation-report test/output/official_trailer_segment_validation_apply_local.json --merge-previous --exhausted-source-family-threshold 5 --max-segments 90 --candidate-windows-per-source 6`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t1hyqc`

### Segment Rejections

- none

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
