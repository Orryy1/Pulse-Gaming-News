# Hardening & Cutover — Execution Plan (Phases B–H)

Branch: `hardening/cutover` cut off `main @ d553411`.
Grounded against `docs/phase-a-inventory.md`. Every phase has an acceptance bar and a rollback story. No phase closes on smoke tests alone.

## Guiding principles

- **Deletion > abstraction.** Prefer removing a legacy path over wrapping it.
- **One canonical route per concern.** Where two paths exist, pick one and retire the other.
- **Tests gate every phase.** A phase is not complete without the regression test that proves the invariant it just established.
- **No silent fallbacks.** Every fallback is logged, counted, and bounded.
- **Production flag combination is fixed:** `USE_SQLITE=USE_JOB_QUEUE=USE_SCORING_ENGINE=AUTO_PUBLISH=true`, `API_TOKEN=<secret>`. Phases land in an order that lets us flip these one at a time.

---

## Phase B — Deployment / runtime unification

**Goal:** one canonical cloud entrypoint. Everything else aligned to it or deleted.

### Decisions

- **Canonical entrypoint:** `node server.js` (Railway uses NIXPACKS per `railway.json:4`; `npm start` is what actually runs).
- **`cloud.js`:** retire. Its unique value (jobs-router mount, API_TOKEN fail-closed guard, approval-page HTML) must be absorbed into `server.js` before deletion.
- **`Dockerfile`:** update `CMD` to `node server.js` so every deploy target agrees. If we decide Docker isn't used, delete `Dockerfile` + `Procfile` entirely.
- **`package.json start`:** leaves `scripts/ensure-ffmpeg.js` in front; that's a prerequisite worth keeping.

### Work items

1. Audit what `cloud.js` does that `server.js` doesn't. Port any gaps (API_TOKEN guard wording, `/approve/:id` redirect, jobs-router mount under `USE_SQLITE`).
2. Delete `cloud.js`. Replace with a tombstone error file for a release or two, then remove.
3. Align `Dockerfile` and `Procfile` to `node server.js`, or delete both after confirming Railway uses Nixpacks only.
4. Strip the stale "cloud.js is the Railway entrypoint" comment wherever it appears.
5. Add a boot-banner log that records the active entrypoint + commit SHA + flag state. Makes prod observability honest about what's actually running.

### Acceptance

- `git grep -i "cloud\.js\|Dockerfile CMD"` returns zero stale references.
- `node server.js` on a clean Railway cold start boots with API_TOKEN fail-closed, mounts jobs-router under `USE_SQLITE`, and prints the boot banner.
- Smoke test: container builds and `/api/health` responds 200.

### Rollback

Single commit revert. Legacy `cloud.js` stays in git history and can be restored if Nixpacks behaviour surprises us.

---

## Phase C — Persistence cutover (JSON → SQLite)

**Goal:** SQLite is the source of truth. JSON reduced to optional export.

### Work items (strictly ordered)

1. **Verify parity.** Enumerate every API route and pipeline callsite that reads/writes stories or publish state. For each, document: which source, which flag guards it, whether it mutates. Ship as `docs/phase-c-readwrite-map.md` before changing any behaviour.
2. **Route the reads first.** Replace direct `readJson(DATA_FILE)` calls with `lib/repositories/stories.js` + `lib/repositories/platform_posts.js` reads when `USE_SQLITE=true`. Legacy path stays reachable via `USE_SQLITE=false` for rollback.
3. **Route the writes next.** Replace direct `writeJson(DATA_FILE)` with repo writes. Enable dual-write temporarily in a single env-flagged helper (`lib/db.js::saveStory` already abstracts this — extend it).
4. **Burn dual-write.** Once one full hunt→produce→publish cycle runs clean against SQLite reads, disable the JSON write path behind a new flag `EXPORT_JSON_SNAPSHOT=false` default-off. JSON only gets written when explicitly requested.
5. **Add `lib/db-migrate.js::exportStoriesToJson()` test.** Parity test: dump SQLite → JSON, diff against a golden fixture.
6. **Remove 52 direct JSON callsites.** Every non-`lib/db.js` reader/writer gets refactored to go through a repository. Deletion scope: `hunter.js`, `processor.js`, `publisher.js`, `engagement.js`, `analytics.js`, `images.js`, `images_story.js`, `affiliates.js`, `breaking_queue.js`, `weekly_compile.js`, `blog/build.js`, `blog/generator.js`, `watcher.js`, `discord/*`, `optimal_timing.js`, `scraper.js`, `subtitles.js`, `imagen.js`.

### Acceptance

- `rg "readJson\(.*daily_news\.json|writeJson\(.*daily_news\.json" -g '!node_modules'` returns matches only in `lib/db.js`, `lib/db-migrate.js`, and tests.
- `USE_SQLITE=true node run.js full` completes a full hunt cycle without touching JSON files.
- `/api/approve` mutations are visible via `/api/stories` read on the same flag state.
- Regression test: story approval round-trip test.

### Rollback

Flip `USE_SQLITE=false`. Legacy JSON path stays reachable until step 4 lands. After step 6, rollback requires commit revert.

---

## Phase D — Scheduler / queue cutover

**Goal:** one scheduler, one runner, zero parallel dispatchers.

### Work items

1. Confirm `lib/bootstrap-queue.js` is called from `server.js` when `USE_JOB_QUEUE=true`. If not, wire it.
2. Delete the 11 cron.schedule calls from `server.js` (lines 1148-1451). Replace with a single `bootstrap-queue.start()` call. Anything those crons did that isn't a DEFAULT_SCHEDULE entry gets added to `lib/scheduler.js`.
3. Delete the 7 cron.schedule calls from `run.js` (lines 259-368). `node run.js schedule` either becomes a thin alias for `node server.js` or is removed.
4. Delete the 1 cron.schedule call from `cloud.js` (dies with cloud.js in Phase B).
5. Ensure every legacy cron handler has a matching job-handler in `lib/job-handlers.js`. Gaps to flag: whatever `server.js:1218` (first-hour engagement every 15 min) and related publish-window crons do specifically.
6. Add a `LEGACY_CRON=true` override flag that re-enables the old crons only. Default off. Used only for emergency rollback.

### Acceptance

- `git grep "cron\.schedule" -l` returns only `lib/scheduler.js`.
- `node server.js` with `USE_JOB_QUEUE=true` fires every scheduled work unit via the jobs table. Verified by: each schedule fires at least once in a simulated 24-hour dry-run, producing exactly one job row per window.
- Regression test: concurrent two-process start doesn't produce double enqueues (idempotency keys prove it).

### Rollback

Set `LEGACY_CRON=true`, restart. Legacy crons resume. Only valid until Phase D acceptance lands — after acceptance, LEGACY_CRON flag itself is deleted.

---

## Phase E — Scoring / decision cutover

**Goal:** scoring engine is the only approval system in production.

### Work items

1. Delete `shouldAutoApprove()` from `publisher.js:41-46`.
2. Delete the legacy else-branch in `publisher.js::autoApprove` that auto-approves everything. Make `autoApprove` a thin wrapper that always calls `runScoringPass`.
3. Same surgery in `lib/job-handlers.js::handleHunt:52-64` — remove the legacy branch.
4. Every `story_scores` row that decides `auto` writes `platform_posts.status='queued'` (or equivalent). `review` / `defer` / `reject` outcomes get their own status and a Discord summary.
5. Add observability: `/api/scoring/digest` already exists (per playbook §6). Extend with a `review-queue` endpoint listing stories that need human review.
6. Remove `USE_SCORING_ENGINE` flag once legacy path is gone. Replace with a hard assertion at boot: "scoring engine ready, refusing to start without it."

### Acceptance

- `git grep "shouldAutoApprove"` returns zero.
- Every approval decision in the last hunt cycle has a matching `story_scores` row.
- Regression test: 20 synthetic stories pass through scoring, check that outcomes land in `auto/review/defer/reject` proportions matching rubric expectations.

### Rollback

Last flag-based rollback possible is at the step-3 boundary. After that: commit revert.

---

## Phase F — Renderer / inference integration

**Goal:** every renderer uses `audioIdentity`; every inference handler is honest about what it produces.

### Work items

1. Full grep for `audio/` and `.wav` references in render-path code. Replace each hard-coded path with `audioIdentity.resolve(...)`.
2. Verify `lib/repurpose.js` derivative renderers call `audioIdentity`. If not, wire them.
3. Enumerate every `@register(...)` in `tts_server/infer_service.py`. Classify: Real / Partial / Stub. Partial handlers get either completed or explicitly disabled with a clear error.
4. Unblock the 5 stuck GPU jobs: extend `INFER_TIMEOUT_MS` to 600s, add a prewarm endpoint call to the local-worker boot sequence, reset jobs 23/26/27/28/29. This is evidence the boundary works; not the primary Phase F deliverable.
5. Write `docs/inference-boot-procedure.md` covering: uvicorn start, voices.json registration (the `ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb` / voices.json mismatch), weight cache priming, timeout sizing, max_attempts tuning.
6. Roundup → render → repurpose end-to-end test: one weekly roundup produces 1 teaser_short + 4 story_shorts + 1 blog_post + 1 community_post, all assets on disk, all derivative rows flipped to `rendered`.

### Acceptance

- `git grep 'audio/.*\.wav' -g '!audio' -g '!node_modules' -g '!*.md'` returns matches only inside `lib/audio-identity.js`'s FALLBACK_PACK list.
- Every inference kind passes either a real-output test or an explicit "not implemented, refuses to claim success" test.
- Full weekly pipeline dry-run produces a complete output set.

### Rollback

Render changes are per-file and per-commit revertable. Inference is isolated behind the `USE_JOB_QUEUE` runner — disabling the queue disables the whole inference boundary.

---

## Phase G — Operational verification pack

**Goal:** a single command runs the tests that gate a production flag flip.

### Work items

1. Add a test runner. Proposal: `node --test` built-in (Node 20+ supports it), zero-dependency. Fallback: Vitest. Decision lands in Phase G kickoff.
2. Seed regression tests:
   - Duplicate publish prevention (same story, two publishes, second is blocked via `platform_posts` not sentinel).
   - Legacy sentinel migration (a story with `youtube_post_id="DUPE_BLOCKED"` in JSON gets migrated to a `platform_posts` row with `status='blocked_dupe', external_id=NULL`).
   - Job claim/lease/heartbeat (runner A claims job, dies, lease expires, runner B reclaims, both don't double-complete).
   - Scoring decisions (20 stories through scoring produce deterministic decision distribution).
   - Roundup selection persistence (weekly roundup writes a roundups row; fanout enqueues N derivatives with correct idempotency keys).
   - Derivative fanout idempotency (replaying the fanout job twice creates 1 set of derivatives, not 2).
   - Audio asset resolution (every role/flair/breaking combination resolves to an existing file, or logs an observable fallback).
   - End-to-end dry-run: `USE_SQLITE=USE_JOB_QUEUE=USE_SCORING_ENGINE=true, AUTO_PUBLISH=false`, synthetic story in, verify every phase boundary crossed.
3. CI wiring: GitHub Actions (or Railway pre-deploy) runs the full pack.

### Acceptance

- `npm test` runs the full pack green.
- A simulated "flip `USE_SQLITE` in prod" runs every Phase C test in under 2 minutes.

### Rollback

Tests are pure additions. No rollback needed.

---

## Phase H — Documentation & cutover notes

**Goal:** the ops runbook exists and is current.

### Work items

1. Update `docs/production-cutover-playbook.md` to reflect the post-hardening reality (cloud.js gone, `USE_SCORING_ENGINE` removed, JSON reduced to export).
2. Write `docs/production-readiness-checklist.md`: the pre-flight checklist against which we gate the Railway flag flip.
3. Write `docs/feature-flag-matrix.md`: every flag, what it does, what breaks when it's wrong.
4. Update this `docs/hardening-plan.md` to reflect what actually shipped vs planned.
5. Write `docs/rollback.md`: per-phase rollback procedure, which commits to revert, which flags to flip.
6. Write `docs/known-risks.md`: things we chose not to fix and why. Includes any UNVERIFIED items from Phase A that remained unaddressed.
7. Write `docs/deferred.md`: scope explicitly out of this mandate (localisation, new channels, live streams, extra monetisation layers).

### Acceptance

- Every document is grounded in the current code state, not aspirational.
- A new engineer can read the 7 docs + `CLAUDE.md` and safely flip the Railway flags.

---

## Cross-phase risks tracked

- **Running process env freeze** (playbook §3). Every flag flip requires a pod restart. Surface in Phase H rollback doc.
- **Test environment vs prod SQLite divergence.** Tests using in-memory SQLite must share the same migration path as prod. Enforce via a single `lib/migrate.js::apply()` entry point used by both.
- **`.env.darkrun-backup` discovery.** `.env.*` is now gitignored (commit `d553411`), but older local clones may have pre-gitignore backups. Audit in Phase H.
- **Five stuck GPU jobs.** Out of scope for Phase A. Resolved in Phase F via timeout + prewarm.

## Out of scope (explicit deferrals)

Per the mandate. These will not be touched:

- New channels beyond `pulse-gaming` (stacked / the-signal configs stay as-is, untouched).
- Localisation (Spanish, Japanese, any).
- Live streams.
- New monetisation layers.
- New AI gimmicks or features.
- Speculative product expansion.

The only additive work permitted is: tests (Phase G), observability logs (where they prove an invariant), documentation (Phase H).

---

_Plan is living — each phase completion updates this doc with the actual footprint vs planned._
