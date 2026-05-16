# Studio V2 Motion Gap Planner

This is local-only and report-only. It turns blocked Flash Lane proofs into concrete acquisition work.

## Summary

- Ready local Flash proofs: 1
- Blocked Flash proofs: 0
- Closest story: 1t0zhng

## 1t0zhng

- Title: LEGO Batman: Legacy of the Dark Knight PC specs revealed
- Recommendation: ready_for_local_flash_proof
- Blockers: clear
- Liam audio: approved_local_liam_audio_ready
- Exact assets: 24
- Motion frames: 18
- Validated clip refs: 13
- Validated clip sources: 3
- Projected clip dominance: 0.47
- Clip dominance shortfall: unknown
- Validated entities: LEGO Batman
- Missing entities: none
- Source coverage warnings: multi_entity_coverage_satisfied_by_validated_labels:Legacy of the Dark Knight
- Acquisition strategy: entity_motion_coverage_ready
- Latest render proof: pass (0 fail / 0 warn)

### Motion Backbone Gap

- Status: motion_backbone_ready
- Validated clip windows: 13 / 3+
- Validated source families: 3 / 3+
- Backbone actions:
  - motion_backbone_source_requirements_clear
- Source coverage warnings:
  - multi_entity_coverage_satisfied_by_validated_labels:Legacy of the Dark Knight

#### Validated Source Families

| Provider | App | Movie/source | Validated windows | Entities |
| --- | --- | --- | ---: | --- |
| steam | LEGO® Batman™: Legacy of the Dark Knight | The Joker Cinematic Trailer WW | 6 | LEGO Batman |
| steam | LEGO® Batman™: Legacy of the Dark Knight | Building the Legacy WW | 4 | LEGO Batman |
| steam | LEGO® Batman™: Legacy of the Dark Knight | Deluxe Edition Trailer WW | 3 | LEGO Batman |

### Acquisition Strategy

- Status: entity_motion_coverage_ready
- Alternate-source entities: none
- Unattempted entities: none
- Keep-sampling entities: none

| Entity | Status | Attempts | Validated | Source families | Top rejection | Recommendation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| LEGO Batman | validated | 364 | 13 | 6 | segment_lacks_gameplay_action_samples | keep_as_validated_motion_source |

#### Source families

| Entity | Provider | App | Movie/source | Attempts | Validated | Rejected | Top rejection |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Heroes & Villains Trailer WW | 61 | 0 | 61 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Launch Trailer WW | 60 | 0 | 60 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Reveal Trailer WW | 60 | 0 | 60 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Deluxe Edition Trailer WW | 61 | 3 | 58 | segment_samples_too_repetitive |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | Building the Legacy WW | 61 | 4 | 57 | segment_lacks_gameplay_action_samples |
| LEGO Batman | steam | LEGO® Batman™: Legacy of the Dark Knight | The Joker Cinematic Trailer WW | 61 | 6 | 55 | segment_lacks_gameplay_action_samples |

### Next Steps

- ready_for_local_flash_render_preflight

### Safe Commands

- run_local_flash_proof: `npm run studio:v2:still-deck -- --story 1t0zhng --audio "test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3" --timestamps "test/output/local-script-extension/audio/1t0zhng_liam_extended_timestamps.json" --frame-report "test/output/controlled_frame_extraction_worker_apply_local.json" --segment-validation-report "test/output/official_trailer_segment_validation_apply_local.json" --use-official-trailer-clips --with-sound-design`

### Segment Rejections

- segment_contains_low_detail_frame: 35
- segment_lacks_gameplay_action_samples: 182
- segment_contains_black_frame: 30
- segment_contains_title_or_rating_card: 12
- segment_sample_extract_failed: 18
- segment_samples_too_repetitive: 71
- segment_contains_weak_flash_sample: 3

## Safety

- No DB, Railway, OAuth, render-default or posting changes.
- No video render is started by this command.
- No trailer, browser, social or unofficial media download is started by this command.
