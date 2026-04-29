# Production Render Regression — Diagnosis

Generated: 2026-04-29T17:57Z (UTC) on branch `main` at commit `d2343a7`.

Read-only trace of tonight's incident across the seven reported symptoms. No code changed in this phase.

---

## A. Executive summary

Root cause is **not a single regression**. The seven symptoms split into three real bugs and one persistent expectation gap:

1. **HTML entities not decoded** — `sanitizeDrawtext` strips non-ASCII (line 967) AND never decodes HTML entities. So `&pound;22.99` from Reddit/RSS survives literally, and a properly decoded `£22.99` would be stripped down to `22.99` because `£` is outside `\x20-\x7E`. Real bug. Universal across drawtext overlays.
2. **Synthetic comment labelled as `u/Redditor`** — for RSS-sourced stories (this incident: `rss_ef7e6e464509e0bc` MindsEye, `rss_1b7c404fc657548f` Game Pass), `hunter.js:894` stamps the **RSS feed description** onto `story.top_comment`. `assemble.js:1270` then renders that text inside a Reddit-style overlay with author `Redditor`. The "comment" is a quoted RSS blurb, not a Reddit comment. Real bug.
3. **One-image render is the EXPECTED fallback for thin-inventory stories** — both affected stories show `downloaded_images_count = 0` from production /api/news. `assemble.js:1656` then uses `story.image_path` (the legacy 1080×1920 composite SVG) as a single Ken-Burns image. The render path itself is correct; the upstream image pipeline failed to fetch any visuals for these RSS stories. Real bug, but upstream of assemble.
4. **Outro card "missing"** — actually included in BOTH the main render path (line 1340) and the single-image fallback (line 1909). The outro file exists in repo (`branding/intro_outro_card.png`, 5.5MB, tracked). No `.dockerignore` exists, so `COPY . .` ships it. Most likely cause of "missing outro" is one of: (a) the visible video was the multi-image path with a render error before the outro overlay attached, (b) the outro card faded too late to be seen, (c) the user's perception of "missing" was the difference between the brand-card fade and the harder cut style they expect. Needs evidence, not a code fix yet.
5. **Only one comment block instead of multi** — `hunter.js:fetchTopComments(subreddit, postId, count=4)` exists and returns up to 4 comments. But `hunter.js:956` only stores `comments[0].body` as `story.top_comment`. The plural `story.comments` array is **never populated**. `assemble.js:1265-1271` checks `story.comments` first, falls back to single-element `[{body: top_comment, author: "Redditor"}]`. Multi-comment was never wired through; this is an old gap, not a regression.
6. **Premium Studio V2 / clip-first / HyperFrames quality layer not active** — confirmed in Session 1 audit: production renders via `assemble.js` (ffmpeg) only. Studio V2 modules under `lib/studio/v2/` are exclusively offline operator tooling. The HF thumbnail-builder is the only production touchpoint and only for the YouTube custom thumbnail, not the actual MP4. **This is not a regression — Studio V2 was never the production renderer.** Documenting expectation gap.
7. **Instagram IN_PROGRESS timeout** — already substantially improved by Codex/recurring-agent work since Session 1: `upload_instagram.js` now classifies the case as `pending_processing_timeout` (separate from generic failure), preserves `containerId` and `creationId`, marks `verify_later=true`. `lib/job-handlers.js` renders this as `accepted_processing` (`⏳`) instead of `failed`. The remaining gap is a delayed-verifier job that re-checks the container N hours later. Not blocking tonight.

---

## B. Affected jobs/stories traced

Both candidates pulled from the production /api/news queue (response shows `youtube_post_id=null` so neither has yet uploaded successfully through to YouTube — they're either pending the next publish window or already failed):

| story_id               | title                                                                                        | source | downloaded_images | exported_path | hf_thumbnail_path | render_path                             |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------ | ----------------- | ------------- | ----------------- | --------------------------------------- |
| `rss_ef7e6e464509e0bc` | "MindsEye Has a New Update and a Cheaper Price as Developer Launches Comeback Bid"           | RSS    | **0**             | none          | none              | n/a — not yet rendered or render failed |
| `rss_1b7c404fc657548f` | "Xbox drops Game Pass prices as Call of Duty officially exits service's Day One launch slat" | RSS    | **0**             | none          | none              | n/a — not yet rendered or render failed |

Both are RSS-sourced (the `rss_` id prefix). The pattern matches: RSS pipeline downloads less image metadata than Reddit posts because RSS feeds typically expose only one `og:image` per article and that image path may have failed to fetch or cache.

Logging gap: there's no per-story "what assets were rejected by thumbnail-safety" / "what fetches failed" structured log. The user can see `[assemble] using composite thumbnail (no real images available)` in stdout but it's not on the story row.

---

## C. Render-path finding

**Production renders via `assemble.js` (ffmpeg), end of story.**

- `publisher.js:produce()` → calls `audio()` → `images()` → `assemble()` → `generateStoryImages()` → `buildThumbnailsForApprovedStories()` → `logFormatRecommendationsForApprovedStories()`.
- `assemble.js:assemble()` walks approved+exportable stories, calls `buildVideoCommand()` to construct an ffmpeg filter graph + executes ffmpeg.
- The HF thumbnail builder (`lib/studio/v2/hf-thumbnail-builder.js`) is invoked AFTER assemble — but only to produce the 1280×720 JPEG used by `youtube.thumbnails.set`. It does NOT render the MP4.
- Studio V2 / canonical / V2.1 / clip-first / HyperFrames-for-the-video are NOT in the production produce flow. Only `lib/studio/v2/hf-thumbnail-builder` and `tools/studio-v2-analytics-loop` are wired into production (per Session 1's `grep -rn "require.*studio/v2"` audit).

So "premium quality layer not active" is a **promotion gap**, not a regression. Studio V2 is operator tooling only.

---

## D. One-image root cause

For the two affected stories: both have `downloaded_images = []` in the production canonical store. The renderer behaves correctly — `assemble.js:1656-1664`:

```js
const rawImages = realImages.length > 0
  ? realImages
  : compositeImageAbs ? [compositeImageAbs] : [];
if (rawImages.length === 0) { skip; continue; }
```

When `realImages` is empty but `story.image_path` (composite SVG) exists, the renderer uses the single composite for the entire duration. The result IS a 60s video of one composite. Functionally correct given the input. The bug is upstream:

- **RSS stories don't produce enough image hints** (typically only one `og:image`, sometimes none).
- **`images_download.js` doesn't aggressively re-fetch** when initial sources fail.
- **The thumbnail-safety filter** (added in Codex's recent PRs) may also be rejecting the few RSS-sourced article hero images that exist, especially when they look portrait-like.

The user is right that the system "is publishing one static image for 60+ seconds as if it's normal output." The fix is a **pre-publish visual-count gate** that refuses to upload a Short with fewer than N distinct real visuals (excluding the composite). That moves the failure from "boring upload" to "story stays in queue with `no_safe_visuals` reason" until images are acquired or it's manually approved.

---

## E. Outro root cause

Outro overlay is wired in BOTH render paths:

- Main multi-image: `assemble.js:1059-1064` checks `fs.pathExistsSync(OUTRO_CARD)` → adds the input slot. Lines 1340-1348 layer it as a fade-in over the last `OUTRO_DURATION=5` seconds.
- Single-image fallback: `assemble.js:1909-1925` does the same with `await fs.pathExists(OUTRO_CARD)` (async this time — there's an inconsistency).

Outro card file: `branding/intro_outro_card.png` exists, 5.5 MB, tracked, last modified 2026-04-05. No `.dockerignore` to filter it. So Railway should have it.

Possible reasons "outro looked missing":

1. **Fade-in too gradual** — 1.2s fade-in over a 5s window means the card is visually subtle; the user may have seen the brand text disappearing (line 1352: `brandEnable = lt(t,outroStart)`) but not perceived the new card. **Not a bug, but it's perceptually weak.**
2. **Render failed silently before outro** — possible if the multi-image pipeline errored. Would need the actual job's ffmpeg stderr.
3. **Single-image fallback fired and the bottom-stack overlays obscured it** — the fallback adds a brand-bar drawbox at `y=ih-200` (line 1816) that doesn't fade out. The outro card pads black around the centred image. The drawbox may sit over the outro card.

No metadata field currently stamps `outro_present` per render. **P0.2 should add that** — render-side stamp + a publish-time check.

---

## F. Comment / Reddit root cause

**Two real bugs here.**

### F.1. RSS description rendered as fake `u/Redditor` comment

`hunter.js:894`:

```js
top_comment: item.description || "",
```

For RSS feeds (IGN, GameSpot, Eurogamer, etc.) the `description` field is the article excerpt — not a Reddit comment, not a community quote, not editorial commentary. It's the publisher's own blurb.

Then `assemble.js:1265-1271`:

```js
const comments = Array.isArray(story.comments)
  ? story.comments
  : story.top_comment
    ? [{ body: story.top_comment, author: "Redditor", score: 0 }]
    : [];
```

The author defaults to literal string `"Redditor"`. So an RSS feed excerpt gets rendered with the badge `u/Redditor`. **That is a misleading fabrication**, even if accidental.

The fix is to track `comment_source_type` (e.g. `reddit_top_comment` / `rss_description` / `none`) on the story and only render the Reddit-style overlay when source is genuinely a Reddit comment. RSS stories should either:

- skip the comment overlay entirely; OR
- use a neutral "Source: <publisher>" overlay clearly distinct from a Reddit comment box.

### F.2. Multi-comment behaviour was never wired

`hunter.js:951-956` only stores `comments[0].body` even though `fetchTopComments` (line 290) returns up to 4. `story.comments` array is never populated. So the multi-comment loop in `assemble.js:1285-1328` (which supports up to 4) only ever sees a 1-element array.

Fixing this requires populating `story.comments = [{body, author, score}, ...]` in hunter.js for Reddit stories. This is independent of the F.1 honesty bug and lower urgency for tonight.

---

## G. HTML entity root cause

**`sanitizeDrawtext` (`assemble.js:960-973`) does two harmful things:**

```js
function sanitizeDrawtext(text, maxLen) {
  if (!text) return "";
  let clean = text
    .replace(/'/g, "")
    .replace(/\\/g, "")
    .replace(/;/g, "")
    .replace(/:/g, " ")
    .replace(/[^\x20-\x7E]/g, "") // ← strips non-ASCII
    .trim();
  if (maxLen && clean.length > maxLen) {
    clean = clean.substring(0, maxLen - 3) + "...";
  }
  return clean;
}
```

1. **No HTML entity decode.** Reddit's API returns text with HTML entities (`&amp;`, `&lt;`, `&#x27;`, `&pound;`, etc.). RSS feeds also frequently double-encode entities. Whatever flows in flows out as `&pound;` literal.
2. **Strips non-ASCII.** If the text was already decoded upstream (e.g. `£22.99`), the `[^\x20-\x7E]` strip kills the `£` and produces `22.99` — semantically wrong.

The fix is to decode HTML entities BEFORE the sanitisation, then either:

- leave the non-ASCII strip alone (so we lose `£`/`€`/`$` if decoded), AND
- ALSO replace common currency symbols with ASCII variants (`£ → £`/`GBP `/`pounds `) before strip, OR
- relax the strip to allow basic Latin-1 supplement (currency, em/en dashes already excluded by other rules).

Cleanest: decode entities + replace common symbols with safe ASCII (£→GBP, €→EUR, $→USD, ©→(c), etc.) before strip. Or, more pragmatic: decode entities, then strip non-ASCII as-is, but log when significant currency information is lost.

Tests must cover:

- `&pound;22.99` → `22.99 GBP` (or similar safe rendering)
- `&amp;` → safe
- already-decoded `£22.99` → `22.99 GBP` (consistent)
- `Don&#x27;t` → `Dont` (apostrophe-strip is upstream of entity decode anyway)
- ASS/drawtext escaping still safe (single quote, colon, backslash, semicolon)

---

## H. Instagram IN_PROGRESS finding

Already largely fixed by recent work I see in `upload_instagram.js`:

- `INSTAGRAM_CONTAINER_STATUS_FIELDS = "status_code,status"` (Graph rejects `error_code`/`error_subcode` as field names — those come from response payloads only).
- `IG_REEL_PROCESSING_MAX_ATTEMPTS = 60` × `IG_REEL_PROCESSING_POLL_MS = 10000` = 10 min ceiling.
- `buildInstagramPendingProcessingTimeoutError` distinguishes pending-processing-timeout from generic failure with `containerId`/`creationId`/`verify_later=true`.
- `lib/job-handlers.js` renders `accepted_processing` as `⏳` (not `❌`).

The **remaining gap** is a delayed-verifier — a scheduled job that re-checks IG container status N hours later and flips the publish-status when Meta finally finishes. That's a follow-up, not tonight.

For this incident, the IG `IN_PROGRESS` was correctly classified as pending; the publish summary just hadn't been re-rendered with the new outcome on the affected job. No code change needed tonight beyond making the classification visible per-job.

---

## I. Recent regression analysis

Reviewing commits since Session 1 + recent Codex work for any change that could have caused these symptoms:

| Commit          | Touches                                             | Could cause?                                           |
| --------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `d2343a7`       | decision-engine inventory gate                      | No — adds a gate but doesn't change render             |
| `d59b261` (#67) | quality_score auto-block                            | No — script gate only                                  |
| `1cf9d45` (#66) | Dockerfile dashboard build                          | No — backend renderer untouched                        |
| `e54b0ba` (#65) | IG poll fields                                      | Only IG poll, not video render                         |
| `69f95e4` (#64) | IG diagnostics + scheduler labels                   | Same                                                   |
| `5731c55` (#58) | "Fix assemble fallback stale bumper call"           | **YES — touches assemble fallback. Worth re-reading.** |
| `cb21882`       | "Render thumbnail candidates in visual QA fixtures" | Local-only                                             |
| `962bab1` (#57) | "Make media inventory reports actionable"           | No — local report tool                                 |

`5731c55` is the only commit on the actual render path. Per its message "Fix assemble fallback stale bumper call" — sounds like a fix, not a regression. But worth checking if it changed which path runs.

For the seven symptoms listed:

- HTML entities: **always broken** (sanitizeDrawtext was never entity-aware). Today's incident merely highlighted it.
- Comment-as-RSS-description: **always broken for RSS stories** (hunter.js:894 hasn't changed semantically).
- One image: **regression-adjacent** — the thumbnail-safety filter added in Codex's PRs may now be more aggressive in rejecting article images, leaving 0 usable visuals. Worth verifying.
- Outro: **no recent changes** to the outro path.
- Multi-comment: **always single-comment** since the system was built.

Conclusion: this is mostly **latent bugs becoming visible because we're now publishing more RSS stories than before** + one **probable interaction with the new thumbnail-safety filter rejecting RSS article hero images**.

---

## J. Recommended patch set

**P0 (ship tonight, narrow + tested):**

| ID   | What                                                                                                                                                                     | Where                                    | Risk                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| P0.A | Decode HTML entities + map common currency symbols to safe-render text inside `sanitizeDrawtext`                                                                         | `assemble.js:960`                        | Very low — pure transform, tests cover edge cases                                        |
| P0.B | Comment honesty: tag `comment_source_type` in hunter; in assemble, render the Reddit-style overlay only when source === `reddit_top_comment`; for RSS, skip the overlay  | `hunter.js:894`, `assemble.js:1265-1330` | Low — additive metadata, narrow check                                                    |
| P0.C | Visual-asset gate at publish time: if `realImages.length < N` AND no explicit one-image-template flag, mark story as `qa_skipped: no_safe_visuals` instead of publishing | `publisher.js` (publish flow)            | Medium — DOES change behaviour, will reduce upload volume; clearly signposted in Discord |

**P1 (next session):**

- P1.A: `outro_present` metadata stamp + publish-time gate
- P1.B: Multi-comment storage (hunter populates `story.comments` array of 4)
- P1.C: Render-path metadata fields (render_path, render_version, distinct_visual_count, comment_source_type, fallback_used) recorded per produce
- P1.D: IG delayed-verifier (re-poll containers 1h/3h/24h after timeout)

**Documentation only:**

- Studio V2 wiring: NOT a regression. Document expected operator-side promotion path.

---

## K. Safe-to-patch judgement tonight

**P0.A (entity decode):** YES — pure-function, no behaviour change in render graph, tests are exhaustive.

**P0.B (comment honesty):** YES — additive `comment_source_type` field + skip-render conditional. Doesn't break Reddit stories.

**P0.C (visual-asset gate):** YES IF the gate is RECORD-ONLY first. Implementing it as a publish-blocking gate tonight would suppress most of the queue. Better tonight: stamp `qa_visual_count` and `qa_visual_warning` on the story without blocking. Convert to blocking after one publish cycle of evidence.

**Skip tonight:** P1 items, Studio V2 wiring (separate session), multi-comment storage (touches hunter which the recurring agent might also edit), outro stamp (needs the `assemble` fallback path consistency cleanup first).

Now applying P0.A, P0.B, and P0.C-record-only.
