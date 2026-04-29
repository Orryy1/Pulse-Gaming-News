# Production Render Regression — Incident Report (P0.A/B/C tonight)

Generated: 2026-04-29T18:00Z (UTC) on `main` at commit `0f803a4`.

Companion document: [PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md](PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md). A parallel agent has also produced [PRODUCTION_RENDER_REGRESSION_REPORT.md](PRODUCTION_RENDER_REGRESSION_REPORT.md) covering the topicality/render-lane-observability angle; this report covers the entity decoder, comment-honesty gate, and visual-count metadata stamp shipped tonight.

---

## A. Do not do list

- Do not flip Studio V2 / canonical / clip-first / HyperFrames as the production renderer. It was never wired in. Any promotion needs a separate session with explicit gates.
- Do not enable a publish-blocking visual-count gate yet. Tonight's patch is RECORD-ONLY (`qa_visual_count` / `qa_visual_warning`). The block lands next pass after one publish cycle of evidence.
- Do not auto-retry IG `IN_PROGRESS` containers. The classification is now pending, not failed; a delayed-verifier is the right structural fix and is P1.
- Do not edit `db/migrations/` — immutable.
- Do not weaken the `FACEBOOK_REELS_ENABLED` env gate (still off; FB Reels remain ineligible on the 0-follower Page).
- Do not push manual social posts, OAuth flows or production DB writes.

---

## B. Root cause summary

Three real bugs, one persistent expectation gap. Plain English:

1. **Reddit + RSS text arrives with HTML entities** (`&pound;`, `&amp;`, `&#x27;`, `&#163;`). The drawtext sanitiser never decoded them, so `&pound;22.99` rendered literally on screen. Worse, when text was already decoded upstream (`£22.99`), the same sanitiser stripped non-ASCII so `£` was lost — silently leaving `22.99`.
2. **For RSS-sourced stories**, the hunter stamped the publisher's article excerpt onto `story.top_comment`, and the renderer wrapped that in a Reddit-style overlay with author hard-coded to literal `"Redditor"`. The on-screen result was an RSS feed quote falsely badged as a Reddit comment.
3. **For RSS-sourced stories with thin source media**, the image pipeline downloaded zero hero images, the renderer fell through to the legacy 1080×1920 composite, and produced a 60-second video of one static composite. The renderer behaved correctly given its input — the upstream image acquisition is what failed. There was no per-story metadata recording how thin the inventory was.
4. **Studio V2 / clip-first / HyperFrames "premium quality layer" was never the production renderer.** Production has always rendered via `assemble.js` (ffmpeg). Modules under `lib/studio/v2/` are operator tooling. Expectation gap, not a regression.

---

## C. Affected jobs / stories

| story_id               | title                                                                                        | source | downloaded_images | render_path    | comment_source_type before            | comment_source_type after           |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------ | ----------------- | -------------- | ------------------------------------- | ----------------------------------- |
| `rss_ef7e6e464509e0bc` | "MindsEye Has a New Update and a Cheaper Price as Developer Launches Comeback Bid"           | RSS    | 0                 | composite-only | (unset, treated as Reddit by overlay) | `rss_description` (overlay skipped) |
| `rss_1b7c404fc657548f` | "Xbox drops Game Pass prices as Call of Duty officially exits service's Day One launch slat" | RSS    | 0                 | composite-only | (unset, treated as Reddit by overlay) | `rss_description` (overlay skipped) |

Both queued via `/api/news`, neither yet has `youtube_post_id` — the next produce window will exercise tonight's fixes against them.

---

## D. Render-path finding

Production renders ALL Pulse Gaming Shorts via `assemble.js` (ffmpeg-driven multi-image Ken Burns + drawtext overlays + ASS subtitles). The HF thumbnail builder runs after assemble but only produces the 1280×720 JPEG used by `youtube.thumbnails.set` — not the MP4. Studio V2 modules under `lib/studio/v2/` are local tooling for forensic gauntlets and analytics loops. There is **no premium / clip-first / HyperFrames render path active in production**. Unchanged since Session 1's defensive audit.

---

## E. One-image fix

**Stamp visual count + warning on the story (record-only)** so Discord summaries, dashboard cards and the publish-time QA can see how thin the inventory was — without yet blocking publish.

- `assemble.js` (after image gathering, before filter-graph build): records `story.qa_visual_count = realImages.length` and `story.qa_visual_warning ∈ {"no_real_images_used_composite", "thin_visuals_below_three", null}`.
- Test: `tests/services/render-regression-2026-04-29.test.js` — pins both fields are written.
- Risk: very low. Pure metadata.
- Remaining: P1 — convert this stamp into a publish-time gate (`if qa_visual_count < 3 then qa_skipped: no_safe_visuals`) once a publish cycle of evidence is collected.

---

## F. Outro fix

**No code change tonight.** Outro is correctly wired in both render paths and the asset file ships in the Docker image. The "missing outro" perception likely came from one of:

- The single-image fallback rendering with bottom drawbox + brand text drowning the outro card visually.
- Multi-image render erroring late in the filter chain before the outro overlay attached.
- Operator perception of the brand-text fade being too subtle.

P1 follow-up: stamp `outro_present` per render and harden the fallback path's `await fs.pathExists(OUTRO_CARD)` to share the same code as the main path.

---

## G. Comment / Reddit fix

**Honesty gate.** Both the hunter and the assembler now track `comment_source_type` per story:

- Reddit posts: initialised to `none`, promoted to `reddit_top_comment` only when `fetchTopComments` returns at least one real comment.
- RSS items: tagged `rss_description` if the feed exposed a description, else `none`.

Assembler change (both main and single-image fallback paths): renders the `u/Redditor` overlay only when `comment_source_type === "reddit_top_comment"` OR a real `reddit_comments[]` array is present. RSS stories no longer produce a Reddit-styled overlay around the publisher's article excerpt.

- Tests: 2 source-string structural assertions confirm the guard exists in BOTH render paths and the hunter stamps + promotes the field correctly.
- Risk: low. Reddit stories with successful comment fetches behave exactly as before. RSS stories simply skip the overlay rather than render a fake one.
- Remaining: P1 — wire the multi-comment array (`story.reddit_comments` is fetched up to 8 deep but only the first is consumed by the renderer's loop today; the loop should honour the array).

---

## H. HTML entity fix

**Decode + safe ASCII fallback in `sanitizeDrawtext`.**

- New helpers: `decodeHtmlEntities()` (named/decimal/hex), `asciiFallback()` (Latin-1 supplement symbols → ASCII safe forms).
- `sanitizeDrawtext` now runs `decodeHtmlEntities → asciiFallback → existing drawtext escape strip → maxLen truncate`.
- `&pound;22.99` → `22.99 GBP`. `£22.99` → `22.99 GBP`. `&amp;` → `&`. `Don&#x27;t` → `Dont` (apostrophe still stripped for drawtext).
- ASS/drawtext escaping (single quote, colon, backslash, semicolon strips) preserved — applied AFTER the entity decode so decoded text is still safe to interpolate into a filter expression.
- Tests: 12 cases pinning named entities, decimal/hex numeric entities, currency symbols, smart quotes, em-dashes, ellipsis, drawtext-hostile char removal post-decode, maxLen with `...` truncation, null/empty inputs.
- Risk: low. Pure-function transform.

---

## I. Instagram IN_PROGRESS finding

**No code change tonight.** The path was substantially improved by recent agent work I observed in `upload_instagram.js`:

- `INSTAGRAM_CONTAINER_STATUS_FIELDS = "status_code,status"` (Graph rejects `error_code` / `error_subcode` / `error_message` as field names).
- `IG_REEL_PROCESSING_MAX_ATTEMPTS = 60` × `IG_REEL_PROCESSING_POLL_MS = 10000` = 10-min ceiling.
- `buildInstagramPendingProcessingTimeoutError({ containerId, attempts, pollMs, statusSummary })` distinguishes pending-timeout from failure with `verify_later=true`.
- `lib/job-handlers.js` renders the case as `accepted_processing` (`⏳`).

What's still missing: a delayed-verifier scheduled job that re-polls the container 1h / 3h / 24h after upload to catch Reels that Meta finishes processing AFTER our 10-min wait expires. P1.

---

## J. Quality gates added

| Gate                                | Where                                                               | Mode                                                                        |
| ----------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| HTML entity decode + ASCII fallback | `assemble.js:sanitizeDrawtext`                                      | Always-on, applies to every drawtext overlay                                |
| Comment-source honesty              | `assemble.js:1369-1390` (main) + `assemble.js:1965-1981` (fallback) | Always-on; checks `story.comment_source_type` and `story.reddit_comments[]` |
| `comment_source_type` stamp         | `hunter.js` (Reddit init, RSS init, Reddit promote)                 | Always-on, three branches                                                   |
| Visual-count metadata stamp         | `assemble.js` after image gathering                                 | RECORD-ONLY tonight; publish gate next pass                                 |

Gates **NOT** added (deferred to P1):

- Outro-presence gate
- Multi-comment renderer wiring
- IG delayed-verifier job
- Publish-blocking visual-count gate
- Topicality hard gate (already shipped by parallel agent — see `PRODUCTION_RENDER_REGRESSION_REPORT.md`)

---

## K. Files changed

| File                                                  | Why                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assemble.js`                                         | Entity decode + ASCII fallback in sanitizer; comment-source guard in main + fallback render paths; visual-count metadata stamp; 3 helpers exported for testing |
| `hunter.js`                                           | Stamp `comment_source_type` on Reddit posts (init `none`, promote to `reddit_top_comment` after real fetch) and RSS items (`rss_description`)                  |
| `tests/services/render-regression-2026-04-29.test.js` | 15 new tests pinning all three patches against regression                                                                                                      |
| `PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md`           | Full seven-symptom trace + ranked patch set                                                                                                                    |
| `PRODUCTION_RENDER_REGRESSION_INCIDENT_REPORT.md`     | This file                                                                                                                                                      |

Modified by other agents tonight (NOT staged in this commit): `lib/job-handlers.js`, `lib/scoring.js`, `publisher.js`, `tests/services/instagram-reel-polling.test.js`, `upload_instagram.js`. Parallel reports also written: `HERMES_SANDBOX_AUDIT.md`, `PLATFORM_FALLBACK_DIAGNOSIS.md`, `PRODUCTION_RENDER_REGRESSION_REPORT.md`. All left alone.

---

## L. Artefacts generated

- `PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md` — read-only diagnostic.
- `PRODUCTION_RENDER_REGRESSION_INCIDENT_REPORT.md` — this file.
- `tests/services/render-regression-2026-04-29.test.js` — regression coverage (15 tests).

---

## M. Validation

| Check                     | Result                                            |
| ------------------------- | ------------------------------------------------- |
| Targeted regression tests | **15 / 15 pass**                                  |
| Full test suite           | **1054 / 1054 pass, 0 fail**                      |
| `npm run build`           | **pass**, 758 ms                                  |
| Push to `origin/main`     | fast-forward `d2343a7..0f803a4`                   |
| Railway deploy            | auto-trigger from push (verify next health check) |

Skipped (per safety rules):

- No production publish/produce job triggered.
- No platform mutation, no OAuth, no env change.
- No production DB writes; the affected stories remain queued in `/api/news` for the next produce window to pick up.

---

## N. Deploy judgement

**AMBER.**

Why not GREEN:

- The bad-output class is **partially** stopped, not fully. Entity leak and the fake `u/Redditor` overlay are gated. Visual-count is observable but not yet publish-blocking.
- Outro presence is still inferred, not stamped or gated.
- Multi-comment rendering remains single-comment in practice.
- IG `IN_PROGRESS` still resolves only via the 10-min poll; delayed verifier is deferred.

Why not RED:

- All targeted tests pass. Full suite green. Build green.
- Patches are narrow, additive, with a clean `git revert 0f803a4` rollback path.
- Production canonical render path (`assemble.js` → ffmpeg) is unchanged in shape — only the sanitiser, the comment-source guard, and the metadata stamp changed.
- No platform posting / OAuth / Railway mutation / production DB writes performed.
- Two of three identified bugs are now fully fixed. The third (one-image renders) is correctly diagnosed, observable per-story, and the operator-side blocking gate is documented and scoped for the next pass.
- Affected stories remain in the queue; the next produce window will exercise the fixes against real RSS data.

---

## O. Next publish-window watch list

When the next produce/publish cycle fires (next scheduled at 19:00 UTC):

1. **Discord summary line per story** — should NOT contain `&pound;`, `&amp;`, `&#x27;` or any literal HTML entity. Currency should render as `GBP 22.99` style. If you still see entities, the patch isn't live or the source feeding text is bypassing `sanitizeDrawtext`.
2. **Comment overlay on RSS stories** — should be ABSENT. No `u/Redditor` block over an RSS-described story.
3. **Comment overlay on Reddit stories** — should still appear with real fetched author + score (or absent if `fetchTopComments` returned empty for that post).
4. **`qa_visual_count` field** — should appear in `story_scores` rows for every produced story. Watch for stories with `qa_visual_count = 0` or `< 3` — those are the upstream image-pipeline failures we now see.
5. **`qa_visual_warning`** — `no_real_images_used_composite` or `thin_visuals_below_three` markers should appear on the affected stories. If they're absent on a story that visibly rendered with one image, the stamp didn't fire — investigate.
6. **YouTube thumbnail** — unchanged path, will still flow `hf_thumbnail_path → story_image_path → image_path`.
7. **IG status** — if pending, look for `accepted_processing` in the publish summary, not `failed`.
8. **Outro card** — visible at the last 5s of every render. If still missing on a multi-image render, dig into the ffmpeg stderr for that job.

---

## P. Honest judgement

**Did we stop the bad-output class?** Partially. Two of the three real bugs are gated. The third (one-image fallback) is now observable per-story but not yet blocked.

**Is Studio V2 actually live?** No, and it never was in production. The user's expectation that "premium quality layer" should have been active was an inherited misconception — `assemble.js` is the only render path. Promoting Studio V2 is a separate, larger effort and should not be conflated with tonight's incident.

**What is still local/prototype only?** All of `lib/studio/v2/` except the HF thumbnail builder. The visual-count gate is record-only (not blocking publish). The IG delayed verifier is unbuilt. The multi-comment renderer wiring exists but only honours a single comment in the legacy fallback path.

**What is the next highest-leverage fix?**

1. **Promote the visual-count stamp into a publish-blocking gate** — `if qa_visual_count < 3 AND no breaking-news template flag, mark as qa_skipped: no_safe_visuals`. This stops the ongoing class of "60-second video of one composite shipped as if it's normal output." Costs about 30 lines + tests + one publish cycle of operator review.
2. **Wire `story.reddit_comments[]` through the renderer's multi-comment loop** so Reddit stories show 2-4 real comments instead of one. The data is already fetched.
3. **Outro-presence stamp + gate.** Small, structural.
4. **Address the upstream image acquisition gap for RSS stories.** This is the actual root cause of the one-image symptom — the gate above just stops them from publishing; the real fix is to enrich RSS stories with publisher hero images, Steam key art (when game is detectable from title), and IGDB fallback. Larger work.

Stop point. AMBER.
