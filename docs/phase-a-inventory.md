# Phase A — Grounded Inventory

**Baseline:** `main` @ `d553411` (pulse-gaming, Phase 1-9 landed + observability + stems + playbook).
**Branch:** `hardening/cutover` cut from this commit.
**Scope:** flagship Pulse Gaming channel only. `stacked` / `the-signal` configs exist but are out of scope for this mandate.

Every claim below cites `path:line` in the repo at `C:/Users/MORR/gaming-studio/pulse-gaming/`. Where a finding is unverified, it is marked `UNVERIFIED`.

---

## 1. Deployment entrypoints

Four deployment-config files disagree on what starts in production.

| File           | Line  | Claims                                                                   |
| -------------- | ----- | ------------------------------------------------------------------------ |
| `Dockerfile`   | 26    | `CMD ["node", "cloud.js"]`                                               |
| `Procfile`     | 1     | `web: node server.js`                                                    |
| `railway.json` | 4, 8  | builder `NIXPACKS`, `startCommand: node server.js`                       |
| `package.json` | 7     | `"start": "node scripts/ensure-ffmpeg.js && node server.js"`             |
| `cloud.js`     | 20-22 | comment claims "cloud.js is the Railway entrypoint (see Dockerfile CMD)" |

**Conclusion — canonical today:** `node server.js`. Railway ignores the Dockerfile because `railway.json:4` pins the builder to NIXPACKS, which reads `package.json` and runs `npm start`. The Dockerfile would only execute if somebody flipped the builder. `cloud.js:20-22` is therefore stale and actively misleading.

Both `cloud.js` and `server.js` register cron schedules, mount Express routes, and wire Sentry. If anyone ever ran `cloud.js` they'd get a second parallel set of hunts/publishes colliding with `server.js` state. `cloud.js` is live code (importable, no disable flag) — it runs in any Docker-based deploy target.

---

## 2. Scheduler / dispatcher inventory

**Cron callsites (20 in-tree):**

- `cloud.js:242` — daily 5:30 AM GMT `runDailyHunt`
- `run.js:259, 276, 292, 310, 328, 346, 368` — seven UTC slots (hunt x5, produce x1, publish x1)
- `lib/scheduler.js:314` — one `cron.schedule` inside a `for (row of schedules_table_rows)` loop; the real schedule count is driven by rows in the `schedules` SQLite table (see `DEFAULT_SCHEDULES` at `lib/scheduler.js:36-200`, 17 entries)
- `server.js:1148, 1197, 1218, 1257, 1282, 1323, 1378, 1416, 1433, 1451` — eleven in-process crons (publish windows, engagement, first-hour sweep, analytics, weekly roundup, monthly topics, Instagram token, blog rebuild, timing report, DB backup)

**Scheduler modules:**

- `lib/scheduler.js` — DB-backed, fires into `jobs.enqueue()`. Started via `start()` (callers: `lib/bootstrap-queue.js`).
- `lib/bootstrap-queue.js` — gated on `USE_JOB_QUEUE=true`. Callers: **UNVERIFIED — needs confirmation** (expected: `server.js` near boot). Verified inside Phase B.
- `lib/services/jobs-runner.js` — pull-style worker that calls handlers in `lib/job-handlers.js`. Callers: same as above.
- `workers/local-worker.js` — outbound-only polling GPU worker. UNVERIFIED — needs re-read for Phase F (my summary described it but it must be re-grounded).

**Conclusion — four parallel dispatcher brains coexist today:**

1. `cloud.js` cron (1 schedule)
2. `run.js` cron (7 schedules, fires only when `node run.js schedule` is invoked)
3. `server.js` cron (11 schedules, fires on every `node server.js` boot)
4. `lib/scheduler.js` + `lib/services/jobs-runner.js` (17 schedules via jobs table, gated on `USE_JOB_QUEUE`)

No mutex prevents brains 2+3+4 from firing the same work simultaneously. Brain 4 is idempotency-keyed (`lib/scheduler.js:220`) but brains 2 and 3 fire raw function calls with no idempotency.

---

## 3. Persistence — JSON vs SQLite

**JSON call graph (53 files touch `daily_news.json` / `pending_news.json`):**
High-traffic writers: `hunter.js`, `processor.js`, `publisher.js`, `run.js`, `server.js`, `breaking_queue.js`, `engagement.js`, `analytics.js`, `weekly_compile.js`, `images.js`, `images_story.js`, `affiliates.js`, `audio.js`, `blog/build.js`, `blog/generator.js`, `watcher.js`, `discord/bot.js`, `discord/commands/news.js`, `discord_approve.js`, `optimal_timing.js`, `breaking_queue.js`, `scraper.js`, `youtube.js`, `backgrounds.js`, `subtitles.js`, `imagen.js`.

**`lib/db.js`** is the only module that honours `USE_SQLITE`. Other 52 files hit JSON files directly via `fs-extra.readJson/writeJson`. When `USE_SQLITE=true`, `lib/db.js::getStories/saveStories` read/write the `stories` table; all other callers remain on JSON. **There is no dual-write.**

**Repositories present (lib/repositories/):**
`audio_packs.js`, `channels.js`, `derivatives.js`, `idempotency.js`, `index.js`, `jobs.js`, `platform_posts.js`, `roundups.js`, `scoring.js`, `stories.js`, `workers.js`.

**Migrations:**

- `lib/migrate.js` — schema migrations for `data/pulse.db`
- `lib/db-migrate.js` — one-shot JSON→SQLite backfill utility, plus inverse `exportStoriesToJson()` (used in rollback per playbook §4)

**API read surface (`server.js`):** UNVERIFIED — needs targeted re-read of every route body to confirm whether `/api/news`, `/api/stories`, `/api/approve`, `/api/publish-status`, `/api/stats/:id` read from `lib/db.js` (flag-aware) or from JSON directly. **This is a critical gap for Phase C — divergent reads/writes are the primary risk when `USE_SQLITE=true` is flipped in prod.**

---

## 4. Auto-approval — legacy vs scoring

`publisher.js:41-46`:

```js
function shouldAutoApprove(story) {
  const flair = (story.flair || "").toLowerCase();
  // Auto-approve everything - fully autonomous pipeline, no manual gate
  return true;
}
```

`publisher.js:49-61` (autoApprove):

```js
if (
  process.env.USE_SCORING_ENGINE === "true" &&
  process.env.USE_SQLITE === "true"
) {
  const { runScoringPass } = require("./lib/decision-engine");
  const repos = require("./lib/repositories").getRepos();
  const summary = runScoringPass({ repos });
  return summary.approved;
}
// else falls through to legacy: every story with shouldAutoApprove()==true flips approved=true
```

**`lib/job-handlers.js:44-64`** (`handleHunt`) has an equivalent flag branch — one path calls `runScoringPass`, the other calls legacy `autoApprove()`.

**Conclusion:** the scoring engine IS flag-wired, but legacy "approve everything" is the default (`USE_SCORING_ENGINE` unset → `true` always wins). `shouldAutoApprove()` is also still callable from any unaudited caller. It must be deleted entirely once scoring becomes canonical; until then it's a footgun.

---

## 5. Sentinel external IDs

**13 callsites** across 7 files.

Writers (put the sentinels in):

- `publisher.js:443, 452` — writes `story.youtube_post_id = "DUPE_SKIPPED"` / `"DUPE_BLOCKED"`
- `publisher.js:492` — `story.tiktok_post_id = "DUPE_SKIPPED"`
- `publisher.js:544` — `story.instagram_media_id = "DUPE_SKIPPED"`
- `publisher.js:590` — `story.facebook_post_id = "DUPE_SKIPPED"`
- `publisher.js:636` — `story.twitter_post_id = "DUPE_SKIPPED"`
- `upload_youtube.js:583` — returns `{ videoId: "DUPE_BLOCKED" }`
- `upload_youtube.js:739` — `story.youtube_post_id = "DUPE_BLOCKED"`

Readers (guard against the sentinels):

- `publisher.js:483, 535, 581, 627` — `s.tiktok_post_id !== "DUPE_SKIPPED"` / etc.
- `analytics.js:18, 478` — filters real IDs via `isRealPostId`
- `engagement.js:81` — `s.youtube_post_id && s.youtube_post_id !== "DUPE_BLOCKED"`
- `server.js:893` — guard on read
- `db/migrations/003_platform_posts.sql:16` — schema comment says "MUST NOT be a marker string like DUPE_BLOCKED"

**Structured replacement target:** `lib/repositories/platform_posts.js` already exists (Phase 1 schema). `platform_posts` has columns for status (`published` / `skipped` / `failed` / `blocked_dupe`) and `external_id` as NULL when not published. Cutover plan: pipe every publish outcome through the repo, delete sentinel writes, leave read guards as a legacy-compat layer during migration, then remove read guards.

---

## 6. Audio identity integration

Callers of `audioIdentity.resolve(...)` or `require('./lib/audio-identity')`:

- `assemble.js:84-100` — resolves `bed` and `sting` for short-form render
- `assemble_longform.js:232-234` — resolves `bed` for weekly roundup
- `server.js:1749` — likely admin/debug route (UNVERIFIED — needs targeted re-read)
- `scripts/generate_identity_stems.js:303` — DB re-sync only, not a render caller

**Gap check:** other render-path files to verify for hard-coded `audio/*.wav`:

- `video.js` / `ffmpeg_v2.js` if present (UNVERIFIED — needs glob)
- `lib/repurpose.js` derivative renderers (verify via Phase F)
- `weekly_compile.js` — UNVERIFIED
- `imagen.js`, `subtitles.js`, `backgrounds.js` — UNVERIFIED

**Conclusion:** audio identity IS wired into short-form and longform assembly paths. It is NOT verified for derivatives (teaser_short, story_short), which is a Phase F blocker.

---

## 7. Inference handlers — real vs stub

Registered kinds (from my prior read of `tts_server/infer_service.py`):

- `tts` — Real (VoxCPM 2 single-segment synth)
- `narrate_script` — Real (per-segment synth + ffmpeg concat → `workspace/narration.mp3`)
- `compose_short` — Real (1080x1920 MP4 render via ffmpeg with channel accent colour overlays)
- `transcribe` — Partial (faster-whisper, gracefully deferred if package not installed)

**Client surface:** `lib/inference-client.js::invoke(kind, params, { jobId })`. 180s default timeout. UNVERIFIED — needs re-grounding: full grep for `inferenceClient.invoke(` or direct HTTP POSTs to `/v1/infer`.

**Derivative kinds (`lib/job-handlers.js:350-353`):**

- `derivative_teaser_short` → needs `narrate_script` + `compose_short` (both Real)
- `derivative_story_short` → needs `narrate_script` + `compose_short` (both Real)
- `derivative_community_post` → text only, no infer
- `derivative_blog_post` → text only, no infer

**Known stuck state:** 5 GPU jobs (ids 23, 26, 27, 28, 29) sit in `pending`/`running`/`failed` states because the infer service's cold-boot exceeds the 180s client timeout (VoxCPM 2 weight load + AudioVAE + denoiser init ~3-5 min on first call). Weights now cached on disk (`~/.cache/huggingface/hub/models--openbmb--VoxCPM2/snapshots/bffb3df5a29440629464e5e839f4d214c8714c3d`). This is a Phase F blocker, not a Phase A blocker.

---

## 8. Worker lifecycle & power gate

**Workers module:** `workers/local-worker.js` exists (per summary, contents UNVERIFIED — must re-read in Phase F). Power gate: `lib/power-gate.js` exists (UNVERIFIED).

**Reaper:** `lib/job-handlers.js:291-295` (`handleJobsReap`) calls `jobs.reapStaleClaims()`. Scheduled every minute by `lib/scheduler.js` DEFAULT_SCHEDULES entry `jobs_reap_stale` (cron `*/1 * * * *`). UNVERIFIED — needs the actual reapStaleClaims implementation checked for correct lease-expiry arithmetic.

**Conclusion:** scaffolded but integration depth unverified. Phase F will produce a real worker-lifecycle test (hard-kill mid-job → reaper reclaims → next claim succeeds).

---

## 9. Feature-flag matrix

| Flag                            | Default (unset)                            | Effect when `true`                                                                             | Check sites                                                            |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `USE_SQLITE`                    | off                                        | `lib/db.js::getStories/saveStories` hit SQLite; otherwise JSON                                 | `lib/db.js:35-36`, `cloud.js:65`, many handlers                        |
| `USE_JOB_QUEUE`                 | off                                        | `lib/bootstrap-queue.js` boots scheduler + JobsRunner                                          | UNVERIFIED — needs grep                                                |
| `USE_SCORING_ENGINE`            | off                                        | `publisher.js::autoApprove` calls `runScoringPass`; `lib/job-handlers.js::handleHunt` same     | `publisher.js:54`, `lib/job-handlers.js:52`, `lib/job-handlers.js:153` |
| `USE_SCORED_ROUNDUP`            | off                                        | `lib/job-handlers.js:145` comment references it (UNVERIFIED check sites)                       | —                                                                      |
| `API_TOKEN`                     | unset                                      | Required in production by `cloud.js:28-33` and `server.js` fail-closed check (UNVERIFIED line) | `cloud.js:28-33`                                                       |
| `AUTO_PUBLISH`                  | off                                        | Multi-platform upload gate                                                                     | `publisher.js`, `run.js`, `server.js` (UNVERIFIED exact lines)         |
| `STAGGER_UPLOADS`               | `true` (only disabled if set to `"false"`) | 60-min gaps between platforms                                                                  | `publisher.js:101, 116` (UNVERIFIED)                                   |
| `OBSERVABILITY_IDENTITY_ALERTS` | off                                        | Discord alert on audio fallback                                                                | `lib/audio-identity.js:223-232` (via `recordIdentityFallback`)         |
| `INCLUDE_RUMOURS`               | —                                          | Referenced in `.env.example` but active use UNVERIFIED (may be dead)                           | —                                                                      |

**Flag combinations that matter:** 8 feature flags give 256 combinations. Production should have a **single** target combination: `USE_SQLITE=true, USE_JOB_QUEUE=true, USE_SCORING_ENGINE=true, AUTO_PUBLISH=true, API_TOKEN=<secret>`. Every other combination is a transitional state or debug mode. Phase D will retire the off-path for the first three.

---

## 10. server.js surgical footprint

**Size:** 2073 lines (`server.js`).

**Responsibilities I can see from 0-50 + 1140-1240 (UNVERIFIED across the middle):**

1. Sentry init + Express app factory (1-14)
2. CORS + security headers (21-42)
3. Auth middleware / production API_TOKEN guard (44-50+)
4. Static file + dashboard serving (UNVERIFIED line range)
5. `/api/*` routes — news, stats, approve, publish, queue, audio-packs, scoring-digest (UNVERIFIED breadth)
6. `startAutonomousScheduler()` owning 11 in-process crons (1140-1451)
7. Discord bot child-process spawn (UNVERIFIED)
8. Graceful shutdown hooks (UNVERIFIED)

**Extraction targets (Phase D):**

- `startAutonomousScheduler()` → delete entirely once jobs queue is canonical (replace with `bootstrap-queue` call)
- All 11 crons → `lib/scheduler.js` DEFAULT_SCHEDULES
- Inline hunt/publish/engage fallbacks → call handlers from `lib/job-handlers.js` instead of re-implementing
- Route bodies with business logic → `lib/services/*` (e.g. `lib/services/approval.js`, `lib/services/publish.js`)

**Target final shape:** server.js ≤ 400 lines, responsible only for: app factory, middleware chain, route mounting via `lib/api/*`, bootstrap-queue call, shutdown.

---

## 11. Tests — what exists

No grep performed yet. UNVERIFIED — Phase G will establish a test surface from zero if none exists, or extend the existing one.

Expected outcome: no tests today. `package.json` has no `test` script (line 6-14 script block is `start/hunt/produce/schedule/dev/build/preview`).

---

## 12. Known stuck state (record only)

From `data/pulse.db` last known query at 22:32 UTC 2026-04-16:

- Job 23 `derivative_teaser_short` — `status=running`, `claimed_by=server-DESKTOP-D3EI9PV-5388`, `attempt_count=3`, `last_error="This operation was aborted"`. Stale orphan (lease_until=null, runner dead).
- Jobs 26-29 `derivative_story_short` — `status=pending`, `attempt_count=0`, `run_at=2026-04-16 22:34:48` (past; unclaimed because runner dead).
- Derivatives table: 5 rows `pending`, 2 rows `generated`.

**Do not fix in Phase A.** Records exist, root cause (180s timeout vs cold VoxCPM boot) is known. Phase F will either extend the timeout + prewarm, or explicitly disable derivative kinds until real.

---

## 13. Ambiguities requiring resolution before Phase C

These are known unknowns. Each gets a targeted read in Phase B/C.

- **API route ↔ storage split** (§3). Which routes already use `lib/db.js` vs reading JSON directly? `/api/stories`, `/api/approve`, `/api/publish-status` are the three high-risk routes.
- **bootstrap-queue callers** (§2). Where is `USE_JOB_QUEUE` actually wired into boot?
- **`lib/api/jobs-router.js` mount site** (§2). `cloud.js:67` mounts it, but does `server.js`?
- **server.js complete route list** (§10). Full route inventory needed for Phase D extraction.
- **render-path audio-identity coverage** (§6). Which renderers read hard-coded paths?
- **inference client callers** (§7). Every `inferenceClient.invoke(` callsite.

---

## Summary of risks ranked

1. **Entrypoint confusion** — Dockerfile/cloud.js are live loaded guns. Fix in Phase B.
2. **Divergent JSON vs SQLite reads** — flipping `USE_SQLITE=true` in prod today causes `/api/approve` mutations to vanish from the legacy path (and vice versa). Fix in Phase C.
3. **Quadruple cron dispatcher** — any two running together causes double hunts. Fix in Phase D.
4. **Sentinel external IDs** — breaks analytics join keys and any future real queries against `platform_posts.external_id`. Fix in Phase E.
5. **Legacy `shouldAutoApprove() { return true }`** — prod default still auto-approves everything. Fix in Phase E.
6. **Audio identity coverage** — some renderers likely still hard-code paths. Fix in Phase F.
7. **Inference timeout vs cold boot** — 5 jobs stuck today; any Railway cold-start will repeat. Fix in Phase F.
8. **Zero test coverage** — every hardening change ships untested. Fix in Phase G.

---

_End of Phase A inventory. Updates land as PRs on `hardening/cutover`; every UNVERIFIED item is resolved before the phase that depends on it._
