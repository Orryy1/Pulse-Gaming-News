# PULSE — Defensive Production Pass (Session 1)

Generated: 2026-04-28T18:55Z (UTC) on branch `codex/pulse-enterprise-hardening`.

---

## A. Do not do list

Before anything else.

- **Do not push `main` right now.** Local `main` is 5 commits ahead of `origin/main`. Those 5 commits include a Vite 8 upgrade, an Anthropic SDK refresh, a dashboard analytics rewrite, a HyperFrames lockfile sync and a Railway build-warning categorisation. None of them have been reviewed inside this defensive pass.
- **Do not `git add -A` or `git commit -a` from this working tree.** 8 unrelated tracked files are modified by an in-progress thumbnail-safety feature (`images.js`, `images_download.js`, `images_story.js`, `lib/services/content-qa.js`, `lib/studio/v2/hf-thumbnail-builder.js`, `publisher.js`, `tests/services/content-qa.test.js`, `upload_youtube.js`) and 50+ untracked branding assets sit at the repo root. Stage by exact filename only.
- **Do not edit migrations under `db/migrations/`.** They are immutable once shipped (the migration runner aborts on a checksum change).
- **Do not weaken `AUTO_PUBLISH`, `TIKTOK_BROWSER_FALLBACK`, `INFER_ALLOW_FAILED_START`, `USE_BUFFER_TIKTOK` or any other safety gate.**
- **Do not retry failed uploads, mutate the production DB or run produce/publish.** The cron scheduler will fire the windows on its own; no operator-side replays are needed.
- **Do not deploy a Dockerfile change that ships headless-Chrome libs without a separate review pass.** That fix is needed (see §C, §F) but it is render-engine-adjacent infra and outside this session's cap.

---

## B. Branch and repo state

| Field                     | Value                                    |
| ------------------------- | ---------------------------------------- |
| Current branch            | `codex/pulse-enterprise-hardening`       |
| Branch HEAD               | `5863a5a`                                |
| Local `main`              | `5863a5a` (== branch HEAD)               |
| `origin/main`             | `36bdbf0` (deployed)                     |
| Local main vs origin/main | **+5 commits ahead, 0 behind**           |
| Modified tracked files    | 8 (in-progress thumbnail-safety feature) |
| Untracked files           | 50+ (mostly branding assets, 3 docs)     |
| My fix scope              | 2 files modified (see §I)                |

**5 unpushed commits on local `main`** (newest first):

```
5863a5a Separate Railway build advisories from warnings
fb2183a Improve dashboard analytics loading and accessibility
ea1de3e Update frontend tooling to Vite 8
b904fb7 Harden Railway health checks and refresh Anthropic SDK
590b6ff Sync HyperFrames lockfile dependency
```

`git diff --stat 36bdbf0..main`: 12 files changed, 1213 insertions, 2403 deletions. None of those 12 files touch `publisher.js`, `upload_*.js`, `lib/scheduler.js` or `lib/job-handlers.js` — the platform/scheduler code paths are identical between origin/main (deployed) and local main. The diff is concentrated in `src/` (frontend), `tools/railway-health-check.js`, `lib/ops/railway-health.js`, `package*.json` and four dashboard test files.

Working-tree (uncommitted) edits to `publisher.js` and `upload_youtube.js` add a `thumbnail_candidate_path` self-heal field and wire `runThumbnailPreUploadQa` from a new `lib/thumbnail-safety` module. **These are not deployed and were not made by this session.**

**Safe to reason about:** yes, with the caveat that any push to main also ships 5 unreviewed commits.

---

## C. Live / Railway parity

Read-only check via `npm run ops:railway:health`:

| Field              | Value                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| Deployment id      | `f048dda1-5399-48e1-bdff-41455c253aaf`                                               |
| Deployment status  | `SUCCESS`                                                                            |
| Deployed commit    | `36bdbf0` (`Use Node 22 in Railway image`)                                           |
| HTTP `/api/health` | `200`, `dispatch=queue strict=true`, `sqliteEphemeral=false`, db at `/data/pulse.db` |
| Verdict            | `fail` (1 hard fail, 29 warnings)                                                    |

**One hard fail:** `deployment_commit_mismatch` — the script compares Railway's deployed commit (`36bdbf0`) against the local commit (`5863a5a`) and flags the +5 gap. Railway itself is alive and serving 200s; the "fail" is the script telling us local is ahead, not that Railway is unhealthy.

**Critical warning surfaced from Railway logs (P0 follow-up):**

```
/root/.cache/hyperframes/chrome/chrome-headless-shell/.../chrome-headless-shell:
  error while loading shared libraries: libnss3.so: cannot open shared object file
```

`hyperframes render` cannot launch headless Chrome on Railway because the `node:22-slim` Dockerfile installs only `ffmpeg curl ca-certificates python3` — not `libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2`.

**Operational impact:** the HF thumbnail batch wired into `publisher.produce()` (commit `f1a9e6b`) is failing on every produce. The `try/catch` at `publisher.js:228-235` swallows the error, so produce continues and `upload_youtube.js` falls back to `story_image_path` (the 1080×1920 Instagram Story PNG). YouTube auto-letterboxes that. **HF thumbnails are 0% live in production.** Not a regression vs pre-HF, but the new feature isn't doing its job.

**Build/runtime advisories (already documented inside `railway_health_check.md`):** `prebuild-install@7.1.3` deprecated, `node-domexception@1.0.0` deprecated, npm v11 available. None blocking.

---

## D. Scheduler and queue

`server.js` is the canonical entrypoint (Dockerfile `CMD ["node", "server.js"]`, `railway.json` agrees). `lib/bootstrap-queue.js` wires `lib/scheduler.js` (cron → `jobs.enqueue`) and `lib/services/jobs-runner.js` (claim → handler dispatch). `lib/dispatch-mode.js` enforces `mode=queue strict=true` in production — there is no escape into the legacy in-process cron registry on Railway.

| Concern                      | State                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idempotency                  | Each `DEFAULT_SCHEDULES` row carries an `idempotencyTemplate` (e.g. `publish:{date}:19`, `hunt:{date}:06`). `jobs.enqueue` deduplicates on the key, so a restart mid-tick does not double-enqueue.                                    |
| Stale-claim handling         | `jobs_reap_stale` schedule fires every minute. The reaper sweeps `claimed`/`running` rows whose `lease_until` has expired back to `pending`, including a grace window for `lease_until=NULL` orphans (Phase F drill found one).       |
| Atomic claim                 | `SELECT … WHERE status='pending' … LIMIT 1` followed by `UPDATE … SET status='claimed' WHERE id=? AND status='pending'` inside a transaction. Two workers cannot ever take the same row.                                              |
| Three publish windows        | `publish_morning` 09:00, `publish_afternoon` 14:00, `publish_primary` 19:00 UTC. Each calls `publishNextStory()` which picks a single highest-priority unpublished story — at most one new public post per window, not a batch flood. |
| Three produce windows        | 08:00 / 13:00 / 18:00 UTC, each one hour before its publish pair.                                                                                                                                                                     |
| Failed-job logging           | Every handler that wraps an external API uses `withRetry` + `captureException` (Sentry). Failures persist as job rows with status `failed`, attempt count + last error.                                                               |
| Discord summary truthfulness | Publish summary is built per-story from the actual outcome map (`new_upload` / `already_published` / `duplicate_blocked` / `failed`), not from naive presence checks on stamped IDs. Verified read-only.                              |

**No follow-up recommended for the scheduler/queue. It is the most settled part of the system.**

Duplicate-post risk: low. The denormalised `<platform>_post_id` columns plus the `platform_posts` row with `status='blocked'` (migration 013) prevent re-uploads, and YouTube's local title-similarity dedup (`upload_youtube.js:567-606`) is a second line of defence.

---

## E. Platform publishing

### YouTube — green

| Check                          | Result                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Upload success path            | `youtube.videos.insert` → response.data.id stamped onto `story.youtube_post_id`; `story.youtube_url` mirrored.                             |
| Video ID persistence           | `db.upsertStory(story)` after each upload (`upload_youtube.js:814-816`).                                                                   |
| Discord summary uses fresh IDs | The publisher reads from the just-saved row — no stale-ID risk found.                                                                      |
| Custom thumbnail               | `thumbnails.set` is called with the candidate chain `hf_thumbnail_path → story_image_path → image_path`. Wrapped in try/catch — non-fatal. |
| Quota                          | 5-second sleep between uploads in batch path; `withRetry` handles 5xx.                                                                     |

Caveat: HF thumbnails are not actually generated on Railway (see §C) so the chain falls through to `story_image_path` every time. YouTube auto-letterboxes the 1080×1920 portrait. Functionally OK, visually sub-optimal.

### Facebook Reel — green (already correct)

`upload_facebook.js:200-222` returns `outcome: "ready"` when `video_status === "ready"` AND any of:

- `publishing_phase.status === "published"`
- `publishing_phase.status === "complete"` ← the case the prompt called out
- `data.published === true`

Unit test exists at `tests/services/facebook-reel-verify.test.js:42` (`video_status=ready + publish=complete → ready`), and the file covers six other state combinations including the secret-redaction safety on the errored reason. **No fix needed.**

Timeout: 24 attempts × 5 s = 2 min ceiling. Timeout error message includes the last polled `video_status` and `publish_status` tags. Permalink is logged on success.

### Facebook Card — independent

Card fallback path lives in `upload_facebook.js` separately from `verifyReelPublished`. A Reel timeout/error throws but the card upload runs through `uploadPagePost` which does not depend on Reel state. Verified by reading the publisher orchestration: `result.facebook_card` is set independently of `result.facebook_reel`.

### Instagram Reel — improved this session

`INSTAGRAM_CONTAINER_STATUS_FIELDS = "status_code,status,error_code,error_subcode,error_message"` — all five required fields polled.

**Gap closed:** the binary and URL polling paths used to throw `Instagram processing timed out (status: IN_PROGRESS)` on timeout, dropping `error_code`, `error_subcode`, `error_message`. The intermittent 2207076 was therefore invisible in `story.instagram_error` and Discord summaries. Both paths now thread `lastSummary` through `formatInstagramContainerStatus` before throwing. The ERROR branch also stops `JSON.stringify`-ing the raw response body — the formatter only emits known-safe fields, removing any future risk of a stray response key leaking. New test pins both paths.

### Instagram Story — also improved this session (low-risk extension of the same pattern)

The Story upload path had the same defect (`fields: "status_code,status"` only, JSON.stringify on ERROR, status-only timeout message). Tightened in the same diff: it now uses `INSTAGRAM_CONTAINER_STATUS_FIELDS`, captures `lastSummary`, and prints the formatted summary on ERROR and timeout. Within the cap (see §I).

### TikTok — static diagnosis only

| Check                        | Result                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source mode                  | `source: "FILE_UPLOAD"` (`upload_tiktok.js:515`). Correct.                                                                                                                                                                                |
| Scopes                       | `user.info.basic,video.publish,video.upload` (`upload_tiktok.js:409`). Correct.                                                                                                                                                           |
| App-review blocker           | Documented in `lib/platforms/buffer-tiktok.js` header. Direct API rejected at the `unaudited_client_can_only_post_to_private_accounts` policy.                                                                                            |
| Switching to `PULL_FROM_URL` | No upside. The policy that blocks `PUBLIC_TO_EVERYONE` is independent of upload mode; both require the same audited scopes.                                                                                                               |
| Buffer bypass                | Decommissioned. `buffer.com/developers/apps/create` returns "Sorry, Buffer no longer supports the creation of new developer apps." `lib/platforms/buffer-tiktok.js` header now records this, and `isEnabled()` short-circuits to `false`. |
| Browser fallback             | `upload_tiktok_browser.js` works locally (Brave profile + manual login) but cannot run on Railway. Gated behind `TIKTOK_BROWSER_FALLBACK=true`. Off by default.                                                                           |

**Operator action:** TikTok is genuinely off the table for Pulse Gaming on Railway until either the app-review policy reopens or the user gets onto a TikTok partner programme. Treat all three platforms as `failed → recorded → continue` for the moment.

### X / Twitter — disabled intentionally, no action

`upload_twitter.js` exists but is not invoked from `publisher.publishToAllPlatforms`. No env-driven re-enable path that could trip accidentally. Confirmed.

---

## F. Media-path and QA

| Concern                            | State                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_ROOT`                       | Honoured throughout. `lib/media-paths.js` exposes `writePath` and `resolveExisting{Sync}` so DB rows store repo-relative paths and physical I/O happens under `/data/media` on Railway. `sqliteEphemeral=false` confirms persistence.                                                                                                               |
| Render output paths                | `out/{slug}_4K.mp4` for long-form (Sleepy Stories scope), `output/final/{id}.mp4` for Pulse Shorts via assemble.js (ffmpeg). HF thumbnails write to `output/thumbnails/{id}.jpg` (column added by migration 016, file flag swept by `selfHealStaleMediaPaths`).                                                                                     |
| Upload file reads                  | All three platform uploaders resolve via `mediaPaths.resolveExisting` before `fs.createReadStream`. The only place `process.env.RAILWAY_PUBLIC_URL` is used is the Facebook URL-fallback for hosted-URL Reel posting.                                                                                                                               |
| **Zero-byte detection — GAP (P0)** | `validateVideo` (`lib/validate.js`) only checks existence and upper size limit. A 0-byte MP4 (typical of a silent ffmpeg failure) passes validation and fails at the platform with an opaque API error. Trivial fix: `if (stats.size === 0) throw ...`. **Out of scope this session — would push past the 3-file cap.** Documented as P0 follow-up. |
| Corrupt MP4 detection              | None. ffprobe header check would catch most truncated-write cases. P1 follow-up.                                                                                                                                                                                                                                                                    |
| QA failure logging                 | Per-uploader `captureException` + `story.<platform>_error` text. With this session's IG fix, the error text now includes the actual Graph error fields.                                                                                                                                                                                             |
| Skipped-candidate visibility       | `recordPlatformBlock` writes a structured row to `platform_posts` with `status='blocked'` + `block_reason`. Visible in dashboard, not just logs.                                                                                                                                                                                                    |

---

## G. Canonical protection

**Production produce path = `assemble.js` (ffmpeg-driven). Studio V2/V2.1 modules under `lib/studio/v2/` are NOT in the canonical render path.**

Verified by `grep -rn "require.*studio/v2"`:

```
publisher.js:229 → ./lib/studio/v2/hf-thumbnail-builder
lib/job-handlers.js:426 → ../tools/studio-v2-analytics-loop
```

That's the only surface area. `hf-thumbnail-builder` produces YouTube thumbnails and is wrapped in try/catch. `studio-v2-analytics-loop` is a daily LLM analytics job that writes to `data/analytics_findings.md`. Neither touches the actual MP4 render.

`assemble.js` does not require any module under `lib/studio/v2/` or `lib/studio/v2.1/`. Studio V2.1 is exclusively offline operator tooling (`tools/studio-v21-gate.js`, `tools/studio-v21-render.js`).

The known-bad authored probe is documented inside `STUDIO_V2_AUTHORED_REPORT.md` (untracked but present at the repo root) and the rejection gate exists at `lib/studio/v2/studio-rejection-gate-v21.js`. Production default is unchanged.

---

## H. Cost / quota / running risk

Practical checklist (no invented numbers):

1. **Railway running cost** — single web service running `node server.js`, queue + scheduler in-process. `MEDIA_ROOT=/data/media` on a persistent volume; volume size grows with `output/{audio,images,thumbnails,final}/`. `db_backup_daily` schedule exists; verify the backup target is OFF the persistent volume so a volume corruption does not lose backups.
2. **YouTube Data API quota** — daily limit 10,000 units. Per-video upload ≈ 1,600 units. Three publish windows × 1 short = 4,800 units/day worst case. Channel listing and dedup add a few hundred more. Plenty of headroom; unlikely to bind unless backfills run.
3. **Meta (Facebook + Instagram) limits** — page-level rate limits are usage-percentile based; the system already sleeps 30s between IG uploads (`upload_instagram.js:328`). Long-lived page tokens expire ~60 days; `instagram_token_refresh` schedule runs weekly Monday 03:00 UTC.
4. **TikTok** — blocked. Zero quota concern.
5. **Anthropic API** — Haiku for hunt/produce script generation, Haiku for `studio-v2-analytics-loop`. Cost per run is small but per-story script generation happens on every hunt cycle (4 hunts/day × N stories). Watch for retry storms — the validator retries up to 3 times.
6. **ElevenLabs TTS** — narration per story; the most expensive per-call dependency. Failures are not auto-retried inside `audio.js` beyond `withRetry`.
7. **Storage** — `output/image_cache/` and `output/thumbnails/` grow without a sweeper. Railway volume size is finite. Adding a `cleanup_old_media` schedule with a 30-day cutoff would be a good operator hygiene job.
8. **Monitoring/logging gaps** — `redactSensitive` exists in `lib/ops/railway-health.js` and the Railway log fetcher uses it. Sentry breadcrumbs + `captureException` in every uploader. No structured per-story timeline view; a small dashboard card would help triage.

---

## I. Files changed

Two files in this session:

| File                                            | Net lines | Why                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload_instagram.js`                           | +18 −4    | Track `lastSummary` in all three polling loops (Reel binary, Reel URL, Story). On ERROR and on timeout, throw with `formatInstagramContainerStatus(...)` so `error_code`, `error_subcode`, `error_message` are preserved into `story.instagram_error` and Discord. ERROR branch also stops `JSON.stringify`-ing the raw response. |
| `tests/services/instagram-reel-polling.test.js` | +18 −2    | New assertion: both paths (now three) reference `INSTAGRAM_CONTAINER_STATUS_FIELDS`. New assertion: timeout error messages take the new `timed out: <fields>` form. New assertion: ERROR branches no longer call `JSON.stringify` on the raw status response.                                                                     |

Total: 2 files, +36 net lines (well below the 75-line cap). 1 of the 3 file budget used.

Nothing else staged. `git add` will be exactly:

```
git add upload_instagram.js tests/services/instagram-reel-polling.test.js
```

---

## J. Validation

| Check                                                         | Result                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted suite (FB Reel + IG Reel + Studio v2.2 wiring)       | **22 / 22 pass**                                                                                                                                                                                                                                                                             |
| Full suite `USE_SQLITE=true node --test "tests/**/*.test.js"` | **903 / 903 pass, 0 fail**                                                                                                                                                                                                                                                                   |
| `npm run build`                                               | **passes**, 4 chunks, 529 ms, no warnings of concern                                                                                                                                                                                                                                         |
| Railway health (read-only)                                    | reachable, `/api/health = 200`, `deployedCommit=36bdbf0`, deployment status SUCCESS, queue dispatch strict, persistent SQLite. **One hard fail** (`deployment_commit_mismatch` — script comparing local 5-ahead vs deployed). **One critical warning** (libnss3 missing → HF render broken). |

Skipped:

- No production produce / publish executed.
- No OAuth flow exercised.
- No Railway mutation.
- No real Instagram failure exercised against the new logging — code path is reasoned-through only.
- Build did not invoke the (heavyweight) Studio V2 gauntlet — out of scope.

---

## K. Deploy-readiness gate

**AMBER**

### Why not GREEN

- HF thumbnail rendering is observably broken in production (`libnss3.so: cannot open shared object file` in Railway logs). The wiring shipped in `f1a9e6b` is silently failing on every produce; the legacy 1080×1920 fallback uploads instead. Not a regression, but the new feature is 0% live. Fix is a Dockerfile change, intentionally out of cap this session.
- IG logging fix is local-only, has not been observed against a real 2207076 yet.
- Local `main` is 5 commits ahead of origin/main; pushing now also ships a Vite 8 upgrade, an Anthropic SDK refresh, dashboard rewrites and a HyperFrames lockfile sync. None reviewed in this defensive pass.
- Working tree contains an in-progress thumbnail-safety feature touching 8 tracked files (`images.js`, `images_download.js`, `images_story.js`, `lib/services/content-qa.js`, `lib/studio/v2/hf-thumbnail-builder.js`, `publisher.js`, `tests/services/content-qa.test.js`, `upload_youtube.js`) plus new `lib/thumbnail-safety` and `lib/thumbnail-candidate` modules that I did not author. **`git add -A` would deploy this work without review.**

### Why not RED

- Railway is healthy on every metric that matters: `/api/health = 200`, deployment SUCCESS, persistent SQLite, queue strict mode. The "fail" verdict from the health script is the script complaining about local-being-ahead, not the app being down.
- Tests pass (903/903). Build passes.
- Canonical produce path (assemble.js → ffmpeg) is unchanged.
- Scheduler and queue are unchanged.
- Facebook Reel `publish=complete` already supported with full unit-test coverage.
- Instagram Reel polling already captured all five Graph fields; this session improved error-message preservation only.

### Blockers before a clean deploy

1. Decide on the 5 unpushed commits. Either: (a) review them in a separate pass and push, or (b) move them off `main` to a feature branch so the deploy from `origin/main` stays clean.
2. Decide on the working-tree thumbnail-safety feature. It is mid-flight from another agent. Either commit it on its own branch, or stash it, before staging this session's IG fix.
3. Plan the Dockerfile fix for `libnss3` and friends. It is a one-line `apt-get install` extension; it is also a render-engine-adjacent infra change that the user explicitly forbade in this session.

### Exact next command/check before deploy

```bash
# 1. Confirm only the IG fix is staged (no thumbnail-safety leakage)
git status --short
git add upload_instagram.js tests/services/instagram-reel-polling.test.js
git diff --cached --stat   # expect exactly 2 files, +36/-? lines

# 2. Re-run targeted + full suite + build
USE_SQLITE=true node --test tests/services/instagram-reel-polling.test.js
USE_SQLITE=true node --test "tests/**/*.test.js"
npm run build

# 3. Read-only Railway health (sanity)
npm run ops:railway:health

# 4. Commit + push only after the operator reviews the 5 unpushed commits
#    on local main and decides their fate. Do NOT git push main while
#    those are sitting unreviewed.
```

### What to watch in the next publish window

- The next `publish_primary` fire (19:00 UTC) on origin/main as it stands — i.e. without this session's IG fix, since the fix has not been pushed. If an Instagram Reel times out, `story.instagram_error` will still be the old `"status: IN_PROGRESS"` string. That's the baseline.
- Once the IG fix is deployed: any Reel timeout should now persist the `error_code` / `error_subcode` / `error_message` into `story.instagram_error` and the Discord summary. 2207076 should be visible the moment it next happens.
- Railway logs should keep emitting the libnss3 line on every produce until the Dockerfile fix lands. That is expected and is not an alert; the legacy thumbnail still uploads.

---

## L. Honest judgement

Production is alive but degraded, and the degradation pattern is invisible-rather-than-loud. YouTube ships fine, Facebook ships fine, Instagram ships when Meta is happy and silently records sub-optimal errors when it isn't. TikTok is dead end-to-end. HF thumbnails are wired but not actually rendered. The scheduler and the queue are the strongest parts of the system — they are clean, idempotent and have proper reaping.

The biggest risk surface right now is not platform code; it is the working-tree state. There is concurrent work happening from at least one other agent and from the Codex CLI on a feature branch named after this session. A careless `git add -A` would deploy work that has not been reviewed by anyone in this session. The IG fix delivered in this pass is small and safe; the pre-flight matters more than the diff.

The libnss3 issue is the one operational footgun where the system is silently doing less than it claims to. Worth booking a separate small session to drop the four lines of `apt-get install` into the Dockerfile and verifying HF thumbnails actually appear on the next produce.

Stop point. AMBER.
