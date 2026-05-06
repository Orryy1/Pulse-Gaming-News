# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Summary

- Ready local Flash proofs: 1
- Blocked Flash proofs: 9
- Closest story: 1szzhy9

## 1szzhy9

- Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists
- Recommendation: ready_for_local_flash_proof
- Blockers: clear
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 6
- Motion frames: 9
- Validated clip refs: 7
- Validated clip sources: 5
- Validated entities: Marathon
- Missing entities: none
- Latest render proof: warn (0 fail / 2 warn)

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- ready_for_local_flash_render_preflight

### Safe Commands

- run_local_flash_proof: `npm run studio:v2:still-deck -- --story 1szzhy9 --audio "test/output/local-script-extension/audio/1szzhy9_liam_extended.mp3" --timestamps "test/output/local-script-extension/audio/1szzhy9_liam_extended_timestamps.json" --frame-report "test/output/controlled_frame_extraction_worker_apply_local.json" --segment-validation-report "test/output/official_trailer_segment_validation_apply_local.json" --use-official-trailer-clips --with-sound-design`

### Segment Rejections

- segment_contains_low_detail_frame: 17
- segment_lacks_gameplay_action_samples: 39
- segment_contains_title_or_rating_card: 10
- segment_contains_black_frame: 13
- segment_sample_extract_failed: 3
- segment_action_score_below_flash_threshold: 3
- segment_samples_too_repetitive: 18

### Latest Render Forensic Warnings

- Issue codes: visual_repetition, rendered_frame_taste
- Repeat pair count: 2
- Repeat pair times: 46.5s/49.5s, 55.5s/58.5s
- Weak rendered frame count: 2
- Weak rendered frames: 16.5s dead_dark_frame, 22.5s washed_low_detail_frame
- Rating/title frame count: 0

## rss_5b3abe925b27a199

- Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 10
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- cover_missing_entities:GTA

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- none

## 1t0zhng

- Title: 1t0zhng
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0zhng`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0zhng`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0zhng --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0zhng --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0zhng`

### Segment Rejections

- none

## rss_7945f462187bd7f8

- Title: rss_7945f462187bd7f8
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_7945f462187bd7f8`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_7945f462187bd7f8`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_7945f462187bd7f8 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_7945f462187bd7f8 --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_7945f462187bd7f8`

### Segment Rejections

- none

## rss_8ea7f2689732f31a

- Title: rss_8ea7f2689732f31a
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_8ea7f2689732f31a`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_8ea7f2689732f31a`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_8ea7f2689732f31a --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_8ea7f2689732f31a --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_8ea7f2689732f31a`

### Segment Rejections

- none

## rss_a23224b1ea49574e

- Title: rss_a23224b1ea49574e
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_a23224b1ea49574e`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_a23224b1ea49574e`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_a23224b1ea49574e --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_a23224b1ea49574e --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_a23224b1ea49574e`

### Segment Rejections

- none

## 1t1hyqc

- Title: 1t1hyqc
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t1hyqc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t1hyqc`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t1hyqc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t1hyqc --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t1hyqc`

### Segment Rejections

- none

## fixture_flash_ready

- Title: GTA 6 trailer evidence is stacking up
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: approved_local_liam_audio_missing
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id fixture_flash_ready`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id fixture_flash_ready`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id fixture_flash_ready --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id fixture_flash_ready --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story fixture_flash_ready`

### Segment Rejections

- none

## rss_4ff45649e69b89de

- Title: rss_4ff45649e69b89de
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_4ff45649e69b89de`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_4ff45649e69b89de`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_4ff45649e69b89de --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_4ff45649e69b89de --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_4ff45649e69b89de`

### Segment Rejections

- none

## rss_60b58c29a07be301

- Title: rss_60b58c29a07be301
- Recommendation: do_not_render_yet
- Blockers: approved_liam_audio_missing, flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, flash_proof_requires_four_exact_subject_assets
- Liam audio: local_liam_audio_not_flash_ready
- Exact assets: 0
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_60b58c29a07be301`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_60b58c29a07be301`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_60b58c29a07be301 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_60b58c29a07be301 --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_60b58c29a07be301`

### Segment Rejections

- none

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
