# Studio Short Engine v1 Baseline

Generated locally on branch `codex/studio-short-engine-v1`, from `quality-redesign`.

## Existing prototype and harness files

- `tools/quality-render.js` renders legacy quality-redesign still-image outputs for one story.
- `tools/quality-test.js` renders three samples into baseline, v1 redesign and PRL comparison outputs.
- `tools/quality-prototype.js` is the first clip-first prototype for `1sn9xhe`.
- `tools/studio-prototype.js` is the typed-scene studio prototype harness.
- `test/output/` already contains legacy comparison renders, PRL renders, the first clip-first prototype and several studio iterations.

## Existing scene composer logic

- `lib/scene-composer.js` builds typed scenes, budgets 12 to 16 scenes by audio duration, prefers clips, inserts source, quote, release and takeaway cards, then applies anti-repeat passes.
- Current output for `1sn9xhe` is 16 scenes: 3 clip-backed scenes, 7 trailer-frame still scenes, 1 article hero scene and 5 cards.
- Existing weakness: the composer can still duplicate a source card and repeat one trailer frame. That is better than stock cycling but not a clean v1 result.

## Existing PRL modules

- `lib/prl-overlays.js` owns badge, source bug, lower-third, stat card, comment swoop and hot-take overlays.
- `lib/motion.js`, `lib/transitions.js`, `lib/hook-factory.js`, `lib/caption-emphasis.js`, `lib/image-crop.js` and `lib/relevance.js` provide the redesign support layer.
- PRL improved polish but remained visually close to a still slideshow when source media was weak.

## Existing HyperFrames experiment

- `experiments/hf-source/` contains a working HyperFrames source-card experiment.
- `experiments/hf-source/source-card.mp4` is already rendered and can be injected into the studio harness via `STUDIO_HF_SOURCE_CARD`.
- Evidence so far: HyperFrames is strongest for premium cards, not for the backbone. The ffmpeg backbone should stay in place for clips, stills and audio assembly.

## Existing subtitle and timing logic

- `lib/caption-emphasis.js` builds ASS captions from ElevenLabs or local timestamp shapes, groups 3 to 4 word phrases, keeps colons inside titles and realigns spoken number expansions back to script text where safe.
- It has a safety reset to avoid caption blackouts when script and audio desynchronise.
- `tools/studio-prototype.js` already passes a tightened script to caption generation for the local Liam-style fixture.

## Current local sample stories and assets

- `1sn9xhe` has the richest local prototype set: legacy audio, local Liam-style audio, article hero, six trailer frames, three trailer clip slices and multiple rendered comparison outputs.
- `1smsr12` has article imagery plus stock filler and no clips. It is useful for stock-suppression testing but not for this clip-first prototype.
- `1s4denn` has stronger topical stills than the others but no local trailer clips, so it is less useful for validating the clip-first architecture.

## Chosen sample story

Use `1sn9xhe` for Studio Short Engine v1.

Reason: it was the clearest previous stock-filler failure and now has enough local trailer-derived media to judge whether a clip-first backbone, stronger cards and better sound materially reduce the AI slideshow feel.
