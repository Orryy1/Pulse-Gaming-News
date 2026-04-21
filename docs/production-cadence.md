# Production Cadence

**Last updated:** 2026-04-21 (cadence session).
**Source of truth for active cron:** [`lib/scheduler.js::DEFAULT_SCHEDULES`](../lib/scheduler.js).

This doc explains what Pulse Gaming's pipeline actually does in a normal 24 hours, what an operator should expect to see, and when to step in.

---

## Normal daily schedule (all times UTC)

| Time         | Kind                | Name                      | What runs                                                                   |
| :----------- | :------------------ | :------------------------ | :-------------------------------------------------------------------------- |
| 04:00        | `db_backup`         | `db_backup_daily`         | SQLite snapshot                                                             |
| 06:00        | `hunt`              | `hunt_morning`            | Reddit + RSS scan                                                           |
| 08:00        | `analytics`         | `analytics_morning`       | Per-story view/like/comment fetch → `platform_metric_snapshots`             |
| 08:00        | `produce`           | `produce_morning`         | Build videos for every approved-not-exported story (one pass)               |
| 08:30        | `scoring_digest`    | `scoring_digest_daily`    | Discord summary of last 24h of scored stories                               |
| 09:00        | `publish`           | `publish_morning`         | Push the single next-eligible story to YT/TT/IG/FB                          |
| 10:00        | `hunt`              | `hunt_mid_morning`        | Reddit + RSS scan                                                           |
| 13:00        | `produce`           | `produce_afternoon`       | Build videos for every approved-not-exported story                          |
| 14:00        | `hunt`              | `hunt_afternoon`          | Reddit + RSS scan                                                           |
| 14:00        | `publish`           | `publish_afternoon`       | Push the next-eligible story                                                |
| 17:00        | `hunt`              | `hunt_evening`            | Reddit + RSS scan                                                           |
| 17:30        | `tiktok_auth_check` | `tiktok_auth_check`       | Pro-active token inspect + refresh if near expiry; Discord alert on failure |
| 18:00        | `produce`           | `produce_primary`         | Build videos for every approved-not-exported story                          |
| 19:00        | `publish`           | `publish_primary`         | Push the next-eligible story (legacy "primary" window)                      |
| 19:30        | `engage`            | `engage_after_publish`    | Pinned-comment engagement pass on just-published stories                    |
| 20:00        | `analytics`         | `analytics_evening`       | Second metric snapshot pass                                                 |
| 22:00        | `hunt`              | `hunt_late`               | Final hunt of the day                                                       |
| 22:00        | `blog_rebuild`      | `blog_rebuild_daily`      | Blog static site rebuild                                                    |
| every 15 min | `engage_first_hour` | `engage_first_hour_sweep` | Looks up stories published within the last hour and runs engagement if any  |
| every 1 min  | `jobs_reap`         | `jobs_reap_stale`         | Reclaims stale job claims (crash recovery)                                  |

**Weekly:**

- Sunday 00:00 UTC — `timing_reanalysis_weekly` (weekly Discord timing report)
- Sunday 14:00 UTC — `weekly_roundup` (compiles the week's stories into a longer video)
- Monday 03:00 UTC — `instagram_token_refresh`

**Monthly:**

- 1st of month, 10:00 UTC — `monthly_topic_compilations`

The canonical list lives in [`lib/scheduler.js::DEFAULT_SCHEDULES`](../lib/scheduler.js) and is seeded into the SQLite `schedules` table on each server boot. If that table and the DEFAULT_SCHEDULES list diverge (operator manually toggled `enabled`), the DB wins for what actually fires — use `GET /api/scheduler/plan` to see the code default; inspect `schedules` directly to see what's toggled.

---

## Expected posts per day

**Up to 3 public Shorts per day**, one per publish window.

Each publish job calls `publishNextStory()` which picks the single highest-priority unpublished story (fewest core platforms done first, then breaking_score). If nothing is eligible at a given window (empty backlog, or every approved story already fully published), the publish job returns `{ skipped: true }` and no post goes up. That's normal and expected.

**Worked examples for a day with N approved-and-produced stories waiting:**

| N stories ready | Posts shipped | What happens at each window                         |
| :-------------- | :------------ | :-------------------------------------------------- |
| 0               | 0             | All 3 publish jobs return skipped                   |
| 1               | 1             | Morning publishes it; afternoon + evening skip      |
| 2               | 2             | Morning + afternoon each publish one; evening skips |
| 3+              | 3             | One per window                                      |

Partial publishes (e.g. TikTok failed but YT/IG/FB went up) stay in `publish_status = "partial"` and are eligible for the next window, which retries only the missing platforms — so a story that went partial at 09:00 can complete at 14:00.

---

## Produce/publish relationship

Produce runs 1 hour before its matching publish window (08/13/18 UTC → 09/14/19 UTC). Produce is **not** a batch flood:

- `produce()` iterates every approved-not-exported story and runs them through `affiliates → audio → entities → images → assemble`.
- If a story is already exported, produce skips it.
- A single produce window can therefore catch up on backlog from a missed window without manual intervention.

If produce is slower than 1 hour for any reason (single story render takes >1h — rare), the publish window at the 1-hour mark will simply publish last window's already-produced story. The pipeline tolerates out-of-sync produce/publish timing because `publishNextStory` picks the most-ready-to-publish story, not the one produce just finished.

---

## Review behaviour

Stories hit one of three classification states after scoring:

- **auto** — score + confidence pass the auto-approval threshold. `approved = true, auto_approved = true`. Flows straight to the next produce window.
- **review** — borderline score or confidence. `approved = false, classification = "[REVIEW]"`. Sits on the dashboard awaiting operator action.
- **defer / reject** — score below review threshold or hard-stop triggered. `approved = false, classification = "[DEFER]"` or `"[REJECT]"`. Never publishes unless an operator manually overrides.

Operators interact with the review queue via the dashboard's approve button. **Approve is disabled when the story has no script at all** (Task 11 of this session): the dashboard renders a red "NO SCRIPT — re-run processor" warning instead of letting a script-missing story sneak through to content-qa's hard-fail at publish time.

---

## What the scoring digest surfaces

`scoring_digest_daily` fires at 08:30 UTC and sends a Discord summary covering the last 24h:

- count scored / auto-approved / deferred to review / rejected
- breakdown by classification and content_pillar
- hard-stop triggers (advertiser safety, duplicate, etc.)

It doesn't publish anything — it's a signal for operators. The summary makes it obvious when an unusual number of stories are landing in review (hunter misconfig, RSS outage, etc.).

---

## Why scored stories don't all publish immediately

The sizing is deliberate:

- Hunter pulls 20–60 fresh stories per window.
- Scoring/classification auto-approves a few (typical: 1–3 per day).
- Only one publishes per publish window.
- Extras stack as "approved-not-published" backlog. The next window catches up.

If the backlog grows persistently (> 10 approved-not-published sitting for > 24h), the operator should widen capacity — currently that means raising the publish frequency or lowering the auto-approval threshold. **Do not lower scoring thresholds casually** — that's how the channel starts shipping unverified rumour as Verified.

Use `GET /api/pipeline/backlog` (Task 12 of this session) to read the current counts + next candidate + top-10 stuck stories and blocking reasons.

---

## Breaking fast-lane behaviour (in-process legacy)

Separate from the normal schedule: the watcher polls Reddit every 90 s and RSS every 5 min. When a story's `breaking_score` clears its threshold:

1. `queueBreaking(story)` adds to an in-memory queue.
2. A 2-hour cooldown (persisted to `breaking_log.json`) prevents spam.
3. `runFastPipeline(story)` runs produce + publish in-process.
4. Discord announces with a `**BREAKING NEWS: Fast Pipeline**` summary.

Known caveats (full audit in [`docs/breaking-fast-lane-plan.md`](./breaking-fast-lane-plan.md)):

- Off the jobs queue — no retries, no crash recovery
- Cooldown persistence is a JSON file, not SQLite
- Can theoretically race with a normal publish window
- A fast-lane publish **does not count against the 3x normal cadence cap** — watch for 4+ posts on a heavy breaking day

The fast lane is treated as legacy. The plan to migrate it onto the canonical jobs queue with SQLite-backed cooldown + daily cap lives in `docs/breaking-fast-lane-plan.md` (design only, not yet implemented).

---

## Operator actions for the review queue

When the dashboard shows a story in `[REVIEW]`:

1. Open the story card → expand **VIEW SCRIPT**.
2. If the rendered block shows hook/body/loop sections or a full_script, read them.
3. If instead you see the red "NO SCRIPT GENERATED" warning, **do not approve**. Re-run processor via `/api/hunter/run` or manually trigger a produce window; this story was interrupted mid-processing.
4. Check the **PINNED COMMENT**, **suggested_thumbnail_text**, and **SCHEDULE** fields.
5. Click APPROVE when satisfied. The next produce window picks it up.

When the dashboard shows a story in `publish_status = "partial"`:

- Check the retry button or the platform-status badges. Usually TikTok (most fragile platform).
- Retry happens automatically at the next publish window — no operator action needed unless the retry keeps failing.

When a story sits in `[DEFER]` or `[REJECT]`:

- Read the `decision_reason` if exposed (hard-stop enum tag). Common ones: `advertiser_unsafe`, `duplicate_title`, `score_below_threshold`.
- Stories in defer/reject are intentionally held. Only override manually if the scoring engine got a specific story wrong — don't blanket-approve.

---

## Observability endpoints

| Endpoint                    | Auth   | Purpose                                               |
| :-------------------------- | :----- | :---------------------------------------------------- |
| `GET /api/health`           | public | Uptime, commit, scheduler health, circuit breakers    |
| `GET /api/news`             | public | Sanitised feed of live/published stories only         |
| `GET /api/news/full`        | Bearer | Full editorial payload for the dashboard              |
| `GET /api/scheduler/plan`   | Bearer | Every registered schedule + cadence status            |
| `GET /api/pipeline/backlog` | Bearer | Counts + next candidates + top-10 stuck stories       |
| `GET /api/analytics/digest` | Bearer | Recent published stories + platform deltas            |
| `GET /api/queue/stats`      | Bearer | Jobs table summary                                    |
| `GET /api/platforms/status` | Bearer | YT/TT/IG auth + TikTok token inspect (+ `?heal=true`) |

---

## Related

- [`docs/breaking-fast-lane-plan.md`](./breaking-fast-lane-plan.md) — pending migration of breaking pipeline onto the canonical jobs queue.
- [`docs/analytics-feedback-first-pass.md`](./analytics-feedback-first-pass.md) — how scoring may eventually use live-publish metrics.
- [`docs/channel-isolation-audit.md`](./channel-isolation-audit.md) — what changes when a second channel comes online.
- [`docs/url-fetch-safety-audit.md`](./url-fetch-safety-audit.md) — SSRF guard wiring (Task 2 of this session added the image + article fetch sites).
