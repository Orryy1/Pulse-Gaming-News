# Production Readiness Checklist

Snapshot of `hardening/cutover` as of end of 2026-04-17 work day. This doc is the single reference point to decide whether the Railway `USE_SQLITE=USE_JOB_QUEUE=USE_SCORING_ENGINE=AUTO_PUBLISH=true` combination is safe to flip (or partially flip) in production. Ground-truthed against the actual code, not aspirational.

Baseline: HEAD `d36e3c9` (10 commits past `main@d553411`).

---

## Phase-by-phase status

| Phase                     | Mandate goal                              | State                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**                     | Grounded inventory + hardening plan       | ✅ Done                                                        | `docs/phase-a-inventory.md`, `docs/hardening-plan.md`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **B**                     | Deployment entrypoint unification         | ✅ Done                                                        | `cloud.js` deleted. `Dockerfile`, `railway.json`, `package.json start`, and `Procfile` all point at `server.js`. The Phase A note about a Docker/NIXPACKS entrypoint conflict is resolved — there is one canonical Node entrypoint.                                                                                                                                                                                                                                             |
| **C**                     | JSON → SQLite cutover                     | 🟡 3A done (dashboard reads), 3B-E pending                     | `docs/phase-c-readwrite-map.md` — `server.js::readNews` now SQLite-first; `discord_approve.js` + `cloud.js` + 5 leaf uploaders still direct-JSON                                                                                                                                                                                                                                                                                                                                |
| **D**                     | Scheduler / queue cutover                 | ✅ Done                                                        | `lib/dispatch-mode.js` is the single decision point. Production always runs the queue (`lib/scheduler.js` + jobs-runner via `bootstrap-queue`); bootstrap failure in prod throws instead of falling through. Legacy in-process cron in `server.js` + `run.js` quarantined behind `_registerLegacyDevCronRegistry()` and reachable only in dev with explicit `USE_JOB_QUEUE=false`. (cloud.js's cron was deleted in Phase B.) Covered by `tests/services/dispatch-mode.test.js`. |
| **E**                     | Scoring / decision cutover                | ✅ Done                                                        | `shouldAutoApprove()` deleted. `publisher.autoApprove()` always calls `runScoringPass`; prod + `USE_SQLITE!=true` throws; dev can opt-into a no-op via `USE_SCORING_ENGINE=false`. See `tests/services/auto-approve-cutover.test.js`.                                                                                                                                                                                                                                           |
| **F (inference)**         | Stable inference boundary + observability | 🟡 Code done, live verification blocked                        | Timeouts bumped 180→600s, null-lease reaper fixed, `/v1/prewarm` eager-load, SERVICE_STATE machine, waitForReady gate, boot-procedure doc. Live drill hit a new safetensors-load deadlock (documented) — stability patches land regardless.                                                                                                                                                                                                                                     |
| **5 (audio identity)**    | Resolver integrated in renderers          | ✅ Done                                                        | `docs/phase-5-audio-identity-audit.md` — `assemble.js` + `assemble_longform.js` already use `audioIdentity.resolve`; derivatives intentionally audio-free                                                                                                                                                                                                                                                                                                                       |
| **G (verification pack)** | Tests + dry-runs                          | 🟡 39 tests green, end-to-end dry run deferred                 | `tests/services/*.test.js`, `tests/db/*.test.js`. `node --test` runner configured via `npm test`                                                                                                                                                                                                                                                                                                                                                                                |
| **H (docs)**              | Production readiness docs                 | 🟡 This doc + inventory + boot procedure + cutover map shipped | Remaining: feature-flag matrix, rollback doc, known-risks                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **1 (dupe publish)**      | Asymmetry fixed + regression test         | 🟡 Shadow-mode live                                            | `lib/services/publish-dedupe.js`, migration 011, `USE_CANONICAL_DEDUPE=shadow` in `publisher.js`. Needs log-review period before flipping to `active`.                                                                                                                                                                                                                                                                                                                          |

## Pre-flight gates — must be green before flipping Railway flags further

### Block-and-fix gates

- [x] `npm test` green locally — 39/39 (Phase 2A/2B/2C/3A/readiness)
- [x] `USE_CANONICAL_DEDUPE=shadow` deployed (Phase 2C) — **not yet**: the shadow logging is code-merged on hardening/cutover but needs to land in `main` before the merge. Deploy gate.
- [ ] ~14-day shadow log review — compare `[dedupe-shadow]` log lines against actual publisher.js decisions for mismatches
- [ ] Phase 1 live verification — uvicorn cold-boot completes end-to-end at least once without the safetensors deadlock. Requires a py-spy dump of the hang first so we know what we're fixing.
- [ ] Migration 011 applied in prod — column exists on `stories` table. **Auto-applied** if the migration runner runs at boot; verify via `node lib/migrate.js status`.
- [ ] Phase 3B migrated — `discord_approve.js` approval flow uses `db.upsertStory` so Discord approvals survive the read flip. (The `cloud.js` half of this item is retired: cloud.js was deleted in Phase B and its `/approve/:id` redirect was absorbed into `server.js`.)

### Soft gates — can ship with risk-acknowledged

- [x] Phase D scheduler unification — `lib/dispatch-mode.js` picks between queue (canonical) and `legacy_dev` (explicit dev opt-in only). Production is queue-only and bootstrap failure is fatal; the legacy cron block in `server.js` / `run.js` is unreachable from any prod path.
- [x] Phase B entrypoint cleanup — `cloud.js` deleted, Dockerfile CMD now `node server.js`, `/approve/:id` redirect ported into server.js.
- [ ] Phase 3C/D/E remaining JSON migrations
- [ ] `USE_CANONICAL_DEDUPE=active` flipped (can ship in shadow-only until log review passes)

## Rollback procedure (per-phase)

| Phase                   | Rollback                                                                          | Blast radius                                     |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Phase A docs            | None needed — documentation only                                                  | None                                             |
| Phase F timeout bump    | `INFER_TIMEOUT_MS=180000` env var                                                 | Returns to the exact pre-patch behaviour         |
| Phase F reap fix        | `JOBS_ORPHAN_GRACE_MIN=999999` env var effectively disables the null-lease branch | Orphans stranded again                           |
| Phase F prewarm         | `PREWARM_ON_BOOT=false`                                                           | Cold-start on first job                          |
| Phase F readiness gate  | `INFER_WAIT_ON_BOOT=false`                                                        | Runner claims before engine ready                |
| Phase 2C shadow logging | `unset USE_CANONICAL_DEDUPE`                                                      | Pure removal of log lines, zero behaviour change |
| Phase 3A SQLite read    | `USE_SQLITE=false`                                                                | Dashboard reads JSON again                       |
| Migration 011           | Not reversible, but column is NULL-able so downstream code handles either state   | None                                             |

All Phase-level rollbacks are **flag flips** — no code revert required for any shipped work today. That was the explicit design goal.

## Known risks carried forward

1. **Safetensors-load deadlock** (`docs/inference-boot-procedure.md` "What remains risky"). Reproduced on 2026-04-17 07:05 UTC. GPU dropped 100%→0%, log frozen on `Loading model from safetensors` for 25+ min. Mitigation: watchdog timer (Phase 1B patch, not yet shipped).
2. **Sentinel perpetuation in `platform_posts.external_id`.** Migration 010 backfilled `DUPE_BLOCKED` into `external_id` despite the schema comment forbidding it. Migration 012 needed to scrub (`UPDATE platform_posts SET external_id=NULL, block_reason=COALESCE(block_reason, 'dupe-sentinel-migrated') WHERE status='blocked' AND external_id LIKE 'DUPE_%'`).
3. **daily_news.json divergence from prod**: local dev file is 3 weeks stale. Prod is already on `USE_SQLITE=true` (confirmed by Pragmata incident). Do not trust the local JSON file for any verification — always query SQLite.
4. ~~**`shouldAutoApprove() { return true }`** still the default path in `publisher.js:41-46`. Scoring engine only fires when `USE_SCORING_ENGINE=true` — flip lands in Phase E.~~ **Closed.** The legacy `shouldAutoApprove` helper and its for-loop are deleted. `publisher.autoApprove()` now always routes through `lib/decision-engine::runScoringPass`. In `NODE_ENV=production` with `USE_SQLITE!=true` it throws rather than silently approving. The `USE_SCORING_ENGINE` flag is now a dev-only escape (literal `false` opts into a logged no-op; any other value runs scoring). Covered by `tests/services/auto-approve-cutover.test.js`.
5. ~~**Parallel cron dispatchers**: `server.js` (11 crons), `run.js` (7 crons), `lib/scheduler.js` (17 DB-backed schedules). Two of these running together double-fires publishes.~~ **Closed in Phase D.** `lib/dispatch-mode.js` is the single decision point. Production always runs `lib/scheduler.js` via `bootstrap-queue`; the legacy `server.js` / `run.js` cron blocks are quarantined behind `_registerLegacyDevCronRegistry()` and only reachable in dev with explicit `USE_JOB_QUEUE=false`. Two canonical processes running simultaneously still race to enqueue, but idempotency-key dedup makes that benign.
6. ~~**`cloud.js` dead-but-loaded-gun**: Nixpacks ignores the Dockerfile so `cloud.js` doesn't run in prod, but the Dockerfile still points at it.~~ **Closed in Phase B.** `cloud.js` deleted; Dockerfile `CMD` updated to `node server.js`; `/approve/:id` redirect ported into server.js.

## What to check after a Railway flag flip

Cite commands you'd run the first 60 seconds after the pod restart:

```bash
# 1. process up
curl https://<prod-host>/api/health -H "Authorization: Bearer $API_TOKEN"
# expect: status=ok, schedulerActive=true

# 2. jobs queue alive
curl https://<prod-host>/api/queue/stats -H "Authorization: Bearer $API_TOKEN"
# expect: jobs.total > 0, jobs.by_status has done + pending, no stale_claims > 0

# 3. migrations applied cleanly
railway run node lib/migrate.js status
# expect: 011_stories_source_url_hash applied

# 4. inference ready (if GPU worker in same process)
curl https://<prod-host>/api/infer/health
# expect: phase=ready, ready=true, last_load_ms numeric

# 5. dedup shadow running (Phase 2C)
railway logs | grep '\[dedupe-shadow\]' | head -5
# expect: dedupe-shadow lines alongside [publisher] lines
```

Red flags — rollback if any of:

- `/api/queue/stats` returns 5xx after 60s
- `[bootstrap-queue] inference readiness wait FAILED` persistent in logs
- `stale_claims > 0` and not decreasing after a reaper tick
- `[dedupe-shadow]` decisions diverge wildly from actual publisher decisions (expected some divergence — wildly is >5%)

## Sign-off template

Before flipping any production flag:

- [ ] Reviewed `docs/production-cutover-playbook.md` flag section
- [ ] Confirmed latest `hardening/cutover` SHA on Railway matches local test baseline
- [ ] Confirmed `npm test` green locally at that SHA
- [ ] `API_TOKEN` set in Railway Variables
- [ ] DB backup taken within 24h of flip
- [ ] Discord webhook dry-post succeeded
- [ ] Rollback command noted in advance (specific env var + expected restart time)
