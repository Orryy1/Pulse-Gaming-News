# Flash Lane Footage Backbone v1

## Purpose

This build makes the Flash Lane decision explicit: a 61-75s TikTok-native Short needs a real footage backbone, not one good clip plus cover art and cards.

It reports whether a story has enough validated official trailer/gameplay windows before another Studio V2 proof render is attempted.

## What was built

- New report module: `lib/studio/v2/flash-lane-footage-backbone.js`.
- New command: `npm run studio:v2:footage-backbone`.
- Ops alias: `npm run ops:flash-footage`.
- Tests for downgrade, ready-state and readable Markdown.

## Current story result

Command:

```text
npm run studio:v2:footage-backbone -- --story rss_5b3abe925b27a199
```

Output:

- JSON: `test/output/flash_lane_footage_backbone_v1.json`
- Markdown: `test/output/flash_lane_footage_backbone_v1.md`

Verdict:

```text
downgrade_to_standard_short
```

Blockers:

- `footage_backbone_needs_three_validated_clip_windows`
- `footage_backbone_entity_coverage_too_thin`
- `footage_backbone_clip_dominance_too_low`

Inventory:

- planned frames: 12
- accepted frames: 5
- rejected frames: 7
- story entities: GTA, Red Dead, BioShock
- validated segments: 1
- validated entities: BioShock
- projected clip dominance: 0.08

Recommendation:

- find two more validated clip windows;
- cover GTA and Red Dead with validated footage or route the story away from Flash Lane;
- do not attempt another premium render for this story yet.

## Why this matters

This is the difference between an amateur-looking proof and a media-studio workflow. The system can now say:

```text
This story is interesting, but it does not have enough validated footage for a premium 60s Flash Lane Short.
```

That prevents bad renders instead of polishing them after the fact.

## Safety

- Report-only.
- No Railway changes.
- No OAuth changes.
- No production DB mutation.
- No social posting.
- No production render default changes.

## Validation

- Targeted footage-backbone tests: passed.
- Full `npm test`: passed, 1,728/1,728.
- `npm run build`: passed.

## Next build

Build `Flash Lane Overlay Director v1` after one of these is true:

- a story has at least three validated clip windows, or
- the standard-short path gets a separate card-led creator overlay system that does not pretend to be premium footage.

For now, the highest-value acquisition work is finding more official trailer/gameplay references per entity and validating multiple clip windows per story.
