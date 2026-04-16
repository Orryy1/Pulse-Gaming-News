# Production Cut-Over Playbook — Phase 1-9 Feature Flags

**Audience:** whoever is flipping `USE_SQLITE` / `USE_JOB_QUEUE` / `USE_SCORING_ENGINE` on in Railway.
**Goal:** turn on the new stack in production without losing stories, without duplicate publishes and with a one-step rollback.

This playbook was validated against the dev machine on 2026-04-16 via the drill described in §5.

---

## 1. The three flags

| Flag                 | When off                                                                                | When on                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `USE_SQLITE`         | `lib/db.js::getStories` / `saveStories` read+write `daily_news.json`                    | Same API, but backed by `data/pulse.db` (`stories` table)                                                                                    |
| `USE_JOB_QUEUE`      | Legacy `node-cron` registries in `run.js` / `server.js` / `cloud.js` drive the pipeline | Unified scheduler from `lib/scheduler.js` enqueues into `jobs` table, `lib/services/jobs-runner.js` executes                                 |
| `USE_SCORING_ENGINE` | `handleHunt` calls `publisher.autoApprove()` (score>=500 heuristic)                     | `handleHunt` calls `lib/decision-engine::runScoringPass` which writes `story_scores` rows and decides `auto` / `review` / `defer` / `reject` |

Supporting flag: `API_TOKEN` — required by `server.js` in production. Must be a strong secret before flipping `USE_*` flags on.

The flags are independent but the natural order is `USE_SQLITE` → `USE_JOB_QUEUE` → `USE_SCORING_ENGINE`. Each one is safe to enable standalone; the downstream flags only add value if the upstream is already on.

---

## 2. Pre-flight

Before touching Railway:

1. **Stem audit.** Run locally:

   ```
   node scripts/generate_identity_stems.js --dry-run
   ```

   Every channel that has published in the last 30 days must have owned stems. Missing stems cause a cross-pack fallback to `pulse-v1` (logged and, if `OBSERVABILITY_IDENTITY_ALERTS=true`, Discord-alerted).

2. **Migration check.** SQLite migrations are idempotent (see `lib/migrate.js`). Confirm prod DB is at the latest migration:

   ```
   node lib/migrate.js status
   ```

3. **Backup prod DB.** Before the first flag flip, copy `data/pulse.db` off Railway:

   ```
   railway run cp data/pulse.db /tmp/pulse-$(date +%s).db
   ```

   Then download it locally via `railway volume download` (or scp from the container).

4. **Set `API_TOKEN`.** In the Railway dashboard, set `API_TOKEN` to a long random string. The server refuses to boot in production without it.

5. **Discord alert dry-post.** From a local shell with flags on:
   ```
   curl -X POST http://localhost:3001/api/scoring/digest/post \
     -H "Authorization: Bearer $API_TOKEN"
   ```
   Confirm the message lands in Discord. If it doesn't, fix `DISCORD_WEBHOOK_URL` before cut-over.

---

## 3. The cut-over

**Critical:** editing `.env` on disk is not enough. Node processes load env at boot. A flag flip requires a process restart.

On Railway:

1. Open the service → **Variables**
2. Add/update:
   ```
   USE_SQLITE=true
   USE_JOB_QUEUE=true
   USE_SCORING_ENGINE=true
   ```
3. Railway redeploys the pod automatically. Watch the deploy log for:
   - `[db] opened data/pulse.db`
   - `[scheduler] registered N schedules`
   - `[jobs-runner] started`

4. Within 60 seconds of the new pod being live, confirm via HTTP:

   ```
   curl https://<prod-host>/api/queue/stats \
     -H "Authorization: Bearer $API_TOKEN"
   ```

   Expected: non-error JSON with `jobs.total`, `jobs.by_status`, etc.

5. Within 15 minutes, confirm the jobs_reap schedule fired:

   ```
   curl https://<prod-host>/api/queue/stats ...
   ```

   `jobs.by_kind` should include at least one `jobs_reap` entry. This proves the scheduler is firing.

6. Within 4 hours, confirm a hunt schedule fired (`06:00` / `10:00` / `14:00` / `17:00` / `22:00` UTC are the hunt windows). `jobs.by_kind` should include `hunt` entries and `story_scores` rows should have grown.

---

## 4. Rollback

**If queue stats return 5xx, or `story_scores` is empty 4 hours after a hunt window, or `/api/scoring/digest` reports zero scored stories for 24h+, roll back.**

1. Railway → **Variables** → delete (or set to `false`):
   ```
   USE_SQLITE
   USE_JOB_QUEUE
   USE_SCORING_ENGINE
   ```
2. Railway redeploys. Legacy `node-cron` handlers in `run.js` / `server.js` / `cloud.js` take over.
3. Verify `daily_news.json` is being written (SSH into the container and `stat daily_news.json` — mtime should be recent after the next hunt window).

**What survives rollback:**

- All SQLite rows stay where they are (harmless — legacy path doesn't read them, but doesn't delete them either).
- `platform_posts` rows stay (the legacy publisher doesn't touch this table).
- Files on disk (tokens, output media, audio packs) are unaffected.

**What gets orphaned:**

- Any story that was _only_ in SQLite (ingested after the flag flip) won't appear in `daily_news.json`. If this matters, run a one-shot backfill:

  ```
  node -e "require('./lib/db-migrate').exportStoriesToJson()"
  ```

  (This helper exists as the inverse of the original migration.)

- Any `pending` GPU derivative job won't run on the legacy path. It'll stay pending in SQLite until flags come back on.

---

## 5. Drill log — 2026-04-16

Validated locally by flipping flags off → running legacy `autoApprove` → flipping back on.

**Findings:**

- `db.getStories()` correctly routes to `daily_news.json` when `USE_SQLITE` is unset (10 rows from file, not 8 from SQLite).
- `publisher.autoApprove()` ran cleanly against `daily_news.json` and approved 9 of 10 stories with no SQLite writes.
- `story_scores` count stayed at 8 across the rollback window (scoring engine correctly inert).
- After restoring flags, `getQueueStats` resumed returning clean JSON.
- Background scheduler process was unaffected by `.env` edits — confirming process-restart requirement.

**Money spent:** zero. Drill used `approve` only (no Anthropic / ElevenLabs / upload calls).

---

## 6. Safe-to-run-during-drill command reference

| Command                         | Cost                                                                    | Safe for drill?                            |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `node run.js hunt`              | Anthropic script-gen per new story (~$0.01 each, 10-50 stories typical) | Yes if you're OK spending                  |
| `node run.js approve`           | Free                                                                    | **Yes**                                    |
| `node run.js produce`           | ElevenLabs TTS + Sharp + ffmpeg                                         | No — $ and GPU time                        |
| `node run.js publish`           | Uploads to YouTube/TikTok/Instagram/Facebook/X                          | **No — hard-stop, publishes real content** |
| `curl /api/queue/stats`         | Free                                                                    | Yes                                        |
| `curl /api/scoring/digest`      | Free                                                                    | Yes                                        |
| `curl /api/scoring/digest/post` | Free, but posts to Discord                                              | Yes (one-shot is fine)                     |
| `curl /api/audio-packs`         | Free                                                                    | Yes                                        |

---

## 7. What to monitor post-cut-over

For the first 48 hours after cut-over, check daily:

- `/api/queue/stats` — `jobs.by_status.failed` count should not grow unboundedly. A few failed GPU jobs are expected while the infer service isn't running.
- `/api/scoring/digest?hours=24` — `scored` should be ~30-50 per day; `avg_total` should settle in the 60-75 range.
- Discord — the 08:30 UTC daily digest should land every morning.
- `data/pulse.db` size — should grow slowly (~5-10 MB per week). If it explodes, check for a run-away job retry loop.

Stop watching so closely after 7 days of clean operation.
