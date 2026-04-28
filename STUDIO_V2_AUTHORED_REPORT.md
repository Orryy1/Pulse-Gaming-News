# Studio V2 Authored Variant Report

Pass run on `codex/studio-short-engine-v1` against canonical render `studio_v2_1sn9xhe.mp4`.

No merge, no deploy, no Railway, no production env changes.

## A. What changed

Two narrow-scope improvements were applied as a single env-gated variant (`STUDIO_V2_AUTHORED=true`):

### Improvement 1 — mid-video scene variety (Priority 1)

`tools/studio-v2-render.js → applySceneGrammarV2`: when the authored flag is set, the orchestrator scans for a redundant mid-late `clip.frame` scene (between 45% and 80% of slate length) and replaces it with a new `punch` slice drawn from the LEAST-USED clip source at a 0.15× duration offset (very early in the clip — different content from the existing 0.4× and 0.65× punches).

For 1sn9xhe this targeted slot 12 (`frame_mid_7`, a duplicate of `trailerframe_6_smartcrop_v2.jpg`) and replaced it with a `punch` from `1sn9xhe_clip_C.mp4` at startInSourceS=0.75s.

### Improvement 2 — one premium authored moment (Priority 2)

`lib/studio/v2/scene-grammar-v2.js → buildFreezeFrameScene` now accepts an `authored: true` option. When set, a 60ms full-frame white drawbox flash (`drawbox=...:color=white@0.85:enable='between(t,playInS,playInS+0.06)'`) is injected into the freeze-frame's filter chain at the freeze instant, before the caption stack. Reads as a deliberate photo-finish / shutter-snap beat rather than a still pause.

For 1sn9xhe this fires at slot 10's freeze-frame on the article hero with caption `SEVEN YEARS QUIET`.

### Code surface

- `lib/studio/v2/scene-grammar-v2.js`: added `authored` parameter to `buildFreezeFrameScene` (default `false`, no behaviour change for existing callers).
- `tools/studio-v2-render.js`: added a 5th transform block in `applySceneGrammarV2` gated by `transforms.authored`. Reads `STUDIO_V2_AUTHORED` env at the call site.

No new files. No new scene types. No new env-fanned features beyond the single authored gate. No architecture sprawl.

## B. New output file(s)

- `test/output/studio_v2_1sn9xhe_authored.mp4` — 54.17s, 10.03 MB, h264 high@4.0
- `test/output/1sn9xhe_studio_v2_authored.ass` — kinetic word-pop subtitles (40 events, identical to canonical)
- `test/output/1sn9xhe_studio_v2_authored_filter.txt` — full ffmpeg filter graph
- `test/output/1sn9xhe_studio_v2_authored_report.json` — quality gate v2 report
- `test/output/1sn9xhe_studio_v2_authored_seo.json` — SEO package (identical title/description/hashtags to canonical)

## C. Gauntlet comparison vs current canonical

Run via `npm run studio:v2:gauntlet`. Both candidates were measured on the same anchor.

| Metric                     | Canonical | Authored | Delta           |
| -------------------------- | --------: | -------: | --------------- |
| Gauntlet score             |   **100** |       77 | **−23**         |
| Studio lane                |      pass |     pass | same            |
| Forensic verdict           |  **pass** | **warn** | regressed       |
| Green hits                 |        13 |       12 | −1              |
| Amber trips                |         3 |        4 | +1              |
| Red trips                  |         0 |        0 | same            |
| sourceDiversity            |      0.88 |     0.81 | **−0.07**       |
| sceneVariety               |         9 |        9 | same            |
| clipDominance              |      0.69 |     0.69 | same            |
| beatAwarenessRatio         |      0.87 |     0.73 | **−0.14**       |
| motionDensityPerMin        |      16.9 |     16.6 | −0.3            |
| Integrated loudness (LUFS) |     −24.1 |    −24.3 | −0.2 (rounding) |
| Render duration            |    53.33s |   54.17s | +0.84s          |
| Grammar transforms count   |         4 |        6 | +2              |

**Forensic warning detail (authored only):**
`audio_recurrence` (severity: warn) — _"detected 4 matching cut-synchronous audio signatures."_ Same warning class that flagged `loudnorm14` as too aggressive in Codex's earlier gauntlet pass. Adding the extra cut from the early-clip punch created an additional cut-synchronous transient pattern the forensic detector picks up. Real regression, not a false positive.

### Other validation

- v2 robustness harness: **30 passed · 0 failed**
- `npm test`: **835 passed · 0 failed**
- `npm run build`: **passed** (standard Vite chunk-size warning unchanged)

## D. Honest verdict

**Did the authored variant materially improve the middle of the video?**
No. Slot 12 swapped a static frame with motion (genuinely different content) but the new punch slice draws from a clip already used in two other slots. The scene-variety dial moved sideways (sceneVariety stayed at 9 distinct types) while source diversity dropped from green (0.88) to amber (0.81). The visible mid-third of the slate now looks similar to canonical but with one more clip-C moment instead of one more trailerframe — that's a sideways trade, not a meaningful improvement.

**Did the premium moment actually help?**
No. The 60ms white shutter flash is theoretically a clean photo-finish beat, but in practice:

1. The flash fires for ~2 frames at 30fps. Most viewers will perceive it as a brief overexposure flicker, not a deliberate beat.
2. The forensic gauntlet now flags audio recurrence because the additional cut from improvement 1 triggered the cut-synchronous pattern detector. The shutter flash itself is silent (video-only) but the surrounding cut topology shifted enough to trigger.
3. The flash adds visual noise without an accompanying audio event, which makes it feel like a glitch rather than a designed moment. To work properly it would need a paired SFX cue, but adding SFX is voice/audio territory which this pass explicitly avoids.

**Does it now beat canonical?**
No. Canonical scores 100 / forensic pass / 13 green / 3 amber. Authored scores 77 / forensic warn / 12 green / 4 amber. Canonical wins on every measurable axis.

**If not, why not?**
Three reasons, in order of weight:

1. **The early-punch source was a clip already in the slate.** With only 3 trailer clips available, even picking the "least-used" still bumps that clip's frequency from 1 → 2, which mathematically reduces the unique-source ratio. The fix would require a SOURCE we haven't seen — something the local cache doesn't have for this story.
2. **The shutter flash is too short to read as authored.** 60ms is below the threshold where viewers register it as "intentional moment". A longer flash (200–300ms) would read but would also overexpose more of the freeze. Doing it properly needs a paired audio sting, which is out of scope for this pass.
3. **The freeze-frame already plays as the climactic beat in canonical.** The caption pop at the freeze instant is already the "premium moment" of the canonical slate. Adding a second flourish to the same beat is redundant and dilutes the existing one.

## E. Whether canonical should now be replaced or kept

**Keep canonical.** Do not promote `studio_v2_1sn9xhe_authored.mp4` to canonical. Do not merge the orchestrator authored-block code into the default render path.

The `authored` parameter on `buildFreezeFrameScene` is harmless (default false, no behaviour change for existing callers) and could be kept committed as a future-proofing hook. The orchestrator's authored transform block should remain uncommitted (working-tree probe only) since it produced a measurably worse result and committing it could mislead future runs.

Recommended action: revert the working-tree changes to `tools/studio-v2-render.js`. Optionally keep the `authored` parameter on `buildFreezeFrameScene` if a future pass wants to retest with a paired SFX sting and a longer flash duration.

The next genuinely useful improvement, based on what this probe revealed:

> **The single biggest gap is media inventory, not scene grammar.** With only 3 trailer clips available locally, every "add variety" attempt eventually cannibalises an existing source. The right next step is media acquisition — pulling additional B-roll (IGDB, archival footage, second-trailer slices) — so future variety transforms have genuinely fresh sources to draw from.

That's a media pipeline change, not a render engine change. Out of scope for this pass per the original instructions.

## Stopped here.

Not merged, not deployed, not promoted to canonical.
