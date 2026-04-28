# Pulse — Ops Hardening Checklist

Companion to `PULSE_DEFENSIVE_PRODUCTION_PASS.md`. Read-only audit; nothing here is implemented in this session unless it was already inside the 3-file / 75-line cap.

Each item carries: **Risk · Current state · Recommended fix · Priority · Safe-this-session?**

Status legend: PASS / PARTIAL / FAIL / N/A.

---

## P0 — production-critical

### 1. Rate limiting on public/semi-public API routes — PARTIAL

- **Risk:** crawler or accidental retry hammers a route, Railway usage spikes, costs rise.
- **State:** `server.js` defines a per-IP `rateLimit` middleware and applies it to mutating routes (`/api/approve` 30/min, `/api/publish` 5/min, `/api/autonomous/*` 5/min). GETs (`/api/news`, `/api/health`, `/api/stats/:id`, `/api/hunter/status`) are not rate-limited. `/api/download/:id` streams MP4s with no limiter.
- **Fix:** add a low ceiling (e.g. 60/min) to read-only public GETs and to `/api/download/:id`. Single-file change in `server.js`.
- **Priority:** P0 (download endpoint is the hot one).
- **Safe-this-session:** No — out of cap.

### 2. No secrets in code, logs, reports or committed files — PASS

- **Risk:** token leak via Discord, Sentry breadcrumbs or operator-readable reports.
- **State:** `lib/ops/railway-health.js:redactSensitive` strips token-shaped values from log lines before writing the health report. `upload_facebook.js` interpreter returns enum-only reasons (no raw Graph response with redirect codes). This session's IG fix swaps `JSON.stringify(statusResponse.data)` for `formatInstagramContainerStatus(...)` — same defensive shape. `.gitignore` covers `.env*`, `tokens/`, `*railway_deploy.bat` and Windows-escaped accidents.
- **Fix:** none beyond holding the line.
- **Priority:** P0 (sustaining).
- **Safe-this-session:** PASS.

### 3. No full env dumps — PASS

- **State:** no `process.env` JSON dump in any committed log/report path that I could find. `redactSensitive` would catch it anyway.
- **Priority:** P0 (sustaining).

### 4. Discord alerts for failed scheduled jobs — PARTIAL

- **Risk:** scheduled job fails silently, operator only finds out when content stops appearing.
- **State:** `run.js` sends Discord on hunt/produce/publish errors in the legacy registry, but `lib/services/jobs-runner.js` (the canonical path on Railway) does not Discord on every job failure — only `captureException` to Sentry. `roundup_weekly`, `db_backup_daily`, `instagram_token_refresh` and `studio_analytics_loop` failures will sit in the jobs table without a notification.
- **Fix:** in `lib/services/jobs-runner.js` finalisation path, emit a Discord webhook ping when a job transitions to `status='failed'` after exhausting attempts. ~15 lines, single-file. Probably wants an env gate (`DISCORD_NOTIFY_FAILED_JOBS=true`) so dev doesn't spam.
- **Priority:** P0.
- **Safe-this-session:** No — touches the jobs runner.

### 5. DB backup and rollback readiness — PARTIAL

- **State:** `db_backup_daily` schedule fires at 04:00 UTC, kind `db_backup`, handler `handleDbBackup`. Backup destination should be confirmed to live OFF the persistent volume — a volume-corrupting incident would otherwise lose backups.
- **Fix:** verify the backup target path. If it lives under `/data` (same volume as `pulse.db`), move it to a separate backup volume or rsync to S3.
- **Priority:** P0.
- **Safe-this-session:** No (production mutation territory).

### 6. Token-expiry warning path — PASS

- **State:** `tiktok_auth_check` schedule runs at 17:30 UTC and Discords on expiring/dead tokens. `instagram_token_refresh` runs weekly Mon 03:00 UTC. YouTube uses `oauth2Client.refreshAccessToken()` inline.
- **Priority:** P0 (sustaining).

### 7. Zero-byte / corrupt media detection — FAIL (this is the one item from the cap that didn't make it)

- **Risk:** a silent ffmpeg failure produces a 0-byte MP4 that uploads to YouTube/Facebook/Instagram and either fails with an opaque platform error or, worst case, succeeds as a broken video.
- **State:** `lib/validate.js:validateVideo` checks file existence and upper size limit. **Does not check for 0 bytes.** No ffprobe header check.
- **Fix:**
  ```js
  if (stats.size === 0) {
    throw new Error(`Video file is empty (0 bytes): ${filePath}`);
  }
  ```
  Plus a tiny test. Total ~10 lines across 2 files.
- **Priority:** P0.
- **Safe-this-session:** Just over the cap (would have made the change-file count 3 + a new test file = 4, vs. 3-file ceiling). Earmarked as the next defensive-pass item.

### 8. Idempotency on publish/produce jobs — PASS

- **State:** every `DEFAULT_SCHEDULES` row has an `idempotencyTemplate`; `jobs.enqueue` deduplicates on it. Restarts mid-tick cannot double-enqueue.

### 9. Duplicate-post prevention — PASS

- **State:** denormalised `<platform>_post_id` columns + structured `platform_posts` table with `status='blocked'` rows (migration 013) prevent re-uploads. YouTube also dedups locally on title similarity (Jaccard > 0.75) before uploading.

### 10. Health endpoint coverage — PASS

- **State:** `/api/health` returns ok flag, deployedCommit, deploymentId, sqlite path, ephemeral flag, dispatch mode (`queue strict`). `tools/railway-health-check.js` exists and is wired into `npm run ops:railway:health`. Verdict logic surfaces hard fails and warnings.

### 11. Railway volume / media growth monitoring — FAIL

- **Risk:** `output/image_cache/` and `output/thumbnails/` grow without bound; the Railway volume eventually fills and writes start failing.
- **State:** no sweeper. Backups are scheduled, cleanup is not.
- **Fix:** add a `cleanup_old_media` schedule with a 30-day cutoff. Single-file scheduler entry + a small handler.
- **Priority:** P0 (latent).
- **Safe-this-session:** No (touches scheduler and would push past cap).

---

## P1 — operationally important

### 12. Mobile render QA for Shorts/TikTok — FAIL

- **Risk:** captions clipped, thumbnail off-centre, safe margins violated. Shorts/Reels are watched on phones; QA happens on a 16:9 monitor.
- **State:** `lib/services/content-qa.js` exists (and is currently being extended in the working tree by another agent) but has no explicit mobile-frame check. The thumbnail-safety work in flight may close part of this.
- **Fix:** add a "9:16 safe-margin" rule to `runVideoQa`. Probably better to coordinate with the in-flight thumbnail-safety branch than to layer on top.
- **Priority:** P1.

### 13. Public error pages — N/A (today)

- **State:** the user-facing surface is only the React dashboard. No public marketing/blog pages live yet.
- **Recheck:** as soon as a public landing page or media kit goes live.

### 14. Dashboard / session timeout — PARTIAL

- **State:** `requireAuth` middleware exists in `server.js`; auth method needs verification. If sessions are bearer-token-based with no expiry, that's a P1 fix.
- **Fix:** confirm session expiry policy. If absent, add a 24-hour rolling window.
- **Priority:** P1.

### 15. Session-failure alerts (form errors) — PARTIAL

- **State:** Sentry breadcrumbs cover the API surface. The dashboard probably surfaces errors but the precise UX is out of scope here.
- **Priority:** P1.

---

## P2 — polish

### 16. Polished 404 page — N/A

### 17. Loading states on the dashboard — PARTIAL

- One of the 5 unpushed commits (`fb2183a Improve dashboard analytics loading and accessibility`) touches this. Should be reviewed in its own pass.

### 18. Admin dashboard UX — Out of scope

---

## What was actually fixed in Session 1

- `upload_instagram.js`: timeout / ERROR error messages on Reel-binary, Reel-URL and Story polling paths now preserve `status_code`, `status`, `error_code`, `error_subcode`, `error_message` via `formatInstagramContainerStatus`. ERROR branches no longer dump raw Graph response.
- `tests/services/instagram-reel-polling.test.js`: new assertion that all three polling paths use `INSTAGRAM_CONTAINER_STATUS_FIELDS`, that the new timeout message form is in place, and that ERROR branches do not `JSON.stringify` the raw response.

Net diff: +36 lines across 2 files. 1 of 3 file budget consumed; 39 of 75 line budget consumed.

## Earmarked for the next defensive pass (in priority order)

1. Zero-byte / 1KB-floor check in `lib/validate.js` + test (item #7).
2. Dockerfile patch for headless-Chrome libs (`libnss3 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libpangocairo-1.0-0 fonts-liberation`) so HF thumbnails actually render on Railway.
3. Discord alert on failed jobs from `lib/services/jobs-runner.js` (item #4).
4. `cleanup_old_media` schedule with 30-day cutoff (item #11).
5. Confirm `db_backup_daily` writes off-volume (item #5).
6. Rate-limit `/api/download/:id` and read-only GETs (item #1).

These together close every P0 gap that's still open after this session.
