# Studio V2.1 Baseline Note

Branch: `codex/pulse-tonight-v21-intelligence`
Story: `1sn9xhe` (Metro 2039 reveal)
Scope: local-only. No deploys, no Railway mutation, no publishing.

## Current Canonical Strength

The current Studio V2 canonical render is the benchmark to beat.

- Gauntlet score: 100
- Studio verdict: pass
- Forensic verdict: pass
- Source diversity: 0.88
- Beat-awareness ratio: 0.87
- SFX cues: 1
- HyperFrames cards: 5
- Scene grammar: cross-clip punches, freeze-frame and timeline card
- Subtitle status: pass in forensic QA
- Audio recurrence: pass in forensic QA

Canonical wins because it is disciplined. It uses the limited Metro source
inventory without over-cutting, keeps HyperFrames narrow to the card lane and
does not add decorative effects that confuse the audio or visual QA.

## Why The Previous Authored Probe Lost

The authored probe added an early punch and a shutter-style freeze flash.
It looked more complex but scored worse:

- Gauntlet score dropped from 100 to 77.
- Source diversity dropped from 0.88 to 0.81.
- Beat-awareness dropped from 0.87 to 0.73.
- Forensic QA moved from pass to warn.
- Audio recurrence was detected from the altered cut topology.

The flash read closer to flicker than authored craft. The extra punch reused
an already-used clip source, so it traded measured diversity for a minor visual
change.

## Tonight's True Bottleneck

The highest-risk bottleneck is not another normal card or another punch. The
current story has a thin media inventory. Any V2.1 authored moment must avoid
consuming additional clip or still sources unless a genuinely fresh source is
available.

The safe target for V2.1 is therefore:

- add sparse, content-aware hero emphasis over existing strong beats
- avoid scene-count churn
- avoid new SFX recurrence
- keep source diversity and beat-awareness at canonical levels
- reject candidates that regress against canonical

## Correct Code Surfaces

- `tools/studio-v2-render.js`: final orchestration, scene timing and output
  report augmentation.
- `lib/studio/v2/hero-moments-v21.js`: new V2.1-only hero moment planning and
  final-video edge overlay filter.
- `lib/studio/v2/studio-rejection-gate-v21.js`: deterministic pass/review/reject
  gate calibrated against canonical, authored and synthetic failures.
- `tools/studio-v21-render.js`: local convenience wrapper for the V2.1 render.
- `tools/studio-v21-gate.js`: local gate report writer.

The previous authored block in `tools/studio-v2-render.js` remains a known-bad
experiment and must not be reused for the default V2.1 path.
