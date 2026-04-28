# PULSE — Intelligence / Analytics / Monetisation Pass (Session 3)

Generated: 2026-04-28T19:15Z (UTC) on branch `codex/pulse-enterprise-hardening`.

---

## A. Do not do list

This session never:

- triggered OAuth or printed token values
- changed live env vars or Railway state
- ran production produce/publish jobs
- sent YouTube replies, likes, hearts or moderation actions
- modified live comments
- modified production DB rows
- changed scheduler/queue architecture
- changed platform uploaders
- changed render engine or canonical Studio V2 defaults
- altered scoring weights anywhere
- promoted formats based on insufficient data
- assumed monetisation that is not yet unlocked
- copied scripts/wording/assets from any other channel

Specifically do not promote:

- Migration `017_intelligence_layer.sql` is **applied locally only**. It is committed in this branch but the operator must `git push` and let Railway redeploy before it lives in prod.
- The fixture-mode analytics client must NOT be flipped to real mode without the operator first granting `yt-analytics.readonly` and explicitly setting `INTELLIGENCE_REAL_MODE=true`.
- The comment ingest client never sends, hearts or moderates. Even after it gains real-mode read access, the reply queue stays draft-only.
- The monetisation snapshot is built from a fixture state, not from production data. Do not interpret the cleared/total ratio as actual progress.

---

## B. Prior session constraints observed

| Source            | Constraint                                                                                                                  | How Session 3 obeyed                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session 1 (AMBER) | "Do not push `main`. Local main is +5 commits ahead of `origin/main`."                                                      | No commits made. Working tree carries new files only.                                                                                                                                              |
| Session 1         | Working tree contains 8 unrelated tracked files mid-flight (thumbnail-safety feature)                                       | Untouched.                                                                                                                                                                                         |
| Session 1         | TikTok direct API rejected; Buffer's developer API closed for new accounts                                                  | Strategy module documents both routes as blocked. Recommendation prioritises the official-API-business-reapply route, with third-party scheduler as fallback.                                      |
| Session 1         | `libnss3` Dockerfile gap blocks HF thumbnail rendering on Railway                                                           | Acknowledged. Feature extractor reads `thumbnail_safety_status` from Session 2's visual-QA gate; that gate already flags missing thumbnail candidates.                                             |
| Session 1         | Scheduler, queue, platform uploaders untouched                                                                              | Untouched.                                                                                                                                                                                         |
| Session 2 (AMBER) | Creative readiness AMBER. Modules fixture-tested only.                                                                      | Session 3 reuses the Session 2 inventory scorer + visual-QA gate via `lib/intelligence/feature-extractor.js`. Fixture-only assumptions match.                                                      |
| Session 2         | Format catalogue exists but is not yet wired into production. Session 3 should reference its `analyticsToTrack` per format. | The intelligence layer's `format_performance_summary` table groups by `format_type` exactly. Each format declared its analytics list in Session 2 — Session 3's snapshot table covers all of them. |
| Session 2         | Aggregate formats (Briefing, Roundup, Radar) need a story-set selector before they can run                                  | Out of scope this session. Documented in §O as a follow-up.                                                                                                                                        |
| Session 2         | TikTok routes are dead. Don't build analytics around metrics with no data.                                                  | Monetisation tracker ships TikTok Creator Rewards milestones but explicitly notes the posting blocker; analytics client snapshots are YouTube only.                                                |

No Session 1 or Session 2 stop condition was triggered.

---

## C. YouTube Analytics readiness

### Inspected (without printing tokens)

`upload_youtube.js:131-135` declares the OAuth scope list:

```
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube
https://www.googleapis.com/auth/youtube.force-ssl
```

What's already authorised:

| Capability                                                   | Scope present?                                      |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `videos.list` (per-video views/likes/comments)               | ✅ via `youtube`                                    |
| `commentThreads.list` (read comments)                        | ✅ via `youtube` / `youtube.force-ssl`              |
| `commentThreads.insert`, `comments.insert` (write replies)   | ✅ via `youtube.force-ssl` (intentionally NOT used) |
| Channel listing, playlist read/write                         | ✅                                                  |
| **YouTube Analytics API** (`youtubeAnalytics.reports.query`) | ❌ **MISSING**                                      |
| Revenue / earnings (`yt-analytics-monetary.readonly`)        | ❌ MISSING (n/a until YPP)                          |

### What runs now (no re-auth needed)

- Per-video stats via `videos.list?part=statistics` — already used by the existing `analytics.js:fetchYouTubeStats`
- Comment ingestion via `commentThreads.list` — usable by `lib/intelligence/comment-ingest.js` real mode
- Channel and playlist listing

### What requires re-authorisation

`https://www.googleapis.com/auth/yt-analytics.readonly` is required for:

- Average view duration (AVD) at video level
- Average view percentage (AVP) at video level
- Audience retention curve
- Traffic source breakdown
- Shorts feed source data
- Subscribers gained/lost per video over a window
- Estimated minutes watched at the video/channel level

To authorise later (do NOT trigger now):

1. Append `"https://www.googleapis.com/auth/yt-analytics.readonly"` to the scope list in `upload_youtube.js:131-135`.
2. Run `node upload_youtube.js auth` and complete the consent flow.
3. Run `node upload_youtube.js token <CODE>`.
4. Set `INTELLIGENCE_REAL_MODE=true` in env.
5. Real-mode pulls become safe to invoke from `lib/intelligence/analytics-client.js`.

### Real-mode safety gate

`buildAnalyticsClient({ mode: 'real' })` THROWS unless `INTELLIGENCE_REAL_MODE=true` is set. Real mode also requires the caller to pass `options.authClient` — the client never initiates OAuth. Tests cover both branches:

- `tests/services/intelligence-pass.test.js:74` — fixture mode emits 6 snapshot labels
- `tests/services/intelligence-pass.test.js:79` — real mode rejects without the env flag
- `tests/services/intelligence-pass.test.js:84` — declares the missing scope

Until the operator authorises the new scope, all reports are fixture-mode.

---

## D. Snapshot / checkpoint system

Migration `017_intelligence_layer.sql` adds nine tables to the local SQLite store:

| Table                         | Purpose                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `video_performance_snapshots` | Append-only per-checkpoint metric snapshot. Includes `snapshot_label` for the +1h / +3h / +24h / +72h / +7d / +28d cadence.                                                           |
| `video_features`              | Per-video editorial features: format, hook type, title pattern, runtime, render version, source mix, **media inventory class** (Session 2), thumbnail safety status, visual QA class. |
| `comment_insights`            | Per-comment classification: category, decision, sentiment, useful signal, draft reply, manual-review flag.                                                                            |
| `comment_signal_summary`      | Per-window aggregate of comment categories + decisions.                                                                                                                               |
| `format_performance_summary`  | Per-format aggregates over a window: median views, AVP, AVD, subscribers gained, best/worst video.                                                                                    |
| `topic_performance_summary`   | Per-topic aggregates.                                                                                                                                                                 |
| `learning_recommendations`    | Open/acted recommendations from the learning digest. Append-only.                                                                                                                     |
| `experiment_results`          | Local experiment tracker with hypothesis + variant + status.                                                                                                                          |
| `monetisation_milestones`     | Append-only milestone snapshots — current vs threshold per milestone.                                                                                                                 |

Existing `lib/performance/schema.sql` (used by an earlier intelligence prototype) overlapped on three tables; migration 017 promotes them to versioned migrations and adds the missing four (`comment_signal_summary`, `format_performance_summary`, `topic_performance_summary`, `monetisation_milestones`) plus an explicit `experiment_results` table.

Snapshot labels are the contract:

```
+1h, +3h, +24h, +72h, +7d, +28d
```

The fixture analytics client emits one row per label per video so digests can be tested end-to-end without a YouTube round-trip.

---

## E. Video feature extraction

`lib/intelligence/feature-extractor.js:extractVideoFeatures(story)` joins three Session 2 systems:

1. `scoreStoryMediaInventory` (media inventory scorer) — provides `media_inventory_class`, `clip_ratio`, `still_ratio`, `card_ratio`, `source_diversity`.
2. `evaluateStoryVisualQa` (visual QA gate) — provides `visual_qa_class` and `thumbnail_safety_status`.
3. `selectFormatForStory` (format catalogue) — provides `format_type`.

Plus per-story heuristics:

- `title_pattern`: `question` / `is_real_reveal` / `confirmed_reveal` / `leak_rumour` / `year_led` / `list_format` / `statement` / `unknown`
- `hook_type`: `hard_reveal` / `question` / `fact_stack` / `callback` / `general` / `unknown`
- `topic`: `playstation` / `xbox` / `nintendo` / `pc_steam` / `rumour` / `general`
- `franchise`: regex-detected from a known list (GTA, Final Fantasy, Zelda, Mario, Call of Duty, etc.)
- `flair_confidence`: from Session 2's `confidenceFromFlair` — `confirmed` / `verified` / `likely` / `rumour` / `unknown`

Output shape matches the `video_features` table schema 1:1, so persistence is a simple insert.

The extractor is a pure function — no DB read, no network. Tested in `tests/services/intelligence-pass.test.js:213+`.

---

## F. Learning digest

`lib/intelligence/learning-digest.js:buildLearningDigest({ snapshotsByVideo, features, commentSummary, windowDays })` produces:

- `overall` — median views/AVP/AVD/subs/comments + best/worst video
- `by_format` — sorted by median AVP; `format_type → { sample_count, median_*, confidence }`
- `by_topic` — sorted by median views
- `by_title_pattern` — sorted by median AVP
- `by_inventory_class` — sorted by median AVP (links Session 2's classifier to performance)
- `subscriber_gainers` — top 5 videos by subscribers_gained
- `comment_heavy` — top 5 by comment count
- `underperformers` — videos below 70% of overall median AVP
- `recommendations` — `do_more_of` / `do_less_of` / `inventory_signal`, each gated on confidence
- `experiments_suggested` — A/B candidates (e.g. title pattern A vs B) with sample-size requirements
- `comment_signal_summary` — passes through the comment counts
- `safety` — explicit flags: `auto_promote_formats: false`, `auto_demote_formats: false`, `auto_change_scoring_weights: false`, `operator_review_required: true`

### Confidence levels

Computed from sample size per bucket:

| Sample size | Label                                      |
| ----------- | ------------------------------------------ |
| 0-2         | `insufficient` (no recommendation emitted) |
| 3-5         | `low`                                      |
| 6-11        | `medium`                                   |
| 12+         | `high`                                     |

### How to interpret

1. Confidence `insufficient` → ignore the bucket completely. Never act on it.
2. Confidence `low` → look at the result. Add to the watchlist; don't change cadence.
3. Confidence `medium` → consider as a soft signal. Note it in the next experiment.
4. Confidence `high` → consider as a stable signal. Open a recommendation row.

Recommendations are written into `learning_recommendations` with `priority: 'review'` and `status: 'open'`. The operator decides whether to act. **No scoring weight is changed automatically** — the prompt's hard rule.

### Sample output

`test/output/learning-digest/digest-2026-04-28.md` (run today against fixture data, 6 videos):

```
total_videos: 6
confidence: medium
overall.median_views: 472
overall.median_avp: ~0.58 (fixture-derived)
recommendations: 2 (do_more_of, inventory_signal)
experiments_suggested: 0
```

The fixture deliberately doesn't surface a clear A/B title-pattern winner, so `experiments_suggested` is empty — that's correct behaviour for thin data.

---

## G. Comment Copilot

### Ingest

`lib/intelligence/comment-ingest.js` exposes a fixture-mode and a real-mode client. Fixture mode returns 12 representative comments covering all 11 categories.

Real mode requires:

- `INTELLIGENCE_REAL_MODE=true`
- An OAuth `authClient` passed in by the caller
- Existing `youtube` or `youtube.force-ssl` scope (already authorised)

The real-mode call is `commentThreads.list?part=snippet&videoId=...&textFormat=plainText` with pagination. Read-only.

### Classifier

`lib/intelligence/comment-classifier.js:classifyComment(comment)` returns one of:

| Category           | Typical decision        |
| ------------------ | ----------------------- |
| `hype`             | `no_reply_needed`       |
| `support`          | `no_reply_needed`       |
| `correction`       | `needs_review`          |
| `disagreement`     | `no_reply_needed`       |
| `useful_criticism` | `needs_review`          |
| `topic_suggestion` | `needs_review`          |
| `question`         | `draft_reply_candidate` |
| `joke_meme`        | `ignore`                |
| `hostile_useful`   | `needs_review`          |
| `abuse_spam`       | `moderation_review`     |
| `noise`            | `ignore`                |

Pure / sync. No LLM. Same input always returns the same verdict — important for tests and audit trails.

### Reply queue

`lib/intelligence/reply-drafter.js:buildReplyQueue(verdicts)` produces drafts ONLY for `draft_reply_candidate` and `needs_review` decisions. Every entry is tagged:

```js
{
  is_draft: true,
  auto_send: false,
  requires_operator_review: true,
  text: "...",
  safety_notes: [
    "never sent automatically",
    "never used as a like/heart/moderation action",
    "operator must review before posting"
  ]
}
```

Spam and abuse comments NEVER get drafts. Hype and noise NEVER get drafts.

### Output artefacts

`tools/intelligence/run-comment-digest.js` writes:

- `test/output/comment-digest/comments-<date>.json` — full classified verdicts
- `test/output/comment-digest/reply-queue-<date>.json` — operator review queue
- `test/output/comment-digest/viewer-signals-<date>.json` — corrections, topic suggestions, useful criticism, moderation flags
- `test/output/comment-digest/comments-<date>.md` — Markdown summary

Run today (12 fixture comments): 5 reply candidates, 2 moderation flags, 1 topic suggestion, 1 correction.

### Safety boundaries

- Never sends replies
- Never likes/hearts
- Never moderates
- Never impersonates a human (drafts read as "we" / "the channel")
- Corrections are surfaced to the operator, not argued with
- Topic suggestions feed the learning digest

---

## H. TikTok automation strategy

`lib/intelligence/tiktok-strategy.js:ROUTES` ranks the five routes the prompt asks for. Each route is rated across same-day-breaking-news suitability, Personal-account compatibility, Creator Rewards implications, 60s+ support, mobile confirmation requirement, account risk, cost, reliability, how Pulse would feed it, and explicit blockers.

| Rank | Route                                          | Same-day breaking news    | Account risk           | Cost                         | Notes                                                                                                     |
| ---- | ---------------------------------------------- | ------------------------- | ---------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1    | Re-apply to official API as media/business app | yes (auto-publish)        | low                    | free + audit time            | only durable path; loses Personal-account Creator Rewards in some regions                                 |
| 2    | Third-party scheduler with TRUE auto-publish   | yes (depends on tool)     | low/medium             | $5-15/mo per channel         | Buffer is dead for new accounts; evaluate Sprinklr/Sprout/Loomly/Metricool for genuine no-confirm publish |
| 3    | Phone-friendly approval/dispatch               | yes if operator reachable | very low               | operator time only           | Pulse renders → signed URL → phone confirm                                                                |
| 4    | Browser/RPA automation                         | yes but brittle           | **HIGH (account ban)** | engineering + hosted browser | research-only; never run for breaking-news cadence                                                        |
| 5    | Virtual assistant                              | yes during VA shift       | very low               | $8-25/hr                     | last resort                                                                                               |

`recommend({ canMigrateToBusiness, hasOperatorOnPhone })` returns the primary recommendation, fallback, rejected routes (with reasons), and notes. Browser RPA is **always rejected** with `"TikTok's terms forbid automated access — account ban risk"`.

For the current operator profile (`canMigrateToBusiness: false`, `hasOperatorOnPhone: true`):

- Primary: third-party scheduler with auto-publish
- Fallback: phone-friendly approval/dispatch
- Rejected: official API reapply (until business migration is decided), browser RPA (always), VA (until the others are confirmed dead)

Notes from the recommendation:

> Buffer's developer API is closed for new accounts. Evaluate Sprinklr / Sprout / Loomly / Metricool for true auto-publish on Personal accounts.

If the operator decides to migrate to a Business account:

- Primary becomes the official API reapply
- Fallback stays third-party scheduler
- Notes warn: "Confirm Creator Rewards status under Business account before migrating — the account-type change is one-way in some regions."

Pulse's existing render output already feeds the dispatch packs in Session 1 — no new media work needed. The decision is operator/business, not technical.

---

## I. Monetisation roadmap

Built milestone-by-milestone. **No fantasy revenue numbers.** Every milestone reports current vs threshold and a concrete unlock path.

### YouTube Partner Programme (YPP)

| Milestone                         | Threshold  | Unlock            |
| --------------------------------- | ---------- | ----------------- |
| Subscribers                       | 1,000      | YPP base          |
| Shorts views (90 days)            | 10,000,000 | YPP via Shorts    |
| Long-form watch hours (12 months) | 4,000      | YPP via long-form |

Eligibility = subscribers cleared **AND** ONE of the two watch paths.

### Affiliate

- Amazon UK affiliate tag — already live (binary). Tracker confirms presence; earnings rate depends on category and is not modelled.

### Newsletter

- Beehiiv subscribers (threshold 100 for sponsor floor) — present in `lib/intelligence/monetisation-tracker.js` per the user's saved memory that Pulse uses Beehiiv + Substack.
- Substack subscribers (same threshold).

### Blog / SEO

- Indexed pages ≥ 30 → unlock search traffic
- Blog monthly pageviews ≥ 5,000 → unlock search ad revenue

### Sponsorship

- Average view duration on Shorts ≥ 28 s (sponsors care about completion, not raw views)
- Subscribers ≥ 5,000 (conventional minimum for paid gaming sponsorships)

### TikTok Creator Rewards

- Followers ≥ 10,000 (path blocked by current TikTok posting situation — note included on the milestone)
- Views (30 days) ≥ 100,000 (same blocker)

### Sample snapshot (FIXTURE state)

`test/output/monetisation/monetisation-2026-04-28.md`:

- Cleared milestones: 1 / 12 (the Amazon affiliate tag is the only live cleared milestone)
- YPP eligible: false
- YPP blockers: subscriber threshold + (Shorts 10M OR long-form 4,000h)
- Primary TikTok recommendation: third-party scheduler with auto-publish
- Fallback: phone-friendly dispatch
- Rejected: browser RPA (account ban risk)

The numbers in the fixture are placeholders. An operator must overwrite `FIXTURE_STATE` in `tools/intelligence/run-monetisation-snapshot.js` (or pass real values via the module API) before treating the cleared/total ratio as actionable.

### What's realistic at current scale

- Affiliate revenue today: small but live.
- Newsletter cross-post: low effort, will compound.
- YPP: months away, contingent on which watch path Pulse leans into.
- Sponsorship: not before 5k subscribers AND 28s+ Shorts AVD.
- TikTok Creator Rewards: blocked at posting layer, not at analytics layer. Resolve §H first.

No revenue is forecast in dollars. Every unlock is a gate; no gate has a dollar value attached. The framework is "what data do we need, what's blocked, what's the realistic next gate" — exactly what the prompt asked for.

---

## J. Cost / quota / running-risk notes

| Item                                 | Practical limit                        | Notes                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube Data API quota               | 10,000 units/day default               | Per-video upload ≈ 1,600 units. `videos.list?part=statistics` ≈ 1 unit per video. `commentThreads.list` ≈ 1 unit per page (50 comments). 1,000 videos with comments and stats fits comfortably under quota. |
| YouTube Analytics API quota          | Channel-scoped, separate from Data API | Modest; not a binding constraint at our scale. **Re-auth required** before this matters.                                                                                                                    |
| Comment ingestion quota              | ~1 unit per page                       | Pulse has tens of comments per video; one page per video is enough.                                                                                                                                         |
| Storage growth (intelligence tables) | append-only snapshots + comments       | Estimate ≈ 50 KB / day at current volume. SQLite handles this trivially. The `output/` media volume is the actual storage risk (Session 1 §H).                                                              |
| TTS cost exposure on longer formats  | will scale linearly with runtime       | Briefing format ≈ 180s ≈ 3x Shorts cost per video. Roundup ≈ 480s. Radar ≈ 1,200s. Watch monthly ElevenLabs spend if these formats activate.                                                                |
| Railway running cost                 | unknown precise figure                 | Single web service + persistent volume + queue. The volume size is what binds the bill.                                                                                                                     |
| Third-party scheduler cost           | $5-15/mo per channel typical           | Buffer free tier limited; paid tiers around $5-15/mo per channel for vendors that support genuine TikTok auto-publish.                                                                                      |
| VA fallback cost                     | $8-25/hr typical                       | Region-dependent. ~10-20 minutes of VA time per video.                                                                                                                                                      |
| Monitoring/logging cost              | low                                    | Existing Sentry breadcrumbs + Railway logs. No additional logging spend introduced this session.                                                                                                            |

### Storage monitor follow-up

Session 1 already flagged the lack of a `cleanup_old_media` schedule. The intelligence-layer tables are tiny by comparison, but should still be reviewed once `video_performance_snapshots` accumulates 6 months of `+28d` rows.

---

## K. Files changed

This session, working tree only — no commits, no pushes:

| File                                              | Status | Purpose                                                                                     |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `db/migrations/017_intelligence_layer.sql`        | new    | nine tables (snapshots, features, comments, summaries, learning, experiments, monetisation) |
| `lib/intelligence/analytics-client.js`            | new    | fixture-mode + real-mode YouTube Analytics client; never initiates OAuth                    |
| `lib/intelligence/comment-classifier.js`          | new    | pure regex/keyword classifier; 11 categories, 5 decisions                                   |
| `lib/intelligence/comment-ingest.js`              | new    | fixture-mode + real-mode `commentThreads.list` reader                                       |
| `lib/intelligence/reply-drafter.js`               | new    | draft-only reply generator; every output tagged `is_draft: true, auto_send: false`          |
| `lib/intelligence/feature-extractor.js`           | new    | per-video feature row joining Session 2 inventory + visual QA + format catalogue            |
| `lib/intelligence/learning-digest.js`             | new    | digest builder + Markdown writer; never auto-changes scoring                                |
| `lib/intelligence/monetisation-tracker.js`        | new    | milestone tracker; no fantasy revenue numbers                                               |
| `lib/intelligence/tiktok-strategy.js`             | new    | 5 routes, ranked, with explicit browser-RPA rejection                                       |
| `tools/intelligence/run-learning-digest.js`       | new    | CLI; writes JSON+MD to `test/output/learning-digest/`                                       |
| `tools/intelligence/run-comment-digest.js`        | new    | CLI; writes JSON+MD to `test/output/comment-digest/`                                        |
| `tools/intelligence/run-monetisation-snapshot.js` | new    | CLI; writes JSON+MD to `test/output/monetisation/`                                          |
| `tests/services/intelligence-pass.test.js`        | new    | 28 tests covering all of the above                                                          |

Nothing modified. Nothing deleted. No production source file edited.

---

## L. Artefacts generated

| Path                                                        | Description                                              |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `test/output/learning-digest/digest-2026-04-28.json`        | machine-readable learning digest                         |
| `test/output/learning-digest/digest-2026-04-28.md`          | operator-readable digest                                 |
| `test/output/comment-digest/comments-2026-04-28.json`       | classified verdicts (12 fixture comments)                |
| `test/output/comment-digest/reply-queue-2026-04-28.json`    | 5 draft reply candidates (none auto-sent)                |
| `test/output/comment-digest/viewer-signals-2026-04-28.json` | corrections / suggestions / criticism / moderation flags |
| `test/output/comment-digest/comments-2026-04-28.md`         | operator-readable comment digest                         |
| `test/output/monetisation/monetisation-2026-04-28.json`     | milestone snapshot                                       |
| `test/output/monetisation/tiktok-2026-04-28.json`           | TikTok strategy recommendation                           |
| `test/output/monetisation/tiktok-routes-2026-04-28.json`    | full ranked-route table                                  |
| `test/output/monetisation/monetisation-2026-04-28.md`       | operator-readable monetisation snapshot                  |

---

## M. Validation

| Check                                               | Result                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| Migration 017 applied to local DB                   | success — all 9 tables present                                      |
| Targeted intelligence tests                         | **28 / 28 pass**                                                    |
| Full test suite (Session 1 + Session 2 + Session 3) | **960 / 960 pass, 0 fail**                                          |
| `npm run build`                                     | **passes**, 561 ms                                                  |
| Learning digest end-to-end (fixture)                | success: 6 features, 6 videos, confidence=medium, 2 recommendations |
| Comment digest end-to-end (fixture)                 | success: 12 comments, 5 draft replies, 2 moderation flags           |
| Monetisation snapshot end-to-end (fixture)          | success: 1/12 cleared, YPP eligible=false                           |
| TikTok strategy ranking                             | success: 5 routes, browser RPA always rejected                      |

Skipped (per stop conditions):

- No OAuth flow exercised
- No real YouTube Analytics call made
- No real comment listing call made
- No production data read or written
- No platform mutation
- No monetisation eligibility assumed

---

## N. Intelligence readiness gate

**AMBER**

### Why not GREEN

- Analytics client is fixture-mode only. Real ingestion requires the operator to add `yt-analytics.readonly` to the OAuth scope list and re-authorise. This is a one-time operator action that cannot happen from this session per the safety rules.
- Comment ingestion is fixture-mode only by default. Real-mode read works against the existing scopes but is gated behind `INTELLIGENCE_REAL_MODE=true` so the operator must opt in.
- Monetisation snapshot is built from a fixture state. Real values require an operator to wire YouTube Analytics + Beehiiv + Substack + GA4 (or equivalent) into the snapshot.
- Migration 017 is committed locally only (alongside the +5 unpushed commits Session 1 flagged). Until origin/main moves forward, the production DB does not have the new tables.

### Why not RED

- No OAuth was triggered.
- No replies/likes/hearts/moderation actions are sendable from any module in this session — every reply path is gated `is_draft: true` and the inserts/posts methods on the platform clients are not wired in.
- No scoring weight was changed. The learning digest's `safety` block declares all four auto-\* flags `false`.
- No monetisation eligibility is assumed beyond what the fixture state declares.
- All tests pass (960/960). Build passes.
- No secrets/tokens were printed.
- No production data was read or written.

### Operator gates before promoting

1. Append `yt-analytics.readonly` to the OAuth scope list in `upload_youtube.js:131-135`.
2. Re-authorise via `node upload_youtube.js auth` then `node upload_youtube.js token <CODE>`.
3. Decide whether to run real-mode comment ingestion (existing scopes already cover it; the gate is opt-in via `INTELLIGENCE_REAL_MODE=true`).
4. Push branch + redeploy Railway so migration 017 lands in the production DB.
5. Run `node tools/intelligence/run-learning-digest.js` against real snapshot data once it accumulates a 7-day window.
6. Run `node tools/intelligence/run-monetisation-snapshot.js` with real channel state.

---

## O. Honest judgement

### What is ready now?

- The schema for the entire intelligence/monetisation surface — migration 017 is written and applied locally.
- The classifier + draft-reply system — no LLM call required, deterministic, audit-friendly. Could run against fixture data forever and continue to be useful.
- The monetisation tracker — runs against any state-snapshot dictionary. The values are operator-supplied, not estimated.
- The TikTok strategy module — encodes Pulse's actual situation (direct API rejected, Buffer dead) and ranks routes accordingly. Browser RPA is always rejected.
- The learning digest — emits Markdown + JSON, declares its confidence, never auto-changes anything.
- 28 new tests, all green. Full suite 960/960.

### What needs OAuth approval?

- Adding `yt-analytics.readonly` to the OAuth scope list. Without it, the analytics client stays in fixture mode.
- Nothing else needs new approval. Comment read, channel listing, video stats already work under existing scopes.

### What should remain manual?

- Replies (always — never auto-sent, even if a future session wires the API call).
- Hearts/likes (no module produces them; if an operator wants to heart, that's a manual action).
- Moderation (the moderation_review category surfaces flagged comments to the operator; no automatic moderation action is ever taken).
- Scoring weight changes (the digest emits recommendations, the operator decides).
- TikTok posting (until the operator picks one of the five routes — see §H).

### What should not be automated?

- Reply sending. **Ever**, per the prompt.
- Format promotion/demotion. The digest's `safety` block is explicit: `auto_promote_formats: false, auto_demote_formats: false`. An operator must read the recommendation and decide.
- Monetisation milestone state. The values come from the operator, never from the channel directly — guards against accidentally treating a fixture as real.

### What is the highest-leverage next intelligence step?

Run the **scope re-auth**. Everything else in this session is plumbing waiting for real data. With `yt-analytics.readonly` granted, the fixture-mode analytics client immediately becomes a real-mode client; the digest immediately becomes data-driven; the format catalogue's `analyticsToTrack` per format finally has a feed.

Second-highest: **wire format selection into `publisher.produce()`** so the feature extractor's `format_type` column is populated by the orchestrator, not just inferred. The Session 2 catalogue + Session 3 schema together support this, but `publisher.produce()` still treats every story the same.

### What should be watched over the next 7 days?

- Whether any of the `+24h` snapshots show unexpectedly low AVP — that's the canary for the libnss3 thumbnail problem (Session 1 carry-over). If thumbnails stay sub-optimal, AVP stays sub-optimal.
- Whether comments come in with `useful_criticism` flags at a higher rate than the fixture suggests — the regex is conservative and might miss real criticism.
- Whether the unpushed +5 commits cleared review and got pushed. Until they do, Railway is stale and migration 017 cannot land.
- Whether any operator manually changed scoring weights in production. The digest never does it; if a value drifts, that's a separate change.

Stop point. AMBER.
