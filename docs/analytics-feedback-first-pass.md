# Analytics Feedback — First Pass

**Status:** design only (no implementation).
**Companion docs:** [`analytics-feedback-loop.md`](./analytics-feedback-loop.md) (broader multi-phase plan), [`channel-isolation-audit.md`](./channel-isolation-audit.md) (must land before feedback goes multi-channel).
**Prerequisites (shipped 2026-04-21):** migration 015 (`platform_metric_snapshots`), `lib/repositories/platform_metric_snapshots.js`, `analytics.js` writes time-series rows, `/api/analytics/digest` exposes them.

---

## What data is collected now

Appended to `platform_metric_snapshots` every `analytics` cron run (one row per platform per story per poll):

| Field                | Source                               | Populated today               |
| -------------------- | ------------------------------------ | ----------------------------- |
| `story_id`           | internal                             | ✅                            |
| `platform`           | internal                             | ✅                            |
| `external_id`        | `story.youtube_post_id` etc.         | ✅                            |
| `snapshot_at`        | `stats_fetched_at`                   | ✅                            |
| `channel_id`         | `resolveChannelId(story.channel_id)` | ✅ defaults to `pulse-gaming` |
| `views`              | YT stats / TT stats / IG stats       | ✅ on all three               |
| `likes`              | same                                 | ✅ on all three               |
| `comments`           | same                                 | ✅ on all three               |
| `shares`             | TikTok only                          | ✅ when TT responds           |
| `watch_time_seconds` | n/a                                  | ⚠️ schema ready, no writer    |
| `retention_percent`  | n/a                                  | ⚠️ schema ready, no writer    |
| `raw_json`           | upstream response                    | ✅ whole response archived    |

The existing `stories.virality_score` + `analytics_snapshots` still populate in parallel — the new table is additive, not a replacement, so the old dashboards keep working during the bake.

---

## What's missing (and why it matters)

| Missing signal                             | Why it matters                                                                                                                                                                                                                                               | Effort to add                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `watch_time_seconds` / `retention_percent` | The single highest-signal quality input on Shorts: a 60 % average view percentage means the hook landed; a 30 % means the thumbnail clickbaited and the audience bounced. Without it, "views" alone can't distinguish good content from well-placed content. | Medium. YouTube Analytics API (not the Data API we use today) is needed for averageViewPercentage. TikTok exposes `full_video_watched_rate` via insights. New API clients, new auth scopes. |
| `impressions` / CTR                        | The other half of the hook-quality signal: a video that gets 100k impressions and 2k views has a different problem from one that gets 10k impressions and 2k views.                                                                                          | Medium. Same APIs as above.                                                                                                                                                                 |
| Follower delta per video                   | Separates "farms views" from "grows channel".                                                                                                                                                                                                                | Low. Two channel-stats snapshots (before + after) in the same run.                                                                                                                          |
| Referrer / traffic-source mix              | Distinguishes algorithmic recommendation vs search vs external. Informs whether a video is a short-term feed winner or a long-tail earner.                                                                                                                   | Medium. YT `insightTrafficSourceType`; TT `sources_breakdown`.                                                                                                                              |
| Comment sentiment rollup                   | Tells us whether the audience felt baited or served well. Cheap with a small Claude pass over the top N comments.                                                                                                                                            | Low. ~60 comments/day across 3 platforms × small Claude call = dollars, not hundreds.                                                                                                       |
| Retention curve (0/25/50/75/100 %)         | Reveals drop-off points; needed for a future "auto-tighten long intro" prompt.                                                                                                                                                                               | Medium. YT Analytics retention-curve endpoint.                                                                                                                                              |

---

## What should influence scoring LATER

Only after the minimum sample size below. Even then, feedback should nudge **what stories get picked**, never auto-rewrite scripts or rewrite hook prompts without human review.

Candidate inputs to `lib/scoring.js`:

1. **7-day average virality by `content_pillar` × `classification`.** If "Rumour Watch × Verified" stories are outperforming "Confirmed Drop × Verified" in watch-through (not views — watch-through), nudge hunter toward more of the former. ±5 points is sufficient.
2. **7-day average retention by `subreddit` / `source_type`.** If stories sourced from r/GamingLeaksAndRumours retain 55 % and stories from IGN retain 35 %, deprioritise IGN in the hunt mix. Don't drop it entirely — just ±3 points.
3. **Subscriber delta per `company_name` / `topic`.** If "Xbox-themed" videos consistently grow the channel while "mobile gaming" videos don't, weight the hunt queue accordingly. ±3 points.

Strictly **not** candidates yet:

- Hook regeneration based on low retention — too close to auto-clickbait.
- Title variant auto-promotion — operator-gated only (see [`analytics-feedback-loop.md`](./analytics-feedback-loop.md) Phase 3).
- Hard-stop adjustment (banned-word thresholds, advertiser safety). Those lines never move based on metrics.

---

## Minimum sample size before changing scoring

**50–100 published videos per (content_pillar × classification) cell.** Pulse publishes ~1/day, so that's 2–3 months of data per meaningful cell.

Why that floor:

- Shorts CTR and view variance are both enormous. A single viral outlier (10× the median) can warp a 20-sample average by 40 %. A 50-sample average is still volatile but recoverable; a 100-sample average is starting to mean something.
- Multi-platform: "YouTube 7-day views" and "TikTok 7-day views" behave very differently. The score input should aggregate across platforms with per-platform weights, but each platform still needs its own floor before it contributes.
- Pulse's publish volume (~1/day) rate-limits how fast we can learn. We should not pretend we have statistically-significant feedback after 3 weeks.

---

## Guardrails against chasing one viral outlier

1. **Clip metric inputs at the 95th percentile** before averaging. One video with 2 M views shouldn't move the average for "space topics" by 10× what a typical 50 k-view space topic would.
2. **Require a minimum of 5 data points** in any cell before the feedback loop is allowed to influence it. Cells below the floor fall back to the baseline score.
3. **Cap the total feedback adjustment at ±5 points** on the overall story score. Hard-stops (advertiser-unfriendly language, unverified-as-verified) always win regardless.
4. **Kill switch env var: `ANALYTICS_SCORING_BOOST=false`** reverts to the baseline instantly. Must exist before the first shipped feedback rule.
5. **Time-limited windows.** A rolling 14-day window beats a running average because gaming topics age fast — a "Call of Duty" boost from October isn't valid by December.
6. **Log every boost applied** alongside the story so operator review can reconstruct why a story scored what it did.

---

## Suggested first feedback rule (after 50–100 videos)

**Pillar × classification watch-through nudge, ±5 points, behind kill switch.**

Pseudo-code (illustrative; not implementation):

```js
// analytics_feedback.applyBoost(story, recentSnapshots)
function applyBoost(story, recentSnapshots) {
  if (process.env.ANALYTICS_SCORING_BOOST !== "true") return 0;

  const cell = `${story.content_pillar}|${story.classification}`;
  const peer = recentSnapshots
    .filter(
      (s) =>
        s.content_pillar === story.content_pillar &&
        s.classification === story.classification,
    )
    .slice(-100); // rolling last 100

  if (peer.length < 50) return 0; // under the floor — no boost

  const ninetyfifth = percentile(
    peer.map((s) => s.virality_score),
    0.95,
  );
  const clipped = peer.map((s) => Math.min(s.virality_score, ninetyfifth));
  const cellAvg = mean(clipped);

  const overallAvg = mean(
    recentSnapshots
      .slice(-300)
      .map((s) => Math.min(s.virality_score, ninetyfifth)),
  );
  if (overallAvg === 0) return 0;

  const ratio = cellAvg / overallAvg;
  // Map ratio 0.7–1.3 to boost -5..+5, clamped.
  const boost = Math.max(-5, Math.min(5, Math.round((ratio - 1) * 16)));

  console.log(
    `[scoring] feedback boost ${boost} applied to ${story.id} ` +
      `(${cell}: cell_avg=${cellAvg.toFixed(1)} vs overall=${overallAvg.toFixed(1)})`,
  );
  return boost;
}
```

**What this DOESN'T do:**

- Doesn't touch script generation.
- Doesn't touch hard-stops.
- Doesn't auto-publish on the basis of metrics alone (approval still runs through the existing scoring engine).
- Doesn't share signal across channels — cell is implicitly per-channel once the feedback loop reads only the active channel's snapshots.

**What it gets right:**

- Under the sample-size floor → no boost at all. Pulse can run for months without the loop changing anything.
- Kill switch is explicit and binary — no partial enablement.
- Outlier-clipped so one 2 M-view viral doesn't warp a quarter of peers into apparent over-performance.
- Rolling window keeps signals fresh.
- Every boost is logged so an operator can read the reasoning back.

---

## Suggested rollout sequence

1. **Ship nothing** until the platform_metric_snapshots table has 4+ weeks of data in production. That baseline is itself a deliverable — it powers the `/api/analytics/digest` endpoint operators use to form intuition before any automation.
2. **Add watch-through / CTR fields** (the missing ones above). Still nothing feeds back into scoring.
3. **Extend `/api/analytics/digest`** with per-cell aggregates (pillar × classification rollups) so the operator can see the signal their gut would react to.
4. **Ship a read-only `/api/analytics/scoring-preview` endpoint** that shows what boost WOULD be applied to a new story, without yet applying it. Operator watches for a week.
5. **Flip `ANALYTICS_SCORING_BOOST=true` behind a scheduled window.** Start at 18:00 UTC produce cycle only (not hunt) so the boost affects final score, not initial pick. Observe for another week.
6. **Promote the boost to hunt-time scoring.** Now the feedback loop actually influences what gets picked.

Each step has a clean rollback (env flip or commit revert). Nothing is simultaneously shipped.

---

## Related

- `/api/analytics/digest` — read-only surface operators use to watch signals before any automation.
- [`analytics-feedback-loop.md`](./analytics-feedback-loop.md) — broader multi-phase plan this doc operationalises Phase 1 of.
- [`channel-isolation-audit.md`](./channel-isolation-audit.md) — must land before the feedback loop can be safely multi-channel.
- `lib/scoring.js` — where the eventual boost slot will live.
