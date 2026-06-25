# Repeat Source Policy v12 Report

Generated: 2026-06-25

## Result

The repeat-footage and fast-card issue has been fixed at the gate level. Generated segment variants from the same V4 clip can no longer be counted as distinct footage, and older final MP4s cannot be reused unless their manifests prove both repeat-free scene planning and readable HyperFrames/card cadence.

## Code Changes

- `tools/studio-v4-proof-render.js`: collapses generated `segment_direct_motion` variants to their parent V4 clip source.
- `lib/studio/v4/director-brain.js`: applies the same source-asset logic in director readiness while preserving genuinely distinct clip URLs.
- `lib/goal-production-render-materializer.js`: blocks reuse of existing final MP4s when current repeat/cadence evidence is missing.
- `lib/studio/v4/render-policy.js`: bumps the Visual V4 policy to `newsroom_repeat_free_readable_cards_v12`, making older v11 renders stale.

## Verification

- `node --test tests/services/studio-v4-proof-render.test.js`: passed.
- `node --test tests/services/studio-v4-director-brain.test.js`: passed.
- `node --test tests/services/goal-production-render-materializer.test.js`: passed.
- `node --test tests/services/goal-batch-packages.test.js`: passed after narrowing source normalisation.
- `node --test tests/services/goal-proof-package.test.js`: passed after narrowing source normalisation.
- `npm test`: 6,202 passed, 0 failed.
- `npm run build`: passed.
- `npm run ops:agent-rules`: passed.
- `npm run docs:doctor`: passed with only existing low-signal documentation advisories.

## Readiness Evidence

- `npm run ops:next-publish-candidates`: 0 candidates, 0 preflight pass, 536 live DB rows ignored by bridge-only authority.
- `npm run ops:goal-dry-run-publish`: 0 enabled-platform actions, no live publish plan.
- `npm run ops:publish-readiness`: RED because 11 repair-backlog items remain.
- `npm run ops:platform-doctor`: AMBER, with YouTube Shorts, Instagram Reels and Facebook Reels enabled and TikTok/X/Threads/Pinterest deferred.
- `npm run ops:render-health`: regenerated after the v12 policy change.

## Current Blockers

The system is now correctly holding candidates instead of posting weak/repeating videos. The remaining blockers are content-production blockers:

- additional official motion family required
- official source search required
- alternate official source required after segment validation was exhausted

## Safety

No manual publish, token/OAuth mutation, platform setting change, billing change or production DB mutation was performed.
