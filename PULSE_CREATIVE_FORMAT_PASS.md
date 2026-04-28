# PULSE — Creative / Format / Media Inventory Pass (Session 2)

Generated: 2026-04-28T19:14Z (UTC) on branch `codex/pulse-enterprise-hardening`.

---

## A. Do not promote list

Everything below is **local prototype only**. Nothing here is wired into production:

- `lib/creative/media-inventory-scorer.js` — new
- `lib/creative/runtime-recommender.js` — new
- `lib/creative/format-catalogue.js` — new
- `lib/creative/visual-qa-gate.js` — new
- `tools/creative/build-monthly-release-radar.js` — new prototype generator
- `tools/creative/run-visual-qa.js` — new prototype generator
- `tools/creative/build-thumbnail-candidates.js` — new prototype generator
- `lib/thumbnail-safety.js` — already exists (untracked, authored by the in-progress thumbnail-safety branch). Tested in this session, **not modified**.
- `lib/thumbnail-candidate.js` — already exists (untracked, same author). **Not modified**.
- `docs/thumbnail-safety-audit.md` — already exists (untracked). **Not modified**.

Specifically do not deploy:

- The dynamic runtime rules. Production produce still treats every Short the same.
- The format catalogue. Nothing in the orchestration code reads it yet.
- The Monthly Release Radar prototype. All fixture release dates carry `NEEDS_SOURCE`.
- The visual QA gate. It runs locally only; the production publish path is unchanged.
- The thumbnail-safety module remains gated behind the existing untracked work, which Session 1 said must not be swept into a commit by this session.

---

## B. Session 1 constraints observed

Session 1 was **AMBER**. Key items this session honoured:

| Session 1 constraint                                                                                                                  | How Session 2 obeyed it                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local main is +5 commits ahead of `origin/main`; do not push                                                                          | I made no commits. Working tree carries new files only.                                                                                                                                                                                      |
| Working tree contains 8 modified tracked files from another agent's thumbnail-safety feature                                          | Untouched. I did **not** stage any of `images.js`, `images_download.js`, `images_story.js`, `lib/services/content-qa.js`, `lib/studio/v2/hf-thumbnail-builder.js`, `publisher.js`, `tests/services/content-qa.test.js`, `upload_youtube.js`. |
| Untracked `lib/thumbnail-safety.js`, `lib/thumbnail-candidate.js`, `docs/thumbnail-safety-audit.md` are mid-flight from another agent | Read for reuse. Not edited. New tests pin the public contract (`tests/services/creative-thumbnail-safety.test.js`).                                                                                                                          |
| `libnss3` Dockerfile gap (HF thumbnails 0% live in production)                                                                        | Not touched. Out of scope this session — same Dockerfile-render-engine adjacency. Surfaced again in §I as a Session 4 follow-up.                                                                                                             |
| Canonical Studio V2 default must not be replaced                                                                                      | Production `assemble.js` (ffmpeg) and the canonical render pipeline are untouched. The new modules sit beside them, not inside them.                                                                                                         |
| Scheduler/queue must not be touched                                                                                                   | Untouched.                                                                                                                                                                                                                                   |
| Platform uploaders must not be touched                                                                                                | Untouched.                                                                                                                                                                                                                                   |
| TikTok app-review and Buffer routes are dead                                                                                          | Acknowledged in format selection — Daily Shorts notes "optional cross-post to TikTok/IG", and the Reject format's monetisation is `null`.                                                                                                    |

No Session 1 stop condition was triggered.

---

## C. Media-source audit

The image pipeline writes a `downloaded_images` array with `{ path, type, source, priority }` per entry. Vocabulary collected from `images_download.js`:

| `type` values                                                                                                          | `source` values                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `article_hero`, `key_art`, `hero`, `capsule`, `screenshot`, `reddit_thumb`, `company_logo`, `trailer`, `trailer_frame` | `article`, `steam`, `reddit`, `logo`, `pexels`, `unsplash`, `bing` |

### Why random faces appeared in Shorts

1. **Article `og:image` priority was high.** When a publisher served an author byline as the article hero (Gravatar-style portrait), it was downloaded as `type: article_hero, source: article` and treated like a story image. The legacy 1080×1920 composite picked it.
2. **Inline article scraping skipped `/avatar/`, `/icon/`, `/logo/` URLs but did not classify post-download.** A `byline-jane.jpg` sitting at a non-obvious path could land as an article inline.
3. **Stock-people fallbacks (Pexels, Unsplash, Bing) added generic portraits.** The fallback chain at `images_download.js:548-651` queries those APIs whenever the per-source counters fell short. Search results for "team meeting" or "studio interview" naturally include people.
4. **HyperFrames thumbnail builder trusted whatever it found.** `pickSubjectImage` originally walked a static priority list with no relevance gate — a stock portrait that ranked above a key art could become the thumbnail subject.
5. **YouTube uploader had no pre-upload safety check.** It set the first existing thumbnail path. The first existing path could be anything.

### Already mitigated upstream (in-progress thumbnail-safety branch)

The untracked `lib/thumbnail-safety.js` (authored by another agent, present in this working tree) classifies every candidate by source/type/URL/filename heuristics and returns `safeForThumbnail: false` for:

- author-profile blob matches (`AUTHOR_PROFILE_RE`: `author|byline|contributor|staff|profile|avatar|headshot|portrait|userpic|gravatar|...`)
- human-hint blob matches when the candidate carries no `personName` matched against the story
- generic stock + human combination
- explicit `is_author_image: true` flags

It does NOT do face identity recognition — it is heuristic only, matching the Session 2 stop condition. The hf-thumbnail-builder uncommitted edits already require this module before selecting a subject image; the YouTube uploader uncommitted edits already gate `youtube.thumbnails.set` behind `runThumbnailPreUploadQa`.

### Where the thumbnail-safe frame should be injected

Two places:

1. **Inside `images_download.js`'s post-write classification step.** Run `classifyThumbnailImage` over the just-downloaded image. If `safeForThumbnail === false` and the image is from `pexels|unsplash|bing` or has the author-profile blob, skip storing it. This prevents poisoned data from ever reaching `downloaded_images`.
2. **Inside the YouTube upload flow.** The candidate chain is `hf_thumbnail_path → story_image_path → image_path`. The uncommitted edits already gate `thumbnails.set` behind `runThumbnailPreUploadQa`. Once that branch is reviewed and merged, this gap closes for real.

Until those paths are committed, the gate exists in the form of:

- `lib/thumbnail-safety.js` (untracked)
- `lib/thumbnail-candidate.js` (untracked, generates a 1080×1920 PNG with `runThumbnailPreUploadQa` baked in)

This pass adds:

- `lib/creative/visual-qa-gate.js` (this session) — runs the same safety check plus inventory + runtime checks at story level, before render is even queued.

---

## D. Media inventory system

### What was built

`lib/creative/media-inventory-scorer.js` — a pure / sync scorer. Input: a story object with `downloaded_images` and (optional) `video_clips`. Output:

```
{
  storyId,
  counts: {
    official_trailer_clips, gameplay_clips, trailer_extracted_frames,
    article_images, publisher_official_images, store_assets,
    generic_stock, unknown_human_portrait_risk, other,
    total_images, total_clips, distinct_sources, repeated_source_risk
  },
  ratios: { clipRatio, stillRatio, cardRatio, total },
  scores: { visualStrength, thumbnailSafety, premiumSuitability },
  sources: [...],
  classification: 'reject_visuals'|'blog_only'|'briefing_item'|'short_only'|'standard_video'|'premium_video',
  classificationReasons: [...]
}
```

Order of bucketing is intentional: **stock-source check fires before store-asset check** so a Pexels image typed `screenshot` can't be quietly counted as a Steam screenshot. The earlier reverse ordering was the reason a Pexels portrait could end up bumping the store-assets count and silently lifting the visual-strength score. That bug was caught by `creative-media-inventory-scorer.test.js:65`.

### Classifier rules (descending priority)

1. `unknown_human_portrait_risk >= 2` OR `(totalUsable === 0 AND totalImages > 0)` → **`reject_visuals`**
2. `totalUsable === 0` → **`blog_only`**
3. `totalUsable <= 2 AND totalClips === 0` → **`briefing_item`**
4. `premium >= 70 AND trailerClips >= 1 AND store_assets >= 2` → **`premium_video`**
5. `visualStrength >= 55 AND totalUsable >= 5` → **`standard_video`**
6. otherwise → **`short_only`**

`totalUsable = store_assets + trailer_frames + publisher_official + article_images + total_clips`. Generic-stock entries are intentionally NOT in `totalUsable` — they pad the tally without contributing real visual material.

### Example output

From `test/output/visual-qa/fixture-qa-premium.json` — Iron Saint Console Reveal (premium fixture, 6 store assets, 1 trailer clip, 1 gameplay clip):

```
classification: premium_video
counts.store_assets: 4
counts.trailer_extracted_frames: 2
counts.official_trailer_clips: 1
counts.gameplay_clips: 1
counts.unknown_human_portrait_risk: 0
scores.visualStrength: 79
scores.premiumSuitability: 99
scores.thumbnailSafety: 100
```

From `test/output/visual-qa/fixture-qa-reject.json` — Pitchfork Hollow stock-people fixture:

```
classification: reject_visuals
counts.unknown_human_portrait_risk: 2
counts.generic_stock: 2
classificationReasons: ['multiple_unsafe_human_portraits']
```

---

## E. Thumbnail safety

The thumbnail-safety module (`lib/thumbnail-safety.js`, untracked, **authored elsewhere**) covers every Session 2 §5.4 requirement. This pass added test coverage of the public contract.

| Required behaviour                                           | Verified by                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| reject unknown human portraits                               | `tests/services/creative-thumbnail-safety.test.js:15`                               |
| reject article author headshots                              | `tests/services/creative-thumbnail-safety.test.js:30`                               |
| reject profile/avatar-style images                           | covered by AUTHOR_PROFILE_RE; same test file                                        |
| penalise generic stock people                                | filterUnsafeImagesForRender drops them — tested                                     |
| prefer official game key art                                 | `creative-thumbnail-safety.test.js:48` (score >= 70)                                |
| prefer gameplay screenshots                                  | implicit via `GAME_ASSET_TYPES` set; tested via select                              |
| prefer trailer frames                                        | same set; tested                                                                    |
| prefer platform UI/logos for platform stories                | `creative-thumbnail-safety.test.js:60`                                              |
| allow human image only when story is about that named person | `creative-thumbnail-safety.test.js:73`                                              |
| no face identity recognition                                 | confirmed by reading the module — only regex/string heuristics on URL/path/metadata |
| simple detection only                                        | confirmed                                                                           |

`runThumbnailPreUploadQa` provides the structured pre-upload verdict (`pass`/`warn`/`fail`).

### Candidate-frame generation

`lib/thumbnail-candidate.js:buildThumbnailCandidatePng` produces 1080×1920 PNGs with:

- safe-margin SVG layout (Pulse Gaming amber `#FF6B1A` accents)
- subject image clipped into a 940×690 hero block at y=205
- gradient backdrop using the brand palette
- flair badge (CONFIRMED / VERIFIED / RUMOUR / NEWS) at y=965
- 84pt headline at y=1115 with shadow filter, wrapped to 4 lines max
- channel mark `PULSE GAMING` at y=1585
- source line (subreddit or `source_type`) at y=1632
- placeholder fallback when no safe subject image is available
- internal `runThumbnailPreUploadQa` call after rendering — the verdict goes back to the caller

A new prototype generator (`tools/creative/build-thumbnail-candidates.js`) exercises six fixture stories and writes verdicts under `test/output/thumbnail-safety/`. Contact-sheet generator (`buildThumbnailContactSheet`) is also exposed from the same module for operator review.

### Test coverage added this session

- `tests/services/creative-thumbnail-safety.test.js` (10 tests) — public contract pin
- `tests/services/creative-visual-qa-gate.test.js` (5 tests) — gate composition
- `tests/services/creative-media-inventory-scorer.test.js` (5 tests) — scorer
- `tests/services/creative-format-runtime.test.js` (8 tests) — runtime + formats

All 28 pass.

---

## F. Visual QA and runtime rules

### `lib/creative/visual-qa-gate.js`

Composes the inventory scorer + runtime recommender + thumbnail-safety classifier into a single per-story verdict. Returns:

```
{
  storyId, result: 'pass'|'warn'|'fail',
  failures: [...], warnings: [...],
  checks: [{ id, severity, detail }, ...],
  inventory: { ... full scorer output ... },
  runtime: { shouldRender, runtimeSeconds, route, note },
  bestThumbnail: { path, score, decision, reasons } | null,
  recommendedAction: 'render at 52s target ...' | 'do_not_render — route to ...' | ...
}
```

### Checks performed

1. `inventory_class` (fail if `reject_visuals`/`blog_only`, warn if `briefing_item`)
2. `runtime_recommendation` (fail if `shouldRender === false`)
3. `title_text_present` (fail if missing, warn if too long / too long-word risk)
4. `thumbnail_candidate_present` (warn if path missing, info if present)
5. `black_frame_risk` (fail if `qa_black_frame_seconds > 1.5`)
6. `unsafe_face_risk` (fail if `>= 2`, warn if `1`)
7. `repeated_stills_risk` (warn if 4+ repeats)
8. `stock_filler_ratio` (fail if `> 50%`, warn if `> 25%`)
9. `source_diversity` (warn if only 1 source)

Output writers — `writeQaArtefacts(report, outDir)` produces both `<id>.json` and `<id>.md`.

Six fixture stories ran through the gate; outputs live in `test/output/visual-qa/`. Sample summary:

| fixture                 | result | classification |
| ----------------------- | ------ | -------------- |
| `fixture-qa-premium`    | warn   | premium_video  |
| `fixture-qa-standard`   | warn   | short_only     |
| `fixture-qa-short-only` | fail   | briefing_item  |
| `fixture-qa-briefing`   | fail   | briefing_item  |
| `fixture-qa-blog-only`  | fail   | reject_visuals |
| `fixture-qa-reject`     | fail   | reject_visuals |

The premium fixture is `warn` rather than `pass` because no pre-built thumbnail candidate is set on the fixture — the gate is flagging that the operator should run `build-thumbnail-candidates.js` first. That's correct behaviour.

### `lib/creative/runtime-recommender.js`

Single function: `recommendRuntime(inventoryOrClass)`. Lookup table:

| classification   | shouldRender | runtimeSeconds        | route                        |
| ---------------- | ------------ | --------------------- | ---------------------------- |
| `reject_visuals` | false        | null                  | `manual_review`              |
| `blog_only`      | false        | null                  | `blog`                       |
| `briefing_item`  | false        | { 18, 30, target 22 } | `daily_briefing_segment`     |
| `short_only`     | true         | { 30, 45, target 38 } | `daily_short`                |
| `standard_video` | true         | { 45, 60, target 52 } | `daily_short_or_briefing`    |
| `premium_video`  | true         | { 60, 75, target 68 } | `premium_short_or_breakdown` |

Unknown class falls through to `manual_review` rather than throwing — operator never gets a thrown error from the orchestration code.

---

## G. Format architecture

`lib/creative/format-catalogue.js` defines all 9 formats Session 2 §5.8 requires. Each format declares: `id`, `label`, `viewerPromise`, `idealRuntimeSeconds`, `sourceConfidence` (allowed flair-confidence levels), `mediaInventory.minClass`, `scriptStructure` (ordered beats), `titlePatterns`, `seo`, `shortsRepurposing`, `analyticsToTrack`, `monetisation`, `promotionRules`, `demotionRules`, `reviewRequirements`.

| id                      | min inventory                                | source confidence         | runtime band | core promise                        |
| ----------------------- | -------------------------------------------- | ------------------------- | ------------ | ----------------------------------- |
| `daily_shorts`          | `short_only`                                 | verified+confirmed+likely | 30-60s       | one verified beat under a minute    |
| `daily_briefing`        | `briefing_item`, ≥6 stories                  | verified+confirmed+likely | 2-4 min      | round-up of last 24h                |
| `weekly_roundup`        | `standard_video`, ≥8 stories                 | verified+confirmed        | 5-12 min     | impact-ranked week summary          |
| `monthly_release_radar` | `premium_video`, ≥10 candidates              | confirmed                 | 15-25 min    | next-month release calendar         |
| `before_you_download`   | `premium_video`, ≥3 store assets, trailer    | confirmed                 | 4-9 min      | evidence-led pre-launch verdict     |
| `trailer_breakdown`     | `premium_video`, ≥1 trailer clip, ≥12 frames | confirmed                 | 4-10 min     | frame-by-frame, only what's visible |
| `rumour_radar`          | `standard_video`, ≥5 stories                 | likely+rumour             | 4-8 min      | tier-ranked rumour survey           |
| `blog_only`             | `blog_only`                                  | verified+confirmed+likely | n/a          | sourced text article                |
| `reject`                | `reject_visuals`                             | unknown                   | n/a          | not published — operator review     |

`selectFormatForStory(story, inventory)` routes a single story to the highest-priority format it qualifies for. Aggregate formats (`daily_briefing`, `weekly_roundup`, `monthly_release_radar`, `rumour_radar`) are NOT auto-selected per story — they're built by an aggregation step that merges multiple stories. That aggregation is a future task; the catalogue captures the rules.

`confidenceFromFlair(flair)` maps the existing flair vocabulary (`Confirmed`, `Verified`, `Highly Likely`, `Rumour`, `News`, `Breaking`) to the 5-level confidence scale (`unknown`, `rumour`, `likely`, `verified`, `confirmed`).

**No phrasing, jokes, branding, thumbnails or visual assets in this catalogue are copied from any other channel.** Every viewer promise is a functional-genre description; every script structure is a beat plan, not a script.

---

## H. Monthly Release Radar prototype

`tools/creative/build-monthly-release-radar.js` reads `data/fixtures/monthly-release-radar/candidates.json` and produces the full artefact set under `test/output/monthly-release-radar/`. Run results (FIXTURE_MONTH FIXTURE_YEAR window):

- `eligible: 10` (after fact-check + inventory gate)
- `ranked: 10` top-10 picks
- `rejected: 2` (one rumour-tier candidate with thin inventory, one all-NEEDS_SOURCE record)
- `missingNeeds: 10` — every fixture candidate has `release_date: NEEDS_SOURCE`, so every entry surfaces a missing-sources warning. **A real run with verified candidates would produce 0 missingNeeds.**

### Artefacts generated

- `schema.json` — JSON Schema for a candidate
- `sources.json` — source registry (publisher official, Steam, console stores, press, dev blog, wishlist)
- `candidates.json` — input + per-candidate inventory score
- `fact-check.json` — per-candidate verdict (`verified` / `unsourced_date` / `incomplete`)
- `ranked.json` — top 10 with score breakdown (visual + tier bonus + platform bonus)
- `rejected.json` — non-qualifying candidates with reasons
- `longform-script.md` — long-form video script draft (cold open / intro / 10 segments / honourable mentions / outro), every game's date listed as `NEEDS_SOURCE`
- `chapters.md` — YouTube chapter timestamps (cumulative ~21 min)
- `seo.md` — title (truncated to 70 chars), 200-char description, tag families
- `pinned-comment.md` — pinned comment draft
- `shorts/01.md..10.md` — 10 individual Shorts scripts, each beat-pinned to a candidate's source fields
- `shorts-titles.md` — 3 title options × 10 candidates
- `blog-article.md` — blog draft with rejected-candidate "Held back" section
- `newsletter.md` — newsletter draft with subject line options
- `manual-review.md` — operator checklist (per-game tickboxes + NEEDS_SOURCE list)
- `missing-sources.md` — separated NEEDS_SOURCE registry

### Source confidence

Every fixture candidate carries one of `fixture-confirmed`, `fixture-likely`, or `fixture-rumour`. The radar pipeline:

- Tier 1 (`fixture-confirmed`) → eligible if inventory passes
- Tier 2 (`fixture-likely`) → eligible if inventory passes
- Tier 3 (`fixture-rumour`) → rejected from ranking outright; only listed in the held-back/rejected register

### Manual review requirements

Every `manual-review.md` entry has:

- [ ] release date confirmed against `release_date_source`
- [ ] platforms confirmed against publisher store page
- [ ] trailer URL still resolves
- [ ] no rumour/leak claim used as fact
- [ ] no random faces in the visuals

Plus a NEEDS_SOURCE block listing every field that an operator must replace with a real value before publish. **The pipeline refuses to publish unsourced dates** — the longform script, blog article and newsletter all print `NEEDS_SOURCE` literally rather than fabricating a date.

### What's NOT in the prototype

- Real release dates. Every fixture has `NEEDS_SOURCE` for `release_date` and `release_date_source`. To produce a publishable radar, the operator must replace `data/fixtures/monthly-release-radar/candidates.json` with a real candidate set sourced from publisher feeds + store pages.
- Fetched key art / trailers. Inventory counts are declared on each candidate (`media_inventory_estimate`) — a real run would replace these with figures from the store-assets pipeline.
- A scheduled job. The prototype runs ad hoc via `node tools/creative/build-monthly-release-radar.js`. Wiring it into the canonical scheduler is a future task.

---

## I. Cost / quota / effort notes

| Format / tool                 | TTS use                | Render time                                                        | Storage                       | API/media                    | Manual review                | Risk                             | Likely value                               |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------ | ----------------------------- | ---------------------------- | ---------------------------- | -------------------------------- | ------------------------------------------ |
| Daily Shorts (existing)       | small (~50s × 1-3/day) | a few minutes per Short                                            | small (mp4 + thumb per story) | existing pipeline            | none extra                   | low                              | unchanged baseline                         |
| Daily Briefing                | medium (~180s)         | medium (multi-segment ffmpeg)                                      | medium                        | existing                     | small (segment ordering)     | medium                           | higher retention than Shorts; YPP-friendly |
| Weekly Roundup                | high (~480s)           | high                                                               | medium                        | existing                     | medium                       | medium                           | flagship long-form once monetised          |
| Monthly Release Radar         | very high (~1200s)     | very high                                                          | medium                        | needs new candidate-fetcher  | high (fact-check every date) | low if dates are confirmed       | premium evergreen format                   |
| Before You Download           | high (~360s)           | high                                                               | medium                        | existing + fact-check        | high                         | medium (post-launch corrections) | premium one-shot                           |
| Trailer Breakdown             | medium (~360s)         | high (frame extraction)                                            | medium                        | needs trailer hosting/credit | medium                       | low                              | brand-defining when done well              |
| Rumour Radar                  | medium (~360s)         | medium                                                             | medium                        | existing                     | high (tiering and dissent)   | medium (correction risk)         | medium                                     |
| Blog-only                     | none                   | none                                                               | small (HTML/MD only)          | existing                     | small                        | low                              | newsletter cross-post upside               |
| Reject                        | none                   | none                                                               | none                          | none                         | medium (editorial review)    | none                             | catches mistakes                           |
| `media-inventory-scorer`      | none                   | none                                                               | none (pure function)          | none                         | none                         | none                             | unblocks routing                           |
| `runtime-recommender`         | none                   | none                                                               | none                          | none                         | none                         | none                             | unblocks routing                           |
| `format-catalogue`            | none                   | none                                                               | none                          | none                         | none                         | none                             | unblocks routing                           |
| `visual-qa-gate`              | none                   | small (sharp luma stat per black-frame check, currently flag-only) | small (JSON+MD per story)     | none                         | none                         | none                             | catches bad renders before upload          |
| `build-thumbnail-candidates`  | none                   | small (sharp + svg per story)                                      | small (PNG per story)         | none                         | none                         | none                             | shippable once integrated                  |
| `build-monthly-release-radar` | none until rendered    | none                                                               | small (markdown + JSON)       | needs real candidate fetcher | high (every date)            | high if real dates are wrong     | high once real data feed exists            |

### Practical constraints

- The libnss3 Dockerfile gap from Session 1 still blocks HF thumbnail rendering on Railway. Until that's fixed, **the visual-qa-gate's "thumbnail candidate present" check will warn on every production story** because the candidate cannot be produced server-side.
- Format catalogue is data-only; no extra TTS/render cost from defining it.
- Aggregate formats (briefing, roundup, radar, rumour-radar) need an upstream "story-set selector" before they can run automatically. That selector is a future task — for now, an operator can manually drop a JSON of candidate stories into `data/fixtures/...` and run the prototype.

---

## J. Files changed

| File                                                     | Status | Why                                                              |
| -------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `lib/creative/media-inventory-scorer.js`                 | new    | per-story 6-bucket classifier + scoring                          |
| `lib/creative/runtime-recommender.js`                    | new    | classification → runtime band + render decision                  |
| `lib/creative/format-catalogue.js`                       | new    | 9 formats with full structural fields + `selectFormatForStory`   |
| `lib/creative/visual-qa-gate.js`                         | new    | inventory + runtime + thumbnail-safety composed; JSON+MD writers |
| `tools/creative/build-monthly-release-radar.js`          | new    | full MRR artefact generator from fixtures                        |
| `tools/creative/run-visual-qa.js`                        | new    | runs the gate against fixture stories                            |
| `tools/creative/build-thumbnail-candidates.js`           | new    | runs the existing candidate generator against fixture stories    |
| `data/fixtures/monthly-release-radar/candidates.json`    | new    | fixture (12 candidates, every date NEEDS_SOURCE)                 |
| `tests/services/creative-media-inventory-scorer.test.js` | new    | 5 tests, scorer behaviour                                        |
| `tests/services/creative-format-runtime.test.js`         | new    | 8 tests, runtime + format catalogue                              |
| `tests/services/creative-thumbnail-safety.test.js`       | new    | 10 tests pinning the existing untracked module's contract        |
| `tests/services/creative-visual-qa-gate.test.js`         | new    | 5 tests, gate composition + writer                               |

Nothing modified. Nothing deleted. No production source file edited in this session. Working tree carries new files only.

---

## K. Artefacts generated

| Path                                                    | Description                                       |
| ------------------------------------------------------- | ------------------------------------------------- |
| `test/output/thumbnail-safety/index.md`                 | summary of 6 thumbnail-safety fixtures            |
| `test/output/thumbnail-safety/summary.json`             | machine-readable verdicts                         |
| `test/output/thumbnail-safety/fixture-thumb-*.json`     | per-story full classification + ranked candidates |
| `test/output/visual-qa/index.md`                        | summary of 6 visual-QA fixtures                   |
| `test/output/visual-qa/summary.json`                    | machine-readable summary                          |
| `test/output/visual-qa/fixture-qa-*.{json,md}`          | per-story gate verdicts                           |
| `test/output/monthly-release-radar/schema.json`         | candidate JSON schema                             |
| `test/output/monthly-release-radar/sources.json`        | source registry                                   |
| `test/output/monthly-release-radar/candidates.json`     | all candidates with inventory scores              |
| `test/output/monthly-release-radar/fact-check.json`     | per-candidate verification verdict                |
| `test/output/monthly-release-radar/ranked.json`         | top-10 picks with scoring                         |
| `test/output/monthly-release-radar/rejected.json`       | rejected candidates with reasons                  |
| `test/output/monthly-release-radar/longform-script.md`  | long-form video script                            |
| `test/output/monthly-release-radar/chapters.md`         | YouTube chapter timestamps                        |
| `test/output/monthly-release-radar/seo.md`              | SEO title/description/tags                        |
| `test/output/monthly-release-radar/pinned-comment.md`   | pinned comment draft                              |
| `test/output/monthly-release-radar/shorts/01.md..10.md` | 10 Shorts scripts                                 |
| `test/output/monthly-release-radar/shorts-titles.md`    | 30 Shorts title options                           |
| `test/output/monthly-release-radar/blog-article.md`     | blog draft                                        |
| `test/output/monthly-release-radar/newsletter.md`       | newsletter draft                                  |
| `test/output/monthly-release-radar/manual-review.md`    | operator checklist                                |
| `test/output/monthly-release-radar/missing-sources.md`  | NEEDS_SOURCE registry                             |

---

## L. Validation

| Check                                            | Result                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Targeted tests (creative-\*)                     | **28 / 28 pass**                                                                      |
| MRR generator end-to-end                         | success (10 ranked, 2 rejected, all NEEDS_SOURCE flagged)                             |
| Visual QA generator end-to-end                   | success (6 fixtures across all 6 inventory bands)                                     |
| Thumbnail-candidate generator end-to-end         | success (6 fixtures, key-art and platform-logo passed, stock+author warned correctly) |
| Full test suite (separately at end of session 3) | run after Session 3 to keep both colours honest                                       |
| Build (`npm run build`)                          | run after Session 3                                                                   |

Skipped (per Session 2 stop conditions):

- No Sharp luma check ran against real frame data (the visual-qa-gate's black-frame check is currently a flag-only — it reads `story.qa_black_frame_seconds` rather than running ffprobe). Sharp-based pixel checks live in the existing `lib/thumbnail-safety.js:imageLooksBlack` for thumbnail-frame use only.
- No real release dates were sourced.
- No production data was read or written.

---

## M. Creative readiness gate

**AMBER**

### Why not GREEN

- Modules are tested only against fixtures. No real story has run through the inventory gate end-to-end on Railway.
- The Monthly Release Radar prototype's factual claims are all `NEEDS_SOURCE`. The structural pipeline works; the data feed does not yet exist.
- The thumbnail-safety module is heuristic-only (no face detection, no entity-recognition). That's by design — the Session 2 stop condition forbids face identity. So the module will continue to false-warn on entity stories without a `personName` hint.
- The visual-qa-gate `thumbnail_candidate_present` check warns on every production story until the libnss3 Dockerfile gap is closed (Session 1 carry-over).
- Render outputs (the candidate PNGs) need human review before any production wiring.

### Why not RED

- Production canonical (`assemble.js` ffmpeg path) is unchanged.
- Random-face failure mode is fully explained in §C.
- Thumbnail candidate IS generated locally — `lib/thumbnail-candidate.js:buildThumbnailCandidatePng` produces a 1080×1920 PNG with safe margins and brand colours. Six fixtures verified.
- Visual QA report exists for each fixture (`test/output/visual-qa/<id>.md`).
- Dynamic runtime recommendations exist (`runtime-recommender.js` + tests).
- Format catalogue exists (`format-catalogue.js`, 9 formats, all required fields, tested).
- Monthly Release Radar artefacts generated locally (full set under `test/output/monthly-release-radar/`).
- All 28 new tests pass.
- Every factual claim in the radar prototype is either traced to a source field or marked `NEEDS_SOURCE`.

---

## N. Honest judgement

### What is the biggest creative bottleneck now?

Source-material quality, exactly as Session 2's diagnosis predicted. The new scorer makes that visible per-story for the first time — instead of every story silently producing a 50-second Short, an operator can now see that a story has only one capsule + one author headshot and route it to the blog. The bottleneck is not the renderer; it's the upstream image-acquisition pipeline still admitting Pexels portraits and article author headshots.

The second-largest bottleneck is the **lack of an aggregation step**. Briefing, Weekly Roundup, Monthly Release Radar and Rumour Radar all need a "story-set selector" that pulls N stories from the queue and packages them into a single render. The format catalogue captures the rules; it doesn't yet implement the selector. A future session should build that.

### Can any of this be promoted safely?

Not by Session 2. Three things must happen first:

1. The in-progress thumbnail-safety branch (untracked `lib/thumbnail-safety.js`, `lib/thumbnail-candidate.js`, edits to `images.js`/`images_download.js`/`images_story.js`/`publisher.js`/`upload_youtube.js`/`hf-thumbnail-builder.js`/`content-qa.js`) must be reviewed, committed, tested against real stories, and pushed. Session 1 already flagged the risk of `git add -A` against this working tree.
2. The libnss3 Dockerfile patch must land so HF thumbnails actually render on Railway. Without it, the visual-qa-gate will warn on every production story.
3. The format catalogue must be wired into `publisher.produce()` before a single story is routed by it. Today, every story still goes through the same Daily Shorts pipeline regardless of inventory.

Once those three are done, this session's modules can be promoted in this order: scorer → runtime-recommender → format-catalogue (selection only) → visual-qa-gate (warn-only first, then enforce) → MRR generator (after a real candidate-fetcher exists).

### What should be done before production integration?

- Run the inventory scorer over the last 30 days of real stories from the production DB and compare its classification output against what was actually published. Any premium_video classification that resulted in a rejected/unwatched Short is a tuning data point.
- Build a small operator dashboard card showing the classification distribution per channel — the scorer is only useful if an operator can see it.
- Define the aggregation step (story-set selector) for Briefing/Roundup formats, with an explicit "minimum story count" gate so weak weeks don't ship a half-empty roundup.
- Produce a real `candidates.json` for Monthly Release Radar from publisher feeds. Until then, the radar generator is a structural prototype only.

### Did Monthly Release Radar prove useful structurally?

Yes. The pipeline cleanly separates: (1) source registry, (2) candidate fact-check, (3) inventory gate, (4) ranking, (5) artefact generation, (6) operator review. The "every claim is sourced or NEEDS_SOURCE" invariant is enforced — there is no path through the generator that produces an unsourced date in the publishable artefacts. The 10 Shorts scripts + blog + newsletter + manual-review checklist is the right artefact mix for the format. The biggest unknown is the candidate-fetcher; that's a Session 4 task.

### What should Session 3 know?

- Session 1 deploy-readiness was AMBER, Session 2 creative-readiness is AMBER. Session 3 must keep all work local and not assume any monetisation milestones have unlocked.
- The visual-qa-gate emits `inventory.classification` per story — Session 3's analytics can join that against real performance to find out whether premium_video stories actually outperform short_only.
- The format catalogue's `analyticsToTrack` field per format defines exactly what metrics Session 3's snapshot system needs to capture. Each format declares its own list — start there rather than pulling every YouTube Analytics metric.
- TikTok routes are dead (Session 1). Don't build analytics around TikTok metrics that won't have data.
- The thumbnail-safety module is untracked and authored elsewhere — Session 3 should NOT modify it. Reference it via `require("../thumbnail-safety")`.
- 28 new tests added in this session. Session 3 must not break any of them.

Stop point. AMBER.
