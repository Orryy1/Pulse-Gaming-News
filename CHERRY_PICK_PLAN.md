# Quality-redesign cherry-pick plan

Branch: `quality-redesign`
Status: **NOT for merge yet.** This document captures the safe, staged cherry-pick order that lands the redesign into `main` without breaking production. Each phase has explicit safety gates — DO NOT skip them.

---

## Hard rules

- **No bulk merge.** Never merge `quality-redesign` whole-cloth into `main`. Cherry-pick file-by-file in the order below.
- **No production deploys mid-phase.** Each phase ships as a single commit on `main`, deploys cleanly, and is observed for at least one publish window before the next phase begins.
- **No new env vars in phase 1–3.** New flags only enter from phase 4 onward, behind explicit feature gates.
- **No changes to TikTok upload code.** TikTok is awaiting an external audit; nothing in this plan touches `upload_tiktok.js`. The plan also does NOT modify `TIKTOK_PRIVACY_LEVEL` handling.
- **No changes to platform upload paths in phase 1–3.** This work is confined to `lib/`, `tests/`, and the .ass / filter-graph generation inside `assemble.js`. Upload code (`upload_youtube.js`, `upload_instagram.js`, `upload_facebook.js`, `publisher.js`) stays untouched until phase 5.
- **One-render smoke test before each `git push`.** After cherry-picking, run `npm run quality:test` locally — the redesigned modules MUST still render 3/3 against local fixtures, OR the cherry-pick gets rolled back before push.
- **Production smoke window.** After deploy, the next scheduled publish must produce a fresh public post AND a truthful Discord summary. Any failure = revert before the following window fires.

---

## Pre-flight (before any cherry-pick)

1. The current production produce + 14:00 UTC publish must produce **at least one fresh public post** off `545c622`. We need a baseline of "publishing works" before we change anything.
2. Confirm `output/final/<id>.mp4` has at least 3 fresh stories (from today's produce) with `exported_path` set in the DB.
3. Snapshot the SQLite DB: `railway ssh -- 'cp /data/pulse.db /data/pulse.db.preCherry-$(date +%Y%m%d)'`. Local-only, no S3 or external upload. Restorable in seconds via `cp` if needed.

If the pre-flight isn't green, **stop**. Cherry-picking on an unstable production base just compounds the unknowns.

---

## Phase 1 — Smart-crop fix (lowest risk, highest leverage)

**Files:**

- `lib/image-crop.js` (rewritten)
- `tests/services/quality-redesign.test.js` (subset — image-crop tests only)
- `tests/services/ingrid-publish-fixes.test.js` (flip the rollback pin from `doesNotMatch` back to `match` for `smartCropBatch(rawImages)` and `require('./lib/image-crop')`)
- `assemble.js` (re-enable the `smartCropBatch(rawImages)` call at the same site that 545c622 disabled)

**Why first:** the existing `_smartcrop.jpg` files in `/data/media/output/image_cache/` are STALE — they were produced by mozjpeg and carry the broken chroma metadata. The redesign uses a new cache key (`_smartcrop_v2.jpg`) so cherry-pick #1 sidesteps any cache-pollution concern.

**Safety gate:**

1. After cherry-pick, run `npm test` → must show 27/27 in the affected files.
2. Ssh to Railway, delete every legacy `_smartcrop.jpg` in `image_cache/` so the v2 path is freshly populated:
   `railway ssh -- "find /data/media/output/image_cache -name '*_smartcrop.jpg' -not -name '*_smartcrop_v2.jpg' -delete"` (manual operator action — DO NOT run this from a script in this branch).
3. After deploy, verify ONE produce cycle renders cleanly via the multi-image path (NOT just fallback). If multi-image still falls back 100%, the chroma fix isn't the only auto_scale_N cause — see phase 2.
4. If anything regresses, revert with `git revert <commit>` and redeploy.

**Expected wins:** subject framing (faces centred, not cropped to top-of-frame), and the "auto_scale_N: Failed to configure output pad" failure should drop dramatically. The `setrange=tv` change in phase 2 is the belt to the smart-crop's braces.

---

## Phase 2 — Motion library + setrange=tv (multi-image regression fix)

**Files:**

- `lib/motion.js` (new)
- `tests/services/quality-redesign.test.js` (motion tests only)
- `assemble.js` — replace the per-image filter loop (`buildVideoCommand`, lines 1140–1170 in legacy) with calls to `motion.buildPerImageMotion`. Keep the rest of the filter graph (xfade chain, drawtext stack, audio mixing) UNCHANGED.

**Safety gate:**

1. The `setrange=tv` prepend on every per-image input is the load-bearing change. Hypothesis: this fixes the prod `auto_scale_N` regression by giving the swscaler an explicit range hint instead of letting it fail negotiation between yuvj420p inputs and the rest of the graph.
2. After deploy, **the next produce cycle should show multi-image renders succeeding for the majority of stories** — not falling back to single-image. If fallback rate stays >50%, multi-image has an unrelated root cause and we revert.
3. The motion library produces visually different per-segment animation. Spot-check one render in a player before approving phase 3.

**Expected wins:** unblocks the multi-image filter graph in production, restores the slideshow-of-many-images experience that was rendering yuv444p before the encoder fix landed.

**Defer to phase 6:** the motion library's "first-segment is always pushInCentre" behaviour. In phase 2 we keep the existing slot 0 logic (whatever assemble.js does today) and only swap the per-image filter primitive. Hook punch comes later.

---

## Phase 3 — Caption emphasis + subtitle hardening

**Files:**

- `lib/caption-emphasis.js` (new)
- `tests/services/quality-redesign.test.js` (caption tests only)
- `assemble.js` — replace `generateSubtitles`'s ASS-building inline code with `captionEmphasis.buildAssFromTimestampsFile(...)`. **Critical:** wrap the call in a try/catch that falls back to the legacy generator on error — so a missing-timestamps story doesn't kill the whole produce cycle.

**Safety gate:**

1. The caption-emphasis module REFUSES silent fall-through to even-spacing. Production has stories with old `_timing.json` (char-level) instead of `_timestamps.json` (word-level). The cherry-pick MUST include the `charsToWords` conversion path so older stories don't blow up.
2. After deploy, eyeball one caption file (`/app/output/subs/<id>.ass`) for: (a) `Style: Caption,Impact,84,...` and `Style: Emphasis,Impact,96,...,&H001A6BFF,...` both present, (b) `Dialogue:` events with `\rEmphasis` switches on game names / numbers / dates.
3. Visually verify on one render: keywords should pop in amber, no caption stays on screen >2.2s.
4. Drift check: open the rendered MP4 + the original audio in a video player, scrub to 30s + 50s — captions should track the spoken word within 200ms.

**Expected wins:** subtitles stay synced to ElevenLabs word timestamps end-to-end, keyword emphasis lands. The "subtitles vanish at 49s" GTA 6 complaint should be fixed (the legacy fall-through to even-spacing was the cause).

---

## Phase 4 — Hook factory (additive, low-risk visual lift)

**Files:**

- `lib/hook-factory.js` (new)
- `tests/services/quality-redesign.test.js` (hook tests only)
- `assemble.js` — invoke `hookFactory.composeOpenerOverlay(story)` + `buildOpenerDrawtext(...)` and inject the drawtext fragments BEFORE the subtitle ASS overlay in the filter graph. This is purely ADDITIVE — nothing is removed.

**Safety gate:**

1. Phase 4 is the first phase that visibly changes how the video looks in the first 3 seconds. **Get the user's eyeball on a single rendered MP4 before deploy.**
2. The opener uses `text=` drawtext — escapelogic must handle apostrophes / colons / commas. The harness's `ffEscape` already does this; sanity-check with a story whose hook contains apostrophes (e.g., `1sn9xhe`'s "Metro 2039 — official trailer just dropped, and nobody expected this").
3. After deploy, the opener should fade in by 0.2s, hold to 2.6s, fade out by 3.0s. Width of the underline bar is roughly `accentText.length × 28px` — eyeball that the bar sits cleanly under the accent token (it's a heuristic, not perfect — accept it for v1).

**Expected wins:** punchy 0–3s headline reduces drop-off in the first 3 seconds (the YouTube algorithm's most-watched retention window).

**Acceptable cosmetic regression in v1:** the underline-under-accent positioning is centre-of-text-block, NOT directly under the actual accent word's pixel position. Fixing that requires drawtext text-overlay layering math which is out of scope for v1.

---

## Phase 5 — Image relevance ranking

**Files:**

- `lib/relevance.js` (new)
- `tests/services/quality-redesign.test.js` (relevance tests only)
- `images_download.js` — add a single post-fetch line: `images = rankImagesByRelevance(images, story);` after the source-priority sort completes.

**Safety gate:**

1. The output of `images_download.js` ALREADY has a `priority` field on each image entry. The cherry-pick assumes that — verify by reading the production `images_download.js` before applying. If the field name differs, adapt.
2. Relevance ranking is non-destructive: it REORDERS the existing image list, never excludes. The legacy fallback chain (article → Steam → Pexels → Bing) still produces an image even when nothing keyword-matches. Worst case: the ranking is a no-op for stories whose images don't share tokens with the title.
3. After deploy, log one full produce cycle's image-priority output: a story whose first image was previously a Pexels stock shot should now show a Steam keyart higher in the list IF the Steam keyart's filename contains the story's keywords.

**Expected wins:** "random man in a flooded cottage" disappearing from a GTA 6 story. Less topical drift across the board. **Note:** it does NOT solve relevance for stories where ZERO sources return a keyword match — that's an upstream image-search problem, not a ranking problem.

---

## Phase 6 — Mixed transitions (highest risk, save for last)

**Files:**

- `lib/transitions.js` (new)
- `tests/services/quality-redesign.test.js` (transition tests only)
- `assemble.js` — replace the xfade-everywhere loop with `transitions.buildTransitionStrategy` + `transitions.buildTransitionFilters`. **Behind an env flag**: `QUALITY_TRANSITIONS_MIX=true`. Default off. Existing behaviour unchanged when flag is absent.

**Why last:** the redesign's transitions module is the most invasive change to the filter graph (mixes concat with xfade, requires `fps=30` normalisation after every concat, tracks running duration with a stateful loop). This is the part most likely to surface unexpected ffmpeg / Railway / container quirks.

**Safety gate:**

1. New env var. Add it to Railway PRIVATELY first — set on a non-default channel if Pulse Gaming runs against multiple channels, OR roll out to one channel with the flag, watch a full publish cycle, then expand.
2. Watch closely for `auto_scale_N` resurfacing — concat changes timebase and our `fps=30,setpts=PTS-STARTPTS` normalisation is the fix. If concat outputs ever escape with timebase 1/1000000 into an xfade, every render past the third transition truncates silently (we hit this in the local harness; the test pin in `transitions.test.js` exists to prevent regression).
3. After deploy with flag ON, check one rendered MP4's segment count via ffprobe + visual scrub: should see hard cuts at the timestamps `transitionStrategy[0].offset` matches.

**Expected wins:** snappier video pacing, more cuts per minute, less dissolve blur.

**If anything goes wrong:** unset `QUALITY_TRANSITIONS_MIX` on Railway → behaviour reverts to legacy without code rollback. This is why phase 6 ships behind a flag.

---

## What deliberately stays on `quality-redesign` (NOT cherry-picked)

- `tools/quality-render.js` — local test harness. Never goes to production. Lives on the branch as the validation tool for future cherry-picks.
- `tools/quality-test.js` — same.
- `package.json` `quality:test` / `quality:render` scripts — same. Local-only.
- The 12-segment cap + 5s segment-duration arithmetic in `quality-render.js` — production has its own pacing logic in `assemble.js` (`segmentDuration = Math.max(4, Math.floor(duration / visualPaths.length))`). Any production pacing change is a separate, bigger conversation.

---

## Rollback playbook

| Phase | Rollback                                                                                  | Time-to-restore |
| ----- | ----------------------------------------------------------------------------------------- | --------------- |
| 1     | `git revert <smart-crop-commit>` + redeploy + delete `_smartcrop_v2.jpg` files            | ~5 min          |
| 2     | `git revert <motion-commit>` + redeploy                                                   | ~5 min          |
| 3     | `git revert <captions-commit>` + redeploy                                                 | ~5 min          |
| 4     | `git revert <hook-commit>` + redeploy (purely additive — pre-revert renders not affected) | ~5 min          |
| 5     | `git revert <relevance-commit>` + redeploy                                                | ~5 min          |
| 6     | `unset QUALITY_TRANSITIONS_MIX` on Railway → instant revert, no code change               | ~30 sec         |

DB migrations: none. No schema changes are introduced anywhere in this plan.

---

## What's not in this plan

- **Multi-image render fallback rate**: phase 2 should fix the auto_scale_N regression, restoring multi-image. If it doesn't, root-cause investigation continues separately — out of scope for this cherry-pick plan.
- **Premium Render Layer (intro/outro motion graphics, brand-treatment overlays, etc.)** — explicitly deferred per user instruction.
- **TikTok publishing changes** — explicitly deferred. The audit-pending workaround stays as-is.
- **Pacing redesign in production assemble.js** — production keeps its existing static `segmentDuration` until phase 6. The harness uses different pacing math but that's local-only.
- **Image-search expansion** (more sources, better queries) — out of scope. Relevance ranking only reorders what `images_download.js` already returns.
