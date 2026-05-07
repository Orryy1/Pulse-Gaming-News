# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Guardrail Update

- PEGI/ESRB/rating-board resolver references are now skipped before deep-scan clip refs are created.
- Official trailer segments that start before 36s are now preflight-rejected before extraction.
- This directly targets repeated age-rating cards, title slates and weak trailer-opening material seen in the reviewed Studio V2 proof.
- No render defaults, production DB rows, Railway settings, OAuth state or social posting behaviour changed.

## Summary

- Ready local Flash proofs: 0
- Blocked Flash proofs: 20
- Closest story: 1szzhy9

## 1szzhy9

- Title: Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists
- Recommendation: do_not_render_yet
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 6
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: Marathon
- Latest render proof: warn (0 fail / 2 warn)

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- cover_missing_entities:Marathon

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1szzhy9`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1szzhy9`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1szzhy9 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1szzhy9 --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1szzhy9`

### Segment Rejections

- segment_samples_too_repetitive: 7
- segment_lacks_gameplay_action_samples: 6
- segment_contains_low_detail_frame: 1
- segment_contains_black_frame: 1
- segment_sample_extract_failed: 1

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
- Blockers: flash_proof_requires_motion_backbone, flash_proof_requires_three_validated_clip_refs, flash_proof_requires_three_validated_clip_sources, latest_render_forensic_warnings
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 10
- Motion frames: 0
- Validated clip refs: 0
- Validated clip sources: 0
- Validated entities: none
- Missing entities: GTA
- Latest render proof: fail (1 fail / 1 warn)

### Next Steps

- review_latest_render_forensic_warnings_before_pilot
- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- cover_missing_entities:GTA
- repair_motion_quality_before_next_proof

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_5b3abe925b27a199`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_5b3abe925b27a199`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_5b3abe925b27a199 --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_5b3abe925b27a199`

### Segment Rejections

- none

### Latest Render Forensic Warnings

- Issue codes: visual_repetition, rendered_frame_taste
- Repeat pair count: 7
- Repeat pair times: 4.5s/7.5s, 19.5s/22.5s, 19.5s/24s, 21s/24s, 45s/48s, 51s/54s, 55.5s/58.5s
- Weak rendered frame count: 3
- Weak rendered frames: 0s text_card_frame, 1.5s text_card_frame, 3s text_card_frame
- Rating/title frame count: 3

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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0u9o4`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0u9o4`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0u9o4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0u9o4 --apply-local --deep-scan`
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
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0x9ui`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0x9ui`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0x9ui --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0x9ui --apply-local --deep-scan`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story 1t0x9ui`

### Segment Rejections

- none

## 1t0zhng

- Title: LEGO Batman: Legacy of the Dark Knight PC specs revealed
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
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t186u4`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t186u4`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t186u4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t186u4 --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id 1t0w9nb`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id 1t0w9nb`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id 1t0w9nb --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id 1t0w9nb --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_0e2778be9f97ffa4`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_0e2778be9f97ffa4`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_0e2778be9f97ffa4 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_0e2778be9f97ffa4 --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_3831c03ef4eaf35c`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_3831c03ef4eaf35c`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_3831c03ef4eaf35c --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_3831c03ef4eaf35c --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_4105cb7c837252c3`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_4105cb7c837252c3`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_4105cb7c837252c3 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_4105cb7c837252c3 --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_4105cb7c837252c3`

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
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_93fdf53a0c1211ef`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_93fdf53a0c1211ef`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_93fdf53a0c1211ef --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_93fdf53a0c1211ef --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_9fb084475142f310`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_9fb084475142f310`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_9fb084475142f310 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_9fb084475142f310 --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_a110642aa97d0de9`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_a110642aa97d0de9`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_a110642aa97d0de9 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_a110642aa97d0de9 --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_a110642aa97d0de9`

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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_a8e7d56725bf20cc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_a8e7d56725bf20cc`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_a8e7d56725bf20cc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_a8e7d56725bf20cc --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_a8e7d56725bf20cc`

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
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_c3c6731708e35fc0`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_c3c6731708e35fc0`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_c3c6731708e35fc0 --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_c3c6731708e35fc0 --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_c3c6731708e35fc0`

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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_ca673f22ddbbbdfc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_ca673f22ddbbbdfc`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_ca673f22ddbbbdfc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_ca673f22ddbbbdfc --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_d795d8d622707d2c`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_d795d8d622707d2c`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_d795d8d622707d2c --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_d795d8d622707d2c --apply-local --deep-scan`
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
- Missing entities: none
- Latest render proof: not available

### Next Steps

- find_3_more_validated_gameplay_clip_windows
- find_3_more_validated_clip_sources
- acquire_exact_subject_images_or_official_motion_refs
- generate_approved_sleepy_liam_audio_after_visuals_are_ready

### Safe Commands

- resolve_more_official_trailer_refs: `npm run media:resolve-trailers -- --story-id rss_ef7e6e464509e0bc`
- plan_frame_sampling: `npm run media:plan-frames -- --story-id rss_ef7e6e464509e0bc`
- extract_safe_local_frames: `npm run media:extract-frames -- --story-id rss_ef7e6e464509e0bc --apply-local`
- validate_gameplay_clip_windows: `npm run media:validate-trailer-segments -- --story-id rss_ef7e6e464509e0bc --apply-local --deep-scan`
- refresh_local_audio_repair_queue: `npm run ops:local-media-repair -- --limit 20 --dry-run`
- generate_sleepy_liam_audio_locally_after_visuals_are_ready: `npm run ops:local-script-extension -- --apply-local-audio`
- recheck_flash_lane_readiness: `npm run studio:v2:proof-candidates -- --story rss_ef7e6e464509e0bc`

### Segment Rejections

- none

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
