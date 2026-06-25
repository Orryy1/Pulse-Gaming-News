# Bounded Segment Validation v12 Report

Generated: 2026-06-25

## Result

The official/direct-motion repair lane no longer hangs on broad remote duration probes. Story-specific validation now scopes duration probing to the requested story, caps the number of probes and times out stalled probes. Shared `ffprobeDuration` is also bounded.

## Why This Matters

The repeat-free v12 gate correctly blocks repeated generated clip variants. To get back to reliable posting, the system needs real official/direct motion. Before this fix, one HLS/Steam probe could stall validation before it produced usable evidence.

## Live Repair Probe

- `rss_e45d2d74d88274eb`: 4 checked, 0 validated, 4 rejected as low-detail.
- `rss_3398672f3635f31a`: 6 checked, 0 validated, 6 rejected as low-detail.
- `rss_d11f5d1da0fcd86e`: 12 checked, 1 validated, 11 rejected.

Validated segment:

- Story: `rss_d11f5d1da0fcd86e`
- Source: `Cluckin' Bell Farm Raid`
- Motion class: `gameplay_action`
- Status: accepted into the V4 motion-pack manifest

The story remains blocked because one validated clip/family is not enough for a repeat-free production render.

## Verification

- `node --test tests/services/official-trailer-segment-validator.test.js tests/services/studio-media-acquisition-timeout.test.js`: 76 passed.
- `npm test`: 6,206 passed, 0 failed.
- `npm run build`: passed.
- `npm run ops:agent-rules`: passed.
- `npm run docs:doctor`: passed with only existing low-signal documentation advisories.

## Safety

No manual publish, external upload, OAuth/token mutation, platform setting change or production DB mutation was performed.

## Next

Continue source-motion repair using bounded validation. The current priority is to find at least one additional official source family for the GTA story and to repeat the bounded validator path across the remaining blocked stories.
