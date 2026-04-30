# Tonight: Single-Image Fallback Render Forensic Note

**Date:** 2026-04-30 evening
**Context:** Today's 10:03 UTC publish ("The next Tales Of remaster has leaked") rendered as `legacy_single_image_fallback · class=fallback · visuals=8`. The Discord render summary correctly identified the lane and visual count but did not surface the root cause.

## What we know from the code path

`assemble.js` defaults `story.render_lane = "legacy_multi_image"` at the top of the produce loop (line 1794). The lane only switches to `legacy_single_image_fallback` inside a catch block at line 1915, which fires when the multi-image ffmpeg filter graph throws.

The catch handler logs the ffmpeg stderr tail to console (Railway logs):

```
[assemble] ⚠ Multi-image render FAILED for {id} ({n} images, {duration}s):
{errDetail}
[assemble] ⚠ Falling back to SINGLE IMAGE - video will be less engaging
```

But that tail was NOT persisted on the story row, so a forensic review after the fact required Railway log archaeology.

## What this commit fixes

`assemble.js` now stamps three new forensic fields on the story when the fallback fires:

- `render_fallback_reason` — last 400 chars of ffmpeg stderr (truncated for storage)
- `render_fallback_at` — ISO timestamp
- `render_fallback_visual_count` — how many visuals were available (so we can see "8 visuals available, fell back anyway")

These are surfaced through:

- `publisher.js` → `result.render_fallback_reason`
- `lib/job-handlers.js renderPublishSummary` → first 80 chars in the Discord render line

So the next fallback render produces a Discord post like:

```
Render: lane=legacy_single_image_fallback · class=fallback · visuals=8 ·
        fallback_reason="ffmpeg: complex filtergraph error: …"
```

## Why I am NOT changing render defaults tonight

Per the mission brief and the audit's "do not chase complexity before observation" guidance:

- Studio V2 is not in production; switching is a high-risk decision requiring approval.
- The multi-image filter graph is large and tuning it requires representative test data.
- We don't yet know the actual ffmpeg error from the Tales Of run because that fallback happened before this stamp existed.

## What to do tomorrow

1. Watch the next produce cycle (18:00 UTC). If a fallback fires, the new stamps will tell the operator what failed.
2. Run `npm run ops:publish-readiness` after the next publish — it now reads these fields.
3. If the multi-image graph fails repeatedly with the same error class, file a focused `assemble.js` fix as a separate PR. Until then, render defaults stay unchanged.

## Common candidates for the failure

Without the stamp data, plausible classes (rank-ordered by past incidents in the repo's commits):

1. **Filter-graph syntax error from sanitised filename** — a story whose ID contains characters that didn't escape correctly into the `-i` flag. Solution: per-input quoting.
2. **Image dimension mismatch** — one of the 8 images was a corrupt download that decoded to 0x0 dimensions, blowing up `scale=1080:1920`. The image-download cache trims sub-10KB files but doesn't validate Sharp can decode them.
3. **Duration/audio mismatch** — the audio is 49.7s but the filter graph was built for 50s, leading to ffmpeg's "queue overflow" or "buffer underrun" with the new codec build.
4. **Drawtext overlay encoding** — the title or one comment contained a character class our `sanitizeDrawtext` doesn't escape. Less likely after the entity decode + ascii fallback work shipped earlier.

The new `render_fallback_reason` stamp will pin which class it is on the next occurrence.
