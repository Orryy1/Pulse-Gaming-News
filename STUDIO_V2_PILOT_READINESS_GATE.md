# Studio V2 Pilot Readiness Gate

This is a read-only synthesis report for Studio V2 pilot readiness.

Generated: 2026-05-17T12:40:33.236Z
Story: `1t0zhng`
Title: LEGO Batman: Legacy of the Dark Knight PC specs revealed

## Verdict

Production default: `AMBER_PILOT_REVIEW_ONLY`
Production default allowed: `no`
One-story pilot status: `ready_for_manual_approval`

A clean local proof can move to manual one-story pilot review only; production default still needs approval, live pilot metrics and a regression window.

## Production Default Blockers

- manual_one_story_pilot_approval_missing
- completed_one_story_pilot_metrics_missing
- multi_story_regression_window_missing
- production_default_change_not_allowed_by_this_gate

## One-story pilot requires

| Requirement | Status | Detail |
| --- | --- | --- |
| clean_promotion_packet | pass | clean promotion packet exists for 1t0zhng |
| approved_voice_evidence | pass | approved Liam voice evidence is present |
| validated_motion_backbone | pass | validated motion backbone is clear for the selected story |
| visual_repair_queue_clear | pass | visual repair queue has no blocking row for the selected story |
| forensic_qa_clean | pass | forensic QA has no remaining fail, warning or repeat-pair blockers |
| manual_operator_approval | manual | requires explicit manual approval for exactly one story, one MP4, one contact sheet, QA evidence and rollback plan |

## Next Actions

- queue_manual_one_story_pilot_decision
- attach_evidence_to_morning_approval_queue
- do_not_switch_production_renderer

## Evidence

- MP4: `test/output/studio-v2-still-deck/studio_v2_1t0zhng_enriched.mp4`
- Contact sheet: `test/output/studio-v2-still-deck/1t0zhng_enriched_contact_sheet.jpg`
- QA JSON: `test/output/studio-v2-still-deck/1t0zhng_enriched_qa.json`
- Forensic JSON: `test/output/studio-v2-still-deck/qa_forensic_1t0zhng_enriched_report.json`

## Safety

- Do not switch production renderer.
- No posting or deployment action is performed.
- No Railway, OAuth, production DB, scheduler, renderer default, TTS or upload behaviour is changed.
- Legacy `assemble.js` remains the production rollback path.
