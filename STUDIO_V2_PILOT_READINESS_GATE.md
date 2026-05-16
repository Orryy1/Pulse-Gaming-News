# Studio V2 Pilot Readiness Gate

This is a read-only synthesis report for Studio V2 pilot readiness.

Generated: 2026-05-16T07:47:32.837Z
Story: `rss_5b3abe925b27a199`
Title: GTA 6 Owner Passed On A Sequel To A Legacy Franchise, And We're Dying To Know Which One

## Verdict

Production default: `RED_BLOCKED`
Production default allowed: `no`
One-story pilot status: `blocked`

Studio V2 cannot become the production default while the selected proof and readiness reports still contain blockers.

## Production Default Blockers

- clean_one_story_promotion_packet_missing
- manual_one_story_pilot_approval_missing
- completed_one_story_pilot_metrics_missing
- promotion:qa_lane_unknown
- promotion:flash_lane_preflight_not_allowed
- promotion:preflight_flash_lane_requires_two_actual_clip_scenes
- promotion:preflight_flash_lane_clip_dominance_below_target
- promotion:preflight_flash_visual_requires_three_unique_clip_refs_for_60s
- promotion:preflight_flash_visual_not_enough_distinct_scene_beats
- promotion:forensic_warnings_remaining
- promotion:visual_repeat_pairs_remaining
- promotion:not_a_60s_local_proof_candidate
- promotion:voice_grade_unknown
- proof:approved_liam_audio_missing
- proof:footage_backbone_clip_dominance_too_low
- proof:flash_proof_requires_footage_backbone_dominance
- proof:flash_proof_blocks_wrong_story_exact_assets
- motion:flash_proof_requires_motion_backbone
- motion:flash_proof_requires_three_validated_clip_sources
- motion:footage_backbone_clip_dominance_too_low
- visual_repair:exact_subject_gameplay_still_repair
- visual_repair:exact_subject_gameplay_still_gap
- multi_story_regression_window_missing
- production_default_change_not_allowed_by_this_gate

## One-story pilot requires

| Requirement | Status | Detail |
| --- | --- | --- |
| clean_promotion_packet | block | requires a clean promotion packet with no blockers and MP4, contact sheet, QA and forensic evidence |
| approved_voice_evidence | block | requires approved Liam/Sleepy Liam audio evidence before any pilot |
| validated_motion_backbone | block | requires validated motion: at least three usable clip windows, three source families, entity coverage and no current motion-gap blockers |
| visual_repair_queue_clear | block | requires the visual repair queue to be clear before local proof rerender or pilot review |
| forensic_qa_clean | block | requires forensic warnings, repeat pairs, weak frames and rating/title frames to be repaired |
| manual_operator_approval | manual | requires explicit manual approval for exactly one story, one MP4, one contact sheet, QA evidence and rollback plan |

## Next Actions

- repair_or_regenerate_studio_v2_promotion_packet
- generate_approved_sleepy_liam_audio
- validate_motion_backbone_or_alternate_sources
- complete_visual_repair_plan
- repair_forensic_warnings
- rebuild_pilot_readiness_gate

## Evidence

- MP4: `unknown`
- Contact sheet: `unknown`
- QA JSON: `unknown`
- Forensic JSON: `unknown`

## Safety

- Do not switch production renderer.
- No posting or deployment action is performed.
- No Railway, OAuth, production DB, scheduler, renderer default, TTS or upload behaviour is changed.
- Legacy `assemble.js` remains the production rollback path.
