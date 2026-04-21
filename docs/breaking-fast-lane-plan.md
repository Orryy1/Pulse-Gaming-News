# Breaking Fast-Lane Plan

**Status:** design only (no implementation).
**Origin:** Task 8 of the 2026-04-21 cadence session triggered the "write a plan doc instead of shipping a half-done implementation" clause of the brief.
**Prerequisites:** Tasks 1–6 of the same session (3x cadence, publish_status semantics, browser-fallback gate, engage_first_hour → SQLite).
**Companion:** [`analytics-feedback-first-pass.md`](./analytics-feedback-first-pass.md), [`production-cadence.md`](./production-cadence.md) (to be written in Task 13 of this session).

---

## TL;DR

The breaking pipeline detects, queues, produces, and publishes end-to-end today — but it does all of that **off** the canonical jobs queue, directly in the server process, using two legacy JSON files (`pending_news.json` + `breaking_log.json`) as intermediate state. The Task 7 audit classified it as "partially working": a genuine escape hatch when everything goes right, but with no crash recovery, no retry history, no `/api/queue/stats` visibility, and a silent race risk against the new 3x daily produce/publish windows.

This doc lays out the minimum safe migration from the in-process fast pipeline to a queue-native lane. It's **not** a design for a new feature — the feature is already live. It's a re-plumbing plan that preserves today's behaviour while moving it onto the canonical rails.

---

## What the fast lane does today (baseline to preserve)

From [breaking_queue.js](../breaking_queue.js) + [watcher.js](../watcher.js) + the server boot block in [server.js:1898](../server.js):

1. Watcher polls Reddit (90 s) + RSS (5 min) continuously on the server process.
2. When a story's `breaking_score` clears a threshold, watcher emits `breaking`.
3. Server listens and calls `queueBreaking(story)`, which adds to an in-memory array.
4. `processQueue()` wakes up, checks a 2-hour cooldown (persisted to `breaking_log.json`), and runs `runFastPipeline(story)`.
5. Fast pipeline writes `pending_news.json`, runs `processor.js` synchronously, upserts the scored story back to SQLite, runs `audio()` → `images()` → `assemble()`, then calls `publishNextStory()` (which inherits the 3x-cadence QA gate from Task 3/4).
6. Discord `BREAKING PIPELINE` summary posts on success or failure.

**What's worth preserving:**

- The 2-hour cooldown. A breaking burst of 5 stories within 10 minutes shouldn't become 5 back-to-back publishes.
- The `classification: "[BREAKING]"` stamp (drives thumbnail badge + music sting via `audio-identity.js`).
- The QA gate (content-qa + video-qa already run via `publishNextStory`).
- The Discord summary format (operators know to look for `**BREAKING NEWS: Fast Pipeline**`).

---

## What breaks today (the audit findings)

1. **Off the queue.** Fast pipeline runs in the server process synchronously. The jobs table has no `breaking_*` rows, so `/api/queue/stats` reports nothing, retries don't fire, and a mid-pipeline crash leaves a half-produced story with no resumption path.
2. **JSON intermediate state.** `pending_news.json` and `breaking_log.json` exist because the pipeline predates the SQLite canonical store. Both are race hazards when anything else runs simultaneously.
3. **Race with 3x publish windows.** The 2026-04-21 `publish_morning` / `publish_afternoon` / `publish_primary` jobs each call `publishNextStory()` which picks the next eligible story. If a breaking story is mid-fast-pipeline (no `exported_path` yet) the publish_primary skips it correctly. But once the fast pipeline finishes + publishes, the normal window 5 minutes later can pick up the same story and attempt to republish (deduped via `platform_posts.status = "published"`, but that's a late safety net that produces Discord noise).
4. **Double-cadence risk.** Breaking publishes don't count against the 3x-daily normal cadence. Three breaking stories in one day + three normal windows = 6 videos. That's the spam scenario the brief's "Do not blindly publish" guard is trying to prevent.
5. **`breaking_log.json` is the ONLY cooldown source of truth.** Lose the file (fresh deploy without the volume mount, accidental rm, filesystem corruption) and the cooldown resets silently.

---

## Proposed queue-native shape

### New job kinds

Add two explicit kinds rather than overloading existing `produce` / `publish` with a `lane` field:

- `breaking_produce` — handler runs `produce()` against a specific `story_id` (not "next eligible") and, on success, enqueues a `breaking_publish` job.
- `breaking_publish` — handler runs `publishNextStory()` constrained to a specific `story_id`, with the breaking-cooldown check BEFORE it proceeds.

Distinct kinds surface in `/api/queue/stats by_kind`, `/api/scheduler/plan` (Task 9), and the Discord summary. That visibility is the whole point of moving off the in-process path.

### Payload shape

```json
{
  "story_id": "1sxyz123",
  "lane": "breaking",
  "breaking_score": 87,
  "breaking_trigger": "ubisoft_teaser",
  "detected_at": "2026-04-22T14:12:03.000Z"
}
```

### Idempotency key

`breaking_produce:{story_id}` and `breaking_publish:{story_id}` — single-use per story id. A second watcher event for the same story just fails idempotency and becomes a no-op. The 2h cooldown is a SECOND guard (single story twice = idempotency; many stories within 2h = cooldown).

### Cooldown persistence

Replace `breaking_log.json` with a `breaking_publish_log` SQLite table:

```sql
-- Migration 016
CREATE TABLE IF NOT EXISTS breaking_publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  breaking_score REAL,
  breaking_trigger TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (story_id)
);
CREATE INDEX IF NOT EXISTS idx_breaking_publish_log_time
  ON breaking_publish_log (channel_id, published_at);
```

`breaking_publish` handler checks `SELECT published_at FROM breaking_publish_log WHERE channel_id = ? ORDER BY published_at DESC LIMIT 1` and compares against `now - 2h`. Survives every deploy, volume remount, and is per-channel once the multi-channel roadmap lands.

### Watcher wiring change

`watcher.js` emits `breaking` as today. Server's event listener changes from:

```js
emitter.on("breaking", (story) => queueBreaking(story));
```

to:

```js
emitter.on("breaking", (story) => {
  const { enqueue } = ctx.repos.jobs;
  enqueue({
    kind: "breaking_produce",
    priority: 10, // higher than normal produce's 30
    story_id: story.id,
    idempotency_key: `breaking_produce:${story.id}`,
    payload: { story_id: story.id, lane: "breaking", ...story },
  });
});
```

No more in-memory queue, no more `processQueue()` polling loop, no more `breaking_log.json` writes. `breaking_queue.js` shrinks to just the `isDuplicate` helper (still useful for the watcher-side pre-filter).

### Handler implementations (pseudocode)

```js
// lib/job-handlers.js
async function handleBreakingProduce(job, ctx) {
  const storyId = job.payload.story_id;
  const story = await db.getStory(storyId);
  if (!story) return { skipped: "story_missing" };

  // Hard-score gate: trust the watcher but re-verify.
  if ((story.breaking_score || 0) < BREAKING_MIN_SCORE) {
    return { skipped: "score_below_threshold" };
  }

  // Content / advertiser / duplicate gates (reuse existing).
  if (await breakingQueue.isDuplicate(story)) {
    return { skipped: "duplicate" };
  }

  // Mark as breaking fast-track + upsert.
  story.approved = true;
  story.auto_approved = true;
  story.breaking_fast_track = true;
  story.classification = "[BREAKING]";
  await db.upsertStory(story);

  // Run the same produce() as normal produce jobs — it already
  // iterates approved-not-exported stories, so this single upsert
  // is enough to make the pipeline pick up the story.
  const { produce } = require("../publisher");
  await produce();

  // Enqueue publish only if the MP4 actually rendered.
  const after = await db.getStory(storyId);
  if (!after || !after.exported_path) {
    return { produced: false, reason: "no_exported_path" };
  }

  ctx.repos.jobs.enqueue({
    kind: "breaking_publish",
    priority: 5, // higher than normal publish's 20
    story_id: storyId,
    idempotency_key: `breaking_publish:${storyId}`,
    payload: { story_id: storyId, lane: "breaking" },
  });

  return { produced: true, enqueued_publish: true };
}

async function handleBreakingPublish(job, ctx) {
  const storyId = job.payload.story_id;

  // Cooldown check from SQLite.
  const recent = db
    .prepare(
      `SELECT published_at FROM breaking_publish_log
     WHERE channel_id = ? ORDER BY published_at DESC LIMIT 1`,
    )
    .get(resolveChannelId());
  if (recent) {
    const sinceMs = Date.now() - new Date(recent.published_at).getTime();
    if (sinceMs < 2 * 60 * 60 * 1000) {
      return {
        skipped: "cooldown_active",
        minutes_remaining: Math.round((2 * 60 * 60 * 1000 - sinceMs) / 60000),
      };
    }
  }

  // Constrain publishNextStory to this story_id.
  const { publishOne } = require("../publisher");
  const result = await publishOne(storyId); // NEW export — picks
  // this specific story
  // instead of the
  // "highest priority
  // unpublished" heuristic.
  if (!result.qa_failed && result.publish_status !== "failed") {
    db.prepare(
      `INSERT OR IGNORE INTO breaking_publish_log
         (story_id, channel_id, breaking_score, breaking_trigger)
       VALUES (?, ?, ?, ?)`,
    ).run(
      storyId,
      resolveChannelId(),
      job.payload.breaking_score || null,
      job.payload.breaking_trigger || null,
    );
  }

  // Discord summary labelled **Breaking Publish** so it's
  // unambiguous in #video-drops.
  await renderBreakingSummary(result, job);
  return result;
}
```

### Normal schedule unaffected

`publish_morning` / `publish_afternoon` / `publish_primary` keep calling `publishNextStory()` with its existing "next eligible" selector. A breaking story that's already `published` is skipped by the existing de-dup (it no longer sits in the "not yet published" pool).

A story that's breaking-fast-lane-mid-flight (approved + exported_path but no `youtube_post_id` yet) **could** be picked up by a normal publish window running concurrently. Fix with a short-lived `publishing_in_progress_until` column on `stories` that the breaking_publish handler sets for ~5 minutes, checked by `publishNextStory`'s filter. Belt-and-braces against the race.

---

## Configuration surface (all env, all defaults preserve today's behaviour)

| Env var                      | Default  | Purpose                                                                                                                             |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BREAKING_FAST_LANE_ENABLED` | `"true"` | Kill switch. `"false"` makes the watcher fire the event but skip enqueueing, so the entire lane can be turned off without a deploy. |
| `BREAKING_MIN_SCORE`         | `80`     | Minimum `breaking_score` for `breaking_produce` to proceed. Watcher threshold can be lower; the job handler re-verifies.            |
| `BREAKING_COOLDOWN_MINUTES`  | `120`    | Minutes between breaking publishes. Injectable for tests.                                                                           |
| `BREAKING_DAILY_CAP`         | `3`      | Hard cap on breaking publishes per 24h. Prevents a breaking burst day from turning into a 9-post spam (3 normal + 6 breaking).      |

---

## Guardrails that must hold before flipping on

1. **`BREAKING_MIN_SCORE` reverification inside `breaking_produce`.** Watcher threshold is a hint; the job handler is the authority.
2. **`isDuplicate` still runs.** Fuzzy title match + id match before produce.
3. **Advertiser safety check.** The existing `lib/services/hard-stops.js` (or wherever the banned-word check lives) runs via content-qa.
4. **Cooldown check persists in SQLite.** No reliance on `breaking_log.json`.
5. **No publish if no exported MP4.** `breaking_publish` refuses when `story.exported_path` is NULL — same content-qa contract as normal publish.
6. **No publish if QA fails.** content-qa + video-qa run via `publishNextStory` → `publishOne`.
7. **No publish if `platform_posts` already has `status='published'` for this story/platform.** Existing unique guard.
8. **Daily cap.** Reject `breaking_publish` if >= `BREAKING_DAILY_CAP` rows exist in `breaking_publish_log` with `published_at >= date('now', '-24 hours')`.
9. **Every decision logged.** Job result payload is structured: `{ skipped: "cooldown_active" }`, `{ produced: false, reason: "no_exported_path" }`, etc. The existing `job_runs.log_excerpt` captures these.

---

## Rollout sequence

Each step is independently reversible.

### Step 1 — Schema (no behaviour change)

- Migration 016: `breaking_publish_log` table.
- Bake 24 h. Confirm migration applies cleanly on prod. No handler changes.

### Step 2 — Add handlers (not wired)

- `handleBreakingProduce` and `handleBreakingPublish` registered in the handler map.
- No schedule entry. No watcher change.
- Dev can manually enqueue via `ctx.repos.jobs.enqueue` for smoke tests.

### Step 3 — publisher.js::publishOne(story_id)

- New exported function that scopes `publishNextStory`'s selector to one specific story id.
- Existing `publishNextStory()` unchanged; it still chooses "next eligible".
- Contract identical: same QA, same platform_posts writes, same Discord summary shape.

### Step 4 — Cooldown helpers

- `recordBreakingPublish(storyId, channelId, score, trigger)` and `lastBreakingPublishWithin(ms, channelId)` functions on a new thin repo.
- Tests: single insert, cooldown read, per-channel scoping, 24h daily-cap count.

### Step 5 — Wire the watcher

- Change `watcher.js` event listener to enqueue `breaking_produce` jobs instead of calling `queueBreaking`.
- Keep `breaking_queue.js` around but stripped to just `isDuplicate` (imported from the handler).
- Delete `processQueue()` and its in-memory `queue[]`.
- `breaking_log.json` stops being written (migrated fully to SQLite).

### Step 6 — Remove the in-process path

- Delete `runFastPipeline()`.
- Keep `queueBreaking` as a thin backward-compat shim that logs a deprecation warning and enqueues on behalf of the caller.
- Update all docs.

### Step 7 — Observability

- `/api/scheduler/plan` (Task 9) surfaces `breaking_produce` / `breaking_publish` as lane `"breaking"`.
- Analytics digest (Task 8 of previous session) already captures the published story — no change needed.
- Queue stats surface the new kinds naturally (`by_kind` aggregation is dynamic).

---

## Rollback per step

- **Steps 1–4:** pure additions; revert any commit → zero behaviour change, watcher still runs `runFastPipeline`.
- **Step 5:** revert the watcher wiring commit → watcher goes back to the in-memory queue.
- **Step 6:** only ship once Steps 1–5 have baked for 7 days through at least one real breaking event. Before deleting `runFastPipeline`, capture the last fast-lane firing's exact Discord summary + QA result so we can confirm the new path matches.

---

## What's out of scope for this plan

1. **Multi-channel breaking.** When the second channel ships, breaking-fast-lane cooldown + daily-cap are per-channel (the schema already supports it). Out-of-scope here because [`channel-isolation-audit.md`](./channel-isolation-audit.md) gates that.
2. **Smart-threshold ML.** Tuning `BREAKING_MIN_SCORE` based on past-week performance belongs in [`analytics-feedback-first-pass.md`](./analytics-feedback-first-pass.md) — Phase 2 or later.
3. **Per-source throttles.** "No more than one Reddit-sourced breaking story per 4 hours" would need a `source_type` constraint in the cooldown check. Not today.
4. **Dashboard UI.** Operators interact with breaking via Discord summaries and `/api/queue/stats`. Dedicated dashboard work is parked until after the pipeline itself is queue-native.

---

## Why this ships as a doc, not a PR

Task 8 of the 2026-04-21 cadence session had two branches: implement if safe, or write `docs/breaking-fast-lane-plan.md` if broad. The breaking lane touches: the scheduler, two new job kinds, a new schema migration, a new publisher export (`publishOne`), the watcher event listener, the breaking_queue module, and removes two JSON files. Seven files, each with tests, in a session that's already shipped Tasks 1–7. That's the "broad" branch.

This doc is the committed plan. A follow-up session can land Steps 1–7 incrementally, each independently reversible, each with its own bake window.
