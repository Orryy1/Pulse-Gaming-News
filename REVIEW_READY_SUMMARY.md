# Branch Review — `codex/hermes-sandbox-quality-routing`

Generated: 2026-04-29T18:05Z (UTC). Branch HEAD: `a2d364c`. Base: `main` at `d2343a7`.

---

## Important up-front clarification

The brief assumed this branch contains the topicality gate + Instagram pending-processing work. **It does not.** Actual state:

| Component                                                                                                                                                   | Where it lives now                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `lib/topicality-gate.js` + `tests/services/pulse-topicality-gate.test.js`                                                                                   | **Untracked working-tree files. Never committed to any branch.**         |
| Instagram pending-processing classification (`buildInstagramPendingProcessingTimeoutError`, `accepted_processing` glyph, `pending_processing_timeout` code) | **Already on `main`** (merged in earlier work, no longer pending review) |
| `publisher.js` duplicate-fallback prevention                                                                                                                | **Already on `main`**                                                    |
| `lib/job-handlers.js` Discord summary improvements                                                                                                          | **Already on `main`**                                                    |
| HTML entity decode + comment-source honesty + visual-count metadata stamp + 15 regression tests + diagnosis + incident report                               | **The two commits unique to this branch**                                |

So merging this branch only ships my P0 render-regression patches. The topicality + IG decisions need to be made separately.

---

## Files changed on this branch (vs `main`)

```
PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md         | 249 ++ (new doc)
PRODUCTION_RENDER_REGRESSION_INCIDENT_REPORT.md   | 223 ++ (new doc)
assemble.js                                       | 168 + / 12 -
hunter.js                                         |  20 + / 0  -
tests/services/render-regression-2026-04-29.test.js | 178 ++ (new test)
```

5 files, +826 / -12. Two commits: `0f803a4` (P0 patches) and `a2d364c` (incident report).

---

## Per-file behaviour delta + risk

### `assemble.js` — risk: LOW

**What changed (production render path):**

- New helpers: `decodeHtmlEntities()` (named/decimal/hex), `asciiFallback()` (£→GBP, €→EUR, ¥→JPY, ©→(c), em-dash→`-`, smart quotes→ASCII).
- `sanitizeDrawtext` now runs `decode → asciiFallback → existing escape strip → maxLen truncate`. Drawtext-hostile chars (single quote, colon, backslash, semicolon) still stripped after decode so filter-graph escaping is intact.
- Comment overlay (BOTH the main render path at line 1369 and the single-image fallback at line 1965) now guards behind `comment_source_type === "reddit_top_comment" || reddit_comments[].length > 0`. RSS stories no longer render under a `u/Redditor` badge.
- After image gathering, story is stamped with `qa_visual_count` (= `realImages.length`) and `qa_visual_warning` (`no_real_images_used_composite` / `thin_visuals_below_three` / `null`). Record-only — no publish gating yet.
- Helpers exposed on `module.exports` for direct testing.

**Behaviour change in production:**

- ✅ `&pound;22.99` now renders as `22.99 GBP` (was: literal `&pound;22.99`).
- ✅ `£22.99` (already-decoded) now renders as `22.99 GBP` (was: silently stripped to `22.99`).
- ✅ RSS-sourced stories no longer render a fake `u/Redditor` overlay over the publisher's article excerpt.
- ✅ Reddit-sourced stories with successful comment fetch behave exactly as before.
- ✅ Reddit-sourced stories whose comment fetch failed: overlay correctly skipped (was: tried to use whatever was in `top_comment`, which would have been empty anyway).
- ⚠️ Stories with thin visual inventory still render and publish (visual-count stamp is observability-only this pass).

**Rollback:** `git revert 0f803a4` — pure-function additive change, partial revert restores the old (literal-entity-leaking, fake-u/Redditor) behaviour cleanly.

### `hunter.js` — risk: LOW

**What changed:**

- Reddit-post initialiser now sets `comment_source_type: "none"`.
- Reddit comment-enrichment promotes to `comment_source_type = "reddit_top_comment"` when `fetchTopComments` returns ≥1 real comment.
- RSS-item initialiser sets `comment_source_type: item.description ? "rss_description" : "none"`.

**Behaviour change in production:**

- ✅ Every story now carries an honest source-type tag.
- ⚠️ Stories already in the queue from before this deploy will not have the field set — the assemble.js guard treats `undefined` as not-Reddit, so the worst case is that an in-flight Reddit story renders without its comment overlay until it's re-hunted. Acceptable transient.

**Rollback:** revert leaves `comment_source_type` undefined on new stories; assemble.js falls back to legacy behaviour (renders fake overlays again).

### `tests/services/render-regression-2026-04-29.test.js` — risk: NONE

15 tests pinning all three patches (12 entity-decode cases, 1 comment-source guard structural, 1 hunter source-type stamp structural, 1 visual-count stamp structural). Pure validation surface.

### `PRODUCTION_RENDER_REGRESSION_DIAGNOSIS.md` + `PRODUCTION_RENDER_REGRESSION_INCIDENT_REPORT.md` — risk: NONE

Documentation only. The incident report is namespaced separately from the parallel agent's `PRODUCTION_RENDER_REGRESSION_REPORT.md` (which covers topicality / render-lane observability) so both stand without conflict.

---

## Untracked files NOT staged in this branch

Per the brief: **"Do not stage unrelated changes in assemble.js, hunter.js, … or generated media assets unless explicitly instructed."** Held to that. The following are deliberately not part of this branch:

| Path                                           | Type   | Status                                                         |
| ---------------------------------------------- | ------ | -------------------------------------------------------------- |
| `lib/topicality-gate.js`                       | Source | Untracked, no commit                                           |
| `tests/services/pulse-topicality-gate.test.js` | Test   | Untracked, no commit (passes 7/7 locally)                      |
| `HERMES_SANDBOX_AUDIT.md`                      | Report | Untracked                                                      |
| `PLATFORM_FALLBACK_DIAGNOSIS.md`               | Report | Untracked                                                      |
| `PRODUCTION_RENDER_REGRESSION_REPORT.md`       | Report | Untracked (parallel agent)                                     |
| 50+ branding assets in `branding/`             | Media  | Untracked, stay out of git per Session 1's "do not sweep" rule |

The topicality work is genuine (the test passes, the gate logic is sound) but it's not yet on any branch. To "merge the topicality work" would require either: (a) a separate branch dedicated to it, or (b) explicitly instructing me to stage and commit those two files onto this branch.

---

## Validation run (per brief)

| Command                                                       | Result                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `git diff main...codex/hermes-sandbox-quality-routing --stat` | 5 files, +826/-12 (see table above)                                                 |
| `node --test tests/services/pulse-topicality-gate.test.js`    | **7 / 7 pass** (untracked, runs against working-tree file)                          |
| `node --test tests/services/instagram-reel-polling.test.js`   | **8 / 8 pass** (file is on main)                                                    |
| `npm test`                                                    | **1054 / 1054 pass, 0 fail**                                                        |
| `npm run build`                                               | pass, 555 ms                                                                        |
| `npm run ops:railway:health`                                  | currently `BUILDING` (deploy in flight from `a2d364c`) — transient, not a real fail |

---

## Merge verdict

**Yes, merge this branch into `main`.**

The decision to make is narrower than the brief implied: this is just my P0 render-regression work. None of the topicality / IG / publisher.js / job-handlers.js concerns mentioned in the brief are on this branch. The scope is purely:

- entity decode in the drawtext sanitiser (universal benefit, near-zero risk)
- comment-source honesty (stops fake `u/Redditor` overlays — direct fix for tonight's reported symptom)
- visual-count metadata stamp (observability-only, no behaviour change)
- 15 regression tests
- two diagnostic documents

Risk profile is low, blast radius is contained to `assemble.js` + `hunter.js`, and the rollback is one `git revert`. I see no reason to hold this back.

What to **NOT** claim after this merge:

- ❌ "Production render quality is fixed."
- ❌ "Studio V2 is now live."
- ❌ "Off-brand topicality is gated." (← the topicality gate is uncommitted)
- ❌ "Instagram is fixed." (← partial — pending-processing handling is on main; delayed verifier still missing)

What's accurate:

- ✅ Live overlays no longer render literal HTML entities.
- ✅ Live overlays no longer label RSS feed text as `u/Redditor` quotes.
- ✅ Every render now stamps `qa_visual_count` so an operator can see when a story rendered as a single composite.
- ✅ Existing `main` already has Instagram pending-processing classification.
- ✅ Existing `main` already has Codex's earlier auto-approve quality gate, my media-inventory gate, and the Dockerfile build fix.

---

## Rollback command

```bash
# If anything goes wrong after merge, single command reverts both commits:
git revert --no-edit a2d364c 0f803a4
git push origin main
```

Both commits are pure additive changes — no migrations, no data shape change beyond `qa_visual_count` / `comment_source_type` which are optional fields read with safe defaults. Reverting is safe to do mid-publish-window.

---

## What to watch after the next publish window (19:00 UTC)

1. **Discord summary lines** — no literal `&pound;`, `&amp;`, `&#x27;`. Currency reads as `GBP 22.99` style.
2. **RSS-sourced video** — no `u/Redditor` overlay. Reddit-sourced video — overlay still present with real fetched author/score.
3. **`qa_visual_count` field on `story_scores`** — every produced story has a non-null integer. Stories with `qa_visual_count = 0` are the upstream image-pipeline failures we now see clearly.
4. **`qa_visual_warning`** — values appear on thin-inventory stories (`no_real_images_used_composite` / `thin_visuals_below_three`). If absent on a visibly-one-image story, the stamp didn't fire — investigate.
5. **Outro card** — visible at the last 5s of every render. If still missing on multi-image, it's an ffmpeg stderr issue (fix scoped for P1).
6. **IG status** — `accepted_processing` not `failed` for pending containers (already on main, just confirm).
7. **No Studio V2 lane on production** — render still uses `assemble.js`. That gap is for a future, separate session.

---

## Next P0 after this merge

The brief calls it correctly: **render-path observability and fail-closed quality gating** is the next focused pass. Concretely:

1. **Promote `qa_visual_count` stamp into a publish-blocking gate** (`if qa_visual_count < 3 AND no breaking-news template flag, mark as qa_skipped: no_safe_visuals`). Stops the ongoing class of "60-second video of one composite shipped as if it's normal output." ~30 lines + tests.
2. **Stamp + surface `render_lane`** (`legacy` / `studio_v2` / `fallback_simple`) and `render_quality_class` (`premium` / `standard` / `fallback` / `reject`) on every produced story, surface in Discord.
3. **Decide on the topicality gate** — currently uncommitted. Either: (a) commit + merge it (low risk per the test + the audit it's tied to), (b) discard it.
4. **Wire `story.reddit_comments[]` through the renderer's multi-comment loop** — data is fetched, just not consumed for non-`reddit_comments` paths.
5. **Outro-presence stamp + gate.**
6. **IG delayed verifier scheduled job.**
7. **Upstream RSS image enrichment** (publisher hero + Steam key art when game detectable + IGDB fallback) — addresses the actual root cause of thin-visuals stories being created in the first place.

Stop point.
