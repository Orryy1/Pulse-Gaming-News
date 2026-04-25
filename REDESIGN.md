# Pulse Gaming Quality Redesign

Branch: `quality-redesign` (off `545c622`)
Status: planning + implementation
Scope: local-only, no production deploys, no main commits this session

## Problem statement

Production output (eg the GTA 6 / Take-Two video, the Ingrid / Street Fighter video) feels:

- slow and static (7–8s image holds, mechanical Ken Burns)
- weakly hooked (no punchy 0–3s opener; first 3s is silent visual loop)
- subtitle-drifting on longer stories (silent fallback to even-spacing when timestamps file isn't found)
- topically random in image choice (article og:image of a flooded cottage on a GTA 6 story)
- amateurish in caption styling (one font, one size, no per-keyword pop)
- broken for wide-shot framing (smart-crop disabled in hotfix; landscape art letterboxed with subjects at frame edges)

Audit cited specific file:line evidence for each weakness — see audit summary at the bottom of this doc.

## Targets

For a 50–70s Pulse Gaming Short:

- **Hook**: 0–3s lands a punchy headline + motion + opening line of narration in sync.
- **Pacing**: average cut every 2.5–4s. No image held >5s. At least 12 visual segments in a 60s video.
- **Motion**: every segment has motion (zoom, pan, push, or video-clip). Variety library, not 50/50 alternation.
- **Subtitles**: word-level timestamps mandatory; no silent fall-through to even-spacing for fresh stories.
- **Captions**: keyword emphasis (game names, money, dates, percentages) at 1.15× size + accent colour.
- **Image relevance**: every image scored against story keywords (title + body) before being rendered.
- **Subject framing**: smart-crop returns, this time ffmpeg-safe (PNG output + explicit colour-range hints).
- **Transitions**: mix of hard cuts (instant), short dissolves (0.2–0.3s), and the occasional slide.
- **Multi-image renderer works again**: smart-crop fix unblocks the filter graph regression.

## Files / functions to change

### Core pipeline

| File                            | Function / area                         | Change                                                                                                                                                     |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assemble.js`                   | `buildVideoCommand` (981)               | Replace static `segmentDuration` with dynamic per-image durations from a new pacing module; cap per-image hold at 5s; mix in 1–2 cut transitions per video |
| `assemble.js`                   | `generateSubtitles` (~400)              | Always require word-level timestamps for fresh stories; warn loudly if missing; per-phrase max-on-screen capped to 2.2s                                    |
| `assemble.js`                   | ASS style block (~945)                  | Add `Caption.Emphasis` style (1.15× scale, accent colour), wire keyword detector to emit Emphasis spans per phrase                                         |
| `assemble.js`                   | Per-image filter graph (1140–1170)      | Use new `buildPerImageMotion` from new `lib/motion.js` — drops mechanical `i % 2`/`i % 3` alternation                                                      |
| `assemble.js`                   | xfade loop (1180–1190)                  | Use new `buildTransitionStrategy` from `lib/transitions.js` — mixes cuts, 0.25s dissolves, occasional slides                                               |
| `assemble.js`                   | rawImages → images (1675)               | Re-enable smart-crop via the redesigned helper                                                                                                             |
| `lib/image-crop.js`             | `smartCropToReel`                       | Switch JPEG → PNG output (or guarantee standard JFIF); cache filename includes `_v2` suffix to bust stale entries; fail-safe still returns input           |
| `lib/hook-factory.js` (NEW)     | `composeOpenerOverlay(story)`           | Returns `{ headline, accent, durationMs }` for the 0–3s drawtext block                                                                                     |
| `lib/motion.js` (NEW)           | `buildPerImageMotion(slot, image)`      | Returns the per-image scale/crop/zoompan filter expression with varied energy                                                                              |
| `lib/transitions.js` (NEW)      | `buildTransitionStrategy(segmentCount)` | Returns an array of transition specs (cut / xfade-dissolve-0.25 / slide) for the rendering loop to consume                                                 |
| `lib/caption-emphasis.js` (NEW) | `splitWithEmphasis(phrase, story)`      | Returns ASS spans with the right style id, marking proper nouns / money / dates as `Emphasis`                                                              |
| `lib/relevance.js` (NEW)        | `rankImagesByRelevance(images, story)`  | Scores each image against story keywords; returns reordered list with low-relevance shots demoted (NOT excluded — fallbacks still work)                    |
| `images_download.js`            | post-fetch hook                         | Run `rankImagesByRelevance` after the existing source-priority sort                                                                                        |

### Test harness

| File                              | Purpose                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tools/quality-render.js` (NEW)   | Renders one local story id through the new pipeline into `test/output/after_<id>.mp4`                                    |
| `tools/quality-baseline.js` (NEW) | Renders the SAME story through `git stash` of new code (or via a bypass flag) into `test/output/before_<id>.mp4`         |
| `package.json`                    | Add `quality:test` script that runs both for the 3 chosen stories + dumps a comparison report to `test/output/REPORT.md` |

### Tests

| File                                            | Change                                                                                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/services/quality-redesign.test.js` (NEW) | Pin: hook factory invoked for fresh stories; subtitle generator throws when timestamps missing in strict mode; caption emphasis runs; smart-crop re-enabled; transitions array length matches segment count − 1 |
| `tests/services/ingrid-publish-fixes.test.js`   | Flip the "smart-crop NOT invoked" rollback pin back to "IS invoked" once the smart-crop fix lands                                                                                                               |

## Implementation order

1. **Smart-crop redesign + cache invalidation** — unblocks every other improvement (multi-image filter graph + subject framing depend on it).
2. **Hook factory** — biggest single retention improvement; fully orthogonal to other changes.
3. **Dynamic pacing** + **mixed transitions** — feed each other; better as one diff.
4. **Subtitle hardening** + **caption emphasis** — same code area; one diff.
5. **Image relevance scoring** — last because the pipeline needs to be otherwise stable to evaluate the impact.

## QA criteria for local comparison

Each pair of `before_<id>.mp4` / `after_<id>.mp4` is judged on:

- Time-to-first-cut (target: ≤2.5s in `after`)
- Number of visual segments in the first 30s (target: ≥6 in `after`)
- Total cuts in the full video (target: ≥12 for 60s)
- Subtitle drift at the 30s mark (visual eyeball — we'll add a side-by-side waveform if needed)
- Subject visibility (face/main object centred on each shot in `after`)
- Caption emphasis present on at least 3 keywords per video
- File size + bitrate (no regression > 50% larger for the same duration)

## Audit findings (summary, full detail in agent report)

1. `assemble.js:1025-1028` — `segmentDuration = Math.max(4, Math.floor(duration / visualPaths.length))` → static 7–8s holds.
2. `assemble.js:910` — hook is generic phrase split, no dedicated 0–3s opener.
3. `assemble.js:425-463` — silent fall-through to even-spacing when timestamps file missing.
4. `assemble.js:945-947` — single Caption style; no per-keyword emphasis.
5. `assemble.js:1181,1187` — fixed 0.5s dissolve every transition.
6. `assemble.js:1150-1169` — rigid `i % 2` zoom alternation, `i % 3` pan rotation.
7. `images_download.js:217-740` — source-priority ranking only; no relevance scoring.
8. `assemble.js:1665-1679` — smart-crop disabled by 545c622 hotfix.
9. Multi-image filter graph fails on `auto_scale_N`; root cause likely smart-crop chroma + filter-graph reconciliation (TBD).
10. Bitrate variance (1.3–2.5 Mbps) suggests `-crf 23 -preset fast` isn't tuned for portrait Reel content.

## What this branch deliberately does NOT change

- Production cron schedule
- Platform upload paths (TikTok/IG/FB/YT)
- Brand colour palette / channel config
- Voice ID / TTS settings (Liam at 0.80/0.80 stays)
- The redesigned smart-crop ships behind the existing fail-safe (returns original path if Sharp errors), so the ROLLBACK path remains the existing scale+pad
