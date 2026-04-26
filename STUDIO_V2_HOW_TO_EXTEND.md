# Studio v2 — how to extend

Practical recipes for the things you'll actually want to do.

---

## 1. Render against a new story

Prerequisites:

- A row in `data/pulse.db` for the storyId.
- Cached trailer at `output/video_cache/<id>_trailer.mp4` (and/or pre-sliced `<id>_clip_A.mp4`).
- Cached article hero at `output/image_cache/<id>_article.jpg`.
- Cached trailer frames at `output/image_cache/<id>_trailerframe_{1..6}.jpg`.

(These are produced by the existing v1 `node run.js produce` pipeline.)

Run:

```bash
# 1. Generate per-story HF cards (source/context/quote/takeaway)
node tools/studio-v2-build-cards.js <storyId>

# 2. Render the v2 prototype
STUDIO_V2_VOICE=production STUDIO_V2_SKIP_LLM=true STUDIO_V2_ALLOW_VOICE_FALLBACK=true \
  node tools/studio-v2-render.js <storyId>

# 3. Inspect
ffprobe test/output/studio_v2_<storyId>.mp4
cat test/output/<storyId>_studio_v2_report.json
```

If `viability.verdict` in the package is `reject`, the orchestrator aborts. The risk flags tell you why (no clips, thin still set, AI-tell in hook).

---

## 2. Override a card's content manually

If the auto-derived content is wrong (e.g. you want a curated quote line instead of the actual top reddit comment), use the per-card builders directly.

### Quote card

```bash
node tools/studio-v2-build-quote-card.js <storyId> "Your quote text here." "ATTRIBUTION" trailer
```

The `trailer` arg picks the kicker style (other options: `reddit`, `developer`, `press`).

### Source / context / takeaway

`tools/studio-v2-build-cards.js` runs all four content-derived builders. To override one, edit the per-story `experiments/hf-<kind>-<storyId>/index.html` directly and re-render with:

```bash
cd experiments/hf-<kind>-<storyId>
npx hyperframes lint
npx hyperframes render . -o ../../test/output/hf_<kind>_card_<storyId>.mp4 -f 30 -q standard
```

Then re-run `tools/studio-v2-render.js` — the lane will pick up the per-story render automatically.

---

## 3. Add a new HyperFrames card type

You want a new card scene type (say `card.poll` for a Reddit poll bar chart).

### a. Build the template composition

```bash
mkdir -p experiments/hf-poll/assets
cp experiments/hf-source/hyperframes.json experiments/hf-poll/
cp experiments/hf-source/assets/backdrop.jpg experiments/hf-poll/assets/
```

Write `experiments/hf-poll/meta.json`:

```json
{ "id": "hf-poll", "name": "hf-poll", "createdAt": "2026-04-26T00:00:00.000Z" }
```

Write `experiments/hf-poll/index.html` following the HyperFrames CLAUDE.md pattern:

- Wrap content in `<div data-composition-id="main" data-start="0" data-duration="4.0">`.
- Time-block content with `class="clip" data-start="0" data-duration="4.0" data-track-index="0"`.
- Register the GSAP timeline as `paused: true` on `window.__timelines["main"]`.

Lint and render:

```bash
cd experiments/hf-poll
npx hyperframes lint
npx hyperframes render . -o ../../test/output/hf_poll_card_v1.mp4 -f 30 -q standard
```

### b. Add the scene type to the composer

Edit `lib/scene-composer.js`, add to `SCENE_TYPES`:

```js
const SCENE_TYPES = {
  // ... existing types ...
  CARD_POLL: "card.poll",
};
```

Add to `CARD_TYPES` set so the no-adjacent-same-type-cards pass treats it correctly.

Decide where the slate inserts it — most likely as an alternative for the slot 50% mark instead of `card.quote` when poll data is available.

### c. Add a per-story builder

Open `lib/studio/v2/hf-card-builders.js` and add a `buildStoryPollCard({ storyId, ... })` function modelled on the existing four. Extend `deriveCardContent` to compute poll content from `pkg`.

### d. Wire into the lane

In `lib/studio/v2/premium-card-lane-v2.js`, extend `resolveCardAssetsV2` and the per-scene routing in `applyPremiumCardLaneV2`:

```js
} else if (scene.type === SCENE_TYPES.CARD_POLL) {
  kind = "poll";
  descriptor = assets.poll;
}
```

### e. Add a quality gate criterion (optional)

If poll cards have a quality dimension (e.g. minimum 2 options shown), add a grader to `lib/studio/v2/quality-gate-v2.js`.

### f. Add tests

In `tools/studio-v2-test-harness.js`, add a test group exercising the new derivation logic.

---

## 4. Add a new scene grammar type

Beyond punch / freeze / speed-ramp, you want (say) a `split-screen` scene that shows two clips side by side.

### a. Add the builder

In `lib/studio/v2/scene-grammar-v2.js`:

```js
function buildSplitScreenScene({ slot, sourceLeft, sourceRight, duration, fontOpt }) {
  // ... emit ffmpegInput (two -i flags) and ffmpegFilter ...
  return { sceneType: "split-screen", ffmpegInput, ffmpegFilter, duration, label, ...};
}
```

The convention: each grammar builder returns a self-contained `{ sceneType, ffmpegInput, ffmpegFilter, duration, label }` object. The orchestrator's `buildV2SceneInput` and `buildV2SceneFilter` use the embedded fields verbatim.

### b. Update `applySceneGrammarV2`

Decide when to insert your scene — for split-screen, probably when 2+ clips exist and the slate has a "comparison" beat. Add a transformer block alongside the existing punch / freeze / speed-ramp blocks.

### c. Update grading

Quality gate's `gradeClipDominance` already counts clip-derived scenes. Add `split-screen` to the type list in `quality-gate-v2.js`:

```js
const clipScenes = scenes.filter((s) =>
  ["clip", "punch", "speed-ramp", "freeze-frame", "clip.frame", "split-screen"].includes(...)
).length;
```

### d. Add tests

In `tools/studio-v2-test-harness.js`, add fixture tests for the new scene's content boundaries.

---

## 5. Tune the rubric

The pass/amber/red thresholds live in `lib/studio/v2/quality-gate-v2.js` — each grader has explicit `green` and `amber` predicates. Edit the thresholds, re-run the orchestrator, observe the verdict shift.

Document any threshold change in `STUDIO_V2_RUBRIC.md` so the schema stays the source of truth.

---

## 6. Add a new audio mix variation

`STUDIO_V2_SFX_MODE=full|minimal|off` controls SFX cue density. To add another mode (say `transition-only` — sting on cuts but skip the opener):

In `lib/studio/v2/sound-layer-v2.js` extend `buildSfxCueList`:

```js
if (process.env.STUDIO_V2_SFX_MODE === "transition-only") {
  // Skip opener sting; only emit on cuts
  cues.length = 0;
  // ... continue building from transitions ...
}
```

---

## 7. Wire the HF opener into the orchestrator

The HF opener (`experiments/hf-opener`) renders to `test/output/hf_opener_card_v1.mp4`. To use it instead of the ffmpeg opener:

### a. Add an env-gated branch in `applySceneGrammarV2` (or as a new transform):

```js
if (process.env.STUDIO_V2_USE_HF_OPENER === "true") {
  const opener = out[0];
  if (opener?.type === SCENE_TYPES.OPENER) {
    opener.prerenderedMp4 = path.join(
      ROOT,
      "test",
      "output",
      "hf_opener_card_v1.mp4",
    );
    opener.premiumLane = "hyperframes";
    opener.duration = 2.4; // HF opener composition duration
  }
}
```

### b. Update the composer to allocate a 2.4s duration for the opener slot when this env is set.

(As of v2, this is intentionally not enabled by default — the ffmpeg opener wins for stories with strong trailer clips.)

---

## 8. Run the test harness in CI

`tools/studio-v2-test-harness.js` exits non-zero on any failure. Wire it into CI as:

```yaml
# .github/workflows/studio-v2.yml
- run: node tools/studio-v2-test-harness.js
```

It does not require any external services (no DB, no TTS, no ffmpeg) — pure unit-level validation of the pure-JS modules.

---

## 9. Validate against multiple stories

The weekly scheduled task `studio-v2-rubric-validate` (see `.claude/scheduled-tasks/`) auto-picks the newest cached story and renders it, appending the result to `STUDIO_V2_RUBRIC_DISTRIBUTION.md` over time.

To validate manually across N stories:

```bash
for id in 1sn9xhe 1abc123 1def456; do
  node tools/studio-v2-build-cards.js $id
  STUDIO_V2_VOICE=production STUDIO_V2_SKIP_LLM=true \
    node tools/studio-v2-render.js $id
done
```

Each story's report ends up at `test/output/<id>_studio_v2_report.json`. Aggregate the verdicts to spot stories that consistently downgrade — those are your engine's failure modes worth fixing.

---

## 10. Reset the engine to v2 baseline

If something gets stuck:

```bash
# Remove all per-story HF caches and force regeneration
rm -rf experiments/hf-*-<storyId>
rm -f test/output/hf_*_card_<storyId>.mp4

# Force a fresh TTS render
STUDIO_V2_FORCE_TTS=true node tools/studio-v2-render.js <storyId>
```

The v2 modules in `lib/studio/v2/` are purely additive. To revert the entire v2 layer:

```bash
git checkout main -- lib/studio tools/  # or
rm -rf lib/studio/v2 tools/studio-v2-* experiments/hf-* STUDIO_V2_*
```

The v1 pipeline at `tools/studio-v1-render.js` keeps working unchanged.
