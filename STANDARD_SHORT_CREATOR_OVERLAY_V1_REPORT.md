# Standard Short Creator Overlay v1

## What Was Built

Added a local, report-only overlay planner for standard Shorts.

It defines the creator-style treatment that should replace dull full-screen cards when a story is not ready for the full Flash Lane:

- one-line punch captions
- two-word caption chunks
- compact source badges
- in-image entity popups for games and franchises
- short micro cards instead of repeated full-screen cards
- fake Reddit overlay prevention for RSS-only text
- card-ratio downgrade before render

## Why It Matters

The latest Studio V2 proof showed the right direction, but the visual language was still too slow, card-heavy and flat. This planner gives the renderer a stricter standard-short contract before another proof is attempted.

## Command

```bash
npm run studio:v2:standard-overlay -- --fixture
```

Alias:

```bash
npm run ops:standard-overlay -- --fixture
```

Outputs:

- `test/output/standard_short_creator_overlay_v1.json`
- `test/output/standard_short_creator_overlay_v1.md`

## Safety Boundaries

- report-only
- no rendering
- no publishing
- no Railway changes
- no OAuth or token changes
- no production DB changes
- no Studio V2 production switch

## Current Verdict

This is safe to use as a local planning layer. It should be wired into a future proof render only after the footage backbone and approved voice path are also green.
