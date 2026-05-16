# Studio V2 Media Repair Action Planner

Visual Evidence Repair Plan compatibility report.

Generated: 2026-05-16T10:45:38.438Z
Mode: read_only_repair_plan

## Summary

- Rows considered: 1
- Repair candidates: 1
- Cover dominated: 0
- Wrong-story assets: 0
- Unverified store assets: 0
- Motion evidence gap: 0
- Exact-subject gameplay-still repairs: 0
- Official source intake needed: 0
- Validated clip windows needed: 0
- Wrong-story deck rejections: 0
- Exhausted bad windows: 1
- Render-ready claims blocked without validated motion: 1

## Repair Queue

| Story | Primary action | Repair | Audio | Media score | Motion ready | Exact | Cover share | Alternate source | Next command |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| 1t0zhng: LEGO Batman: Legacy of the Dark Knight PC specs revealed | monitor | no_visual_repair_needed | ready | 270 | no | 24 | 0.333 | none | npm run studio:v2:proof-candidates -- --story 1t0zhng |

## Command Details

### 1t0zhng

Reason: No visual evidence repair blocker is currently visible.
Render recommendation: do_not_render_yet
Audio ready: yes
Media progress score: 270
Validated motion ready: no

Ranked actions:
- 1. exhausted_bad_windows (P0): Do not keep sampling rating cards, title cards, blurry or repetitive windows from the same source family.

Commands:
- rebuild_proof_candidates: `npm run studio:v2:proof-candidates -- --story 1t0zhng` (report_only)
- recheck_flash_state: `npm run studio:v2:flash-state -- --story 1t0zhng` (report_only)

## Safety

- This planner is read-only and writes reports only.
- Suggested apply-local commands are not executed by this planner.
- No Railway, OAuth, production DB, scheduler, renderer, TTS, upload or social posting behaviour is changed.
