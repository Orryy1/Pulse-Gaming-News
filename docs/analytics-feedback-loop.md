# Analytics Feedback Loop — Design Doc

**Status:** design only — not implemented.
**Scope:** Pulse Gaming first; multi-channel parked behind [`docs/multi-channel-roadmap.md`](./multi-channel-roadmap.md).
**Author context:** 2026-04-21 overnight hardening session.

---

## Why

Pulse Gaming publishes ~1 video/day across 4 platforms (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels). Today the pipeline **pushes** content out and **pulls** view counts back. What it doesn't do is **close the loop** — nothing about last week's wins or flops changes what hunter picks tomorrow, what classification it gets, or which hook/title variant processor.js writes next.

This doc is the blueprint for that feedback loop, with a heavy bias toward safety: humans stay in the loop for every knob that could degrade content quality, and automation is reserved for the few places it can't go wrong.

---

## Metrics to collect, per platform

Already collected (in `analytics_snapshots` table, refreshed by `handleAnalytics`):

| Metric         | Sources                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| views          | YT (`statistics.viewCount`), TT (`video_info.view_count`), IG (`media_insights` impressions+reach), FB (Graph insights) |
| likes          | same four                                                                                                               |
| comments       | YT, TT, IG, FB                                                                                                          |
| shares         | TT only (other platforms don't expose)                                                                                  |
| virality_score | pre-computed composite weighted by views / engagement / time-elapsed                                                    |

Missing today, needed for the loop:

| Metric                                  | Sources                                                                        | Why it matters                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **watch-through rate**                  | YT Analytics API (`averageViewPercentage`), TT `full_video_watched_rate`       | The single most important hook-quality signal on Shorts/Reels. A 60% watch-through on a 50s short tells us the hook landed; a 30% watch-through with high views tells us the thumbnail clickbaited. |
| **impressions → views CTR**             | YT Analytics (`cardImpressions` + `cardClickRate` + Shorts feed `impressions`) | Directly rates title + thumbnail. Without it, "views" is ambiguous (good hook vs. good placement).                                                                                                  |
| **comment sentiment rollup**            | a small Claude pass over the top N comments per video                          | Hints at whether the audience felt baited, misinformed, or served well. Zero-shot positive/neutral/negative + "was the leak verified per audience?" tag.                                            |
| **subscriber/follower delta per video** | YT / TT channel-stats snapshots before and after                               | Which topics actually grow the channel vs. which only farm views.                                                                                                                                   |
| **retention curve data points**         | YT Analytics retention-curve endpoint (0%, 25%, 50%, 75%, 100%)                | Reveals drop-off points; hooks a future "auto-tighten long intro" prompt.                                                                                                                           |
| **referrer / traffic source mix**       | YT `insightTrafficSourceType`, TT `sources_breakdown`                          | Distinguishes algorithmic recommendation vs. search vs. external. A video that lives on search is worth more long-tail than one that lived on the feed for 48h.                                     |

---

## What joins back to what

Every metric above must survive a join to:

1. `stories.id` — the canonical editorial record
2. `stories.title_variants` + `active_title_index` — so AB variant performance is traceable
3. `stories.hook`, `stories.classification` (Verified / Rumour / Breaking), `stories.content_pillar` (Confirmed Drop / Source Breakdown / Rumour Watch), `stories.subreddit` / `source_type`, `stories.company_name`
4. `stories.published_at` — for time-since-publish normalisation
5. `stories.breaking_score` — so we can learn whether the scoring model's current weights correlate with actual view performance
6. `channel_id` (once [`docs/channel-isolation-audit.md`](./channel-isolation-audit.md) Step 1 lands) — so per-channel learning stays scoped

Practically: extend the existing `analytics_snapshots` row with the new columns, or add a separate `story_metrics_extended` table keyed on `story_id` + `snapshot_at`. The second is cleaner because the shapes diverge (watch-through is a single percentage; retention is an array).

---

## First safe feedback loop for Pulse Gaming

The inner loop should be **scoring-input**, not **content-output**:
let the learning change which stories we PICK, not what we SAY about them.

### Phase 1 — passive reporting (no automation)

Deliverables:

1. A daily Discord digest at 23:00 UTC: "Today's video: X views, Y% watch-through, Z comments, sentiment mix Z%." Sent to the existing `notify.js` webhook.
2. A rolling 7-day "top hooks / top classifications / top content pillars" summary in the dashboard, read directly off `analytics_snapshots` + the extended table.
3. Zero automated decisions. The operator reads the digest, forms opinions, and hand-tunes `lib/scoring.js` weights via git if needed.

This phase alone is enough to catch "Rumour Watch pieces get 3× views but 0.3× watch-through" — the sort of insight that changes editorial strategy.

### Phase 2 — score-boost from last-7-day performance

Once Phase 1 has 4+ weeks of data, add a scoring input to
`lib/scoring.js`:

```
trend_boost = normalise(avg_virality of stories with same
                        content_pillar + classification in last
                        7 days, relative to all-pillar average)
```

Applied as a small (±5 points) adjustment on top of the existing
score, **never** overriding a hard-stop rule. This nudges hunter
toward categories that are currently working and away from ones
that have been flopping.

- **Does not automate title/hook generation.**
- **Does not change classification thresholds.**
- Always log the applied boost so an operator review can see
  why a story scored what it did.
- A kill switch (`ANALYTICS_SCORING_BOOST=false`) reverts to the
  baseline score instantly.

### Phase 3 — title/hook variant evaluation

AB variants already exist (`title_variants[]` + `active_title_index`).
Today they're used manually. Once watch-through + CTR metrics land:

- Record per-variant impressions and CTR.
- After a 48h window, surface the winning variant in the dashboard
  with a "promote to primary" button — **never automatic**.
- Operator clicks to promote; the promotion is logged to
  `analytics_topic_stats` (or a new `title_variant_winners` table)
  so future prompts to processor.js can be given example winners
  in a few-shot block.

This is where the loop actually touches content generation — but
only via operator-approved few-shot examples, never a
self-optimising prompt.

---

## What should NEVER be automated without guardrails

These are the lines Pulse Gaming should not cross without a
deliberate, reviewed decision:

1. **Automatic changes to `lib/scoring.js` thresholds.** The
   scoring engine is the gate between "story" and "published to
   4 platforms". A feedback loop that auto-tunes thresholds has
   the potential to silently flip hard-stops on a topic that
   deserves them (e.g. dropping the "Verified flair required" bar
   because "Rumour Watch has better CTR").
2. **Auto-regeneration of scripts based on watch-through.**
   Quality collapse risk. A Claude pass that says "low retention →
   make the hook punchier" could trivially converge on clickbait.
   Humans gate script regeneration.
3. **Auto-publishing a different story to "replace" a flop.** The
   pipeline runs 1/day. Swapping stories out after the fact is
   indistinguishable from gaming the algorithm. Don't.
4. **Comment auto-reply based on sentiment.** Even "thanks!" to
   positive comments risks platform policy flags on bot behaviour.
   Pinned-comment automation is already in place; that's as far
   as this goes.
5. **Cross-account learning without channel isolation.** Before
   feedback loops can learn across channels, the
   [channel isolation work](./channel-isolation-audit.md) must
   ship. Otherwise a finance-channel insight could nudge
   gaming-channel picks.

---

## Multi-channel considerations (later)

Once channel isolation lands, every feedback-loop signal must be
channel-scoped. The scoring boost in Phase 2 must compute
per-channel averages, not global. The Phase 3 variant-winner
table needs a `channel_id` column.

Per-channel audience behaviour is likely very different: a finance
audience might reward longer intros and dense titles, a gaming
audience rewards short hooks. The loop should NOT share learning
across channels by default.

---

## Open questions for a future planning session

- **Retention curve granularity**: 5 buckets (0/25/50/75/100%) is
  YouTube-native but TikTok only exposes average %. Is the curve
  worth the YT-only work, or is average enough cross-platform?
- **Comment sentiment via Claude**: $ cost and latency. A small
  daily batch (top 20 comments × 3 platforms = 60 comments) is
  trivial. Fuller per-video is $40-ish/month. Probably fine; flag.
- **Do we need a "trending topics" feedback signal?** Pulse already
  has `competitor_monitor.js` — its trending report is a separate
  feedback loop that arguably lives in the same doc. Scope boundary
  TBD.
- **What happens when a video goes viral?** A 10× outlier could
  warp the 7-day averages. Phase 2 should probably clip outliers
  at the 95th percentile for the boost input. Flag for
  implementation PR.

---

## Implementation order (when unblocked)

1. Add metrics collection: extend `analytics.js` to pull
   watch-through, CTR, retention, subscriber delta.
2. Extend `analytics_snapshots` schema (or add sibling table) for
   the new columns.
3. Ship Phase 1 Discord digest + dashboard rolling summary.
4. After 4+ weeks of data, ship Phase 2 scoring boost with kill
   switch.
5. Ship Phase 3 variant-winner UI + few-shot integration with
   processor.js — operator-gated promotion only.
6. Multi-channel scoping as part of channel isolation rollout.

---

## References

- Existing surface: `analytics.js`, `lib/services/news-mirror.js`
  (for historical joins), `server.js:/api/analytics/*` (now
  Bearer-gated after Task 3).
- [`docs/channel-isolation-audit.md`](./channel-isolation-audit.md) — required before step 6.
- [`docs/multi-channel-roadmap.md`](./multi-channel-roadmap.md) — broader multi-channel plan.
- [`docs/url-fetch-safety-audit.md`](./url-fetch-safety-audit.md) — analytics fetches also touched by Task 9 wiring when that lands.
