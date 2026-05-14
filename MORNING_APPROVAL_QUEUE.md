# Morning Approval Queue

Updated: 2026-05-14

Live health update: `http://localhost:3001/api/health` and `https://pulse.orryy.com/api/health` currently report `mode=local`, `primary=true`, `AUTO_PUBLISH=true`, `USE_JOB_QUEUE=true` and `schedulerActive=true`. The active `server.js` process started on 2026-05-14 at 07:24 before the latest safety commits, and the health endpoint does not expose a git commit, so a controlled restart is required before the latest branch can protect live posting.

Latest read-only restart check: `npm run ops:local-restart-readiness` is RED. It confirms the running local/public server does not expose `build.commit_sha`, cadence hard gates are disabled, 10 off-schedule posts happened in 24h, 7 tight-spacing pairs happened in 24h and 2 public script-validation fallback rows still need repair.

## 0. Publish Cadence Hard Gates

Decision needed: approve or defer enabling live cadence hard gates.

Current state: the last 24h cadence doctor is AMBER: 11 public posts, 10 off-schedule posts, 7 tight-spacing pairs and a 2-minute minimum gap. The code now supports publish-window, cooldown and daily-cap policy checks, but they are warn-only unless explicit env flags are set.

Why it matters: this prevents back-to-back overnight posting bursts like 23:59 then 00:00 while keeping scheduled windows intentional.

What changes: enable `PUBLISH_REQUIRE_WINDOW=true`, `PUBLISH_REQUIRE_MIN_GAP=true` and `PUBLISH_REQUIRE_DAILY_CAP=true` on the live primary instance only after confirming the desired daily window strategy. This would block direct/fast-lane/API publish calls outside allowed windows, inside the cooldown or after the daily cap.

Risk: fewer posts, missed breaking stories and possible queue backlog if the scoring/publish strategy is too conservative.

Rollback: set those flags back to `false` or unset them, restart the local primary and run `npm run ops:publish-cadence -- --hours 24`.

Recommendation: approve once the current live primary is identified. Use a 120-minute minimum gap and a 3-post daily cap first; do not raise upload volume until analytics proves the cadence works.

## 0a. Publish Row Repair

Decision needed: approve or defer a targeted production DB repair plan.

Current state: dry-run `npm run ops:publish-row-repair -- --limit 40` found 2 public rows that contain script-validation fallback text and 24 failed rows that still carry platform IDs. No DB mutation was performed.

Why it matters: these rows confuse Discord/status reporting and make it harder to tell which posts were genuinely clean.

What changes: after a DB backup and manual platform check, apply a targeted repair that marks the two fallback rows as not clean public publishes and normalises failed/partial platform rows without deleting real platform IDs.

Risk: changing production history incorrectly could hide a real public post or make a partial publish look cleaner than it is.

Rollback: restore the DB backup or replay the inspection SQL from `test/output/publish_row_repair_plan.md`.

Recommendation: approve only after checking the two RED public rows on-platform: `1tcabvy` and `1tb2q61`.

## 0b. Deploy Current Safety Branch

Decision needed: approve or defer deploying branch `codex/readiness-qa-failure-window`.

Current state: the branch now includes local restart readiness reporting, central publish dispatch gating, stricter Discord video-drop and story-poll eligibility, immediate Discord marker persistence, legacy subtitle-duration planning and the earlier safety/reporting changes. Full `npm test` passed `2672/2672` and `npm run build` passed locally after the latest Discord safety slice.

Why it matters: the code now blocks the two failure classes seen overnight: public script-validation fallback rows and stale bad local voice paths in local assembly.

What changes: live code behaviour changes only where existing pipelines hit these QA paths. The cadence hard gates remain warn-only unless env flags are separately enabled.

Risk: some previously publishable rows may now fail QA instead of rendering/posting, which is intended but can reduce volume.

Rollback: revert the branch deployment to the previous known-good commit or `git revert` the relevant commits.

Recommendation: deploy with a controlled local restart because the active primary is local. Keep cadence hard gates warn-only unless `PUBLISH_REQUIRE_WINDOW=true` and `PUBLISH_REQUIRE_MIN_GAP=true` are approved separately. Do not restart until `LOCAL_RESTART_READINESS.md` has been reviewed.

## 0c. Controlled Local Restart

Decision needed: approve or defer a controlled restart of the active local primary.

Current state: the code branch has protections the running process does not expose. `LOCAL_RESTART_READINESS.md` is RED because the live process lacks build metadata, cadence gates are disabled and DB row repair is still pending.

Why it matters: without a restart, the active local primary may keep posting with older safety logic and no commit provenance.

What changes: stop and restart only the local `server.js`/bot stack after tests/build pass, then re-check `/api/health`, cadence, queue status and platform status. No Railway, OAuth, Cloudflare DNS or DB mutation is part of this restart decision.

Risk: because the current local instance is already primary with `AUTO_PUBLISH=true`, restarting it can resume scheduler/queue processing and may publish at the next active window unless cadence gates are also enabled.

Rollback: stop the local server, set `AUTO_PUBLISH=false`/`USE_JOB_QUEUE=false`/`PULSE_PRIMARY_INSTANCE=false` if needed, restart and verify `/api/health` reports non-primary/no scheduler.

Recommendation: approve only after deciding whether to enable cadence hard gates at the same time.

Generated: 2026-05-12

Only live-risk decisions are listed here. Safe local report edits and non-mutating checks do not need approval.

## 1. Studio V2 Pilot

Decision needed: keep blocked.

Current state: proof candidates are `0` render-ready, `20` need motion or exact assets and `1` reject. Local TTS doctor is green, but there are no render-ready Flash Lane proof candidates.

Risk: approving a live pilot now could push an unready public video.

Validation visible from current context: `npm test` passed `2417/2417`, build passed and local TTS doctor is green.

Recommendation: no. Do not approve Studio V2 pilot until at least one proof candidate has enough motion backbone/source diversity and has passed the existing visual, caption, frame and voice gates.

## 2. TikTok Token And Official Use Route

Decision needed: approve or defer operator-owned TikTok token refresh/sync and official route verification.

Current state: TikTok OAuth was recently connected in browser, but this repo's local token is expired and needs refresh/sync. The official API/inbox route is still token/creative-gated and public direct posting is not confirmed.

Risk: token sync, OAuth handling and official upload tests touch a live platform account even if public posting is not intended.

Rollback: do not mutate tokens and do not send any upload until a clean creative pack and explicit operator approval exist.

Recommendation: approve only a no-post token refresh/sync and dispatch-readiness check when Martin is present. Do not approve public TikTok posting or browser-cookie automation.

## 3. YouTube Analytics Read-Only

Decision needed: approve or defer read-only analytics access.

Current state: deeper analytics learning remains read-only/OAuth-gated. No YouTube OAuth action was run by this refresh.

Risk: OAuth handling touches a live YouTube account, even with read-only scope.

Rollback: continue using public counters and local history only.

Recommendation: approve only `yt-analytics.readonly` if retention and traffic-source learning is needed now. Do not approve upload, edit, delete or publish scopes as part of this decision.

## 4. Facebook Reels Normal Publisher Verification

Decision needed: decide whether to verify the normal Facebook Reels publisher path during local cutover.

Current state: a manual Facebook Reel proof worked and read-only Graph inspection now classifies Facebook Reels as `eligible_for_normal_publish`; the page can post, the page token is valid and `publish_video` is present.

Risk: live publisher verification can create platform-side objects or public posts if not kept tightly scoped.

Rollback: keep Facebook Reels manual-only and leave auto-publishing disabled.

Recommendation: once local posting is green, approve a controlled verification path with the strict verifier and Facebook Card fallback retained. Do not auto-enable broad posting from the manual proof alone.

## 5. Production Deployment Of Public-Output Changes

Decision needed: approve or defer production deployment.

Current state: this branch has proof-candidate, caption, frame QA and local TTS fallback-safety changes pushed, but no deployment.

Risk: deploying public-output changes can affect generated captions, proof selection, visible output and platform behaviour.

Rollback: keep the branch undeployed until the operator approves the production rollout.

Recommendation: defer production deployment until the current readiness gates are reviewed and the platform-specific live-risk decisions above are resolved.

## 6. Local Primary Cutover

Decision needed: approve or defer switching the PC/local stack into the live primary role.

Current state from read-only checks on 2026-05-13: local foundation is present and `pulse.orryy.com` currently reaches this PC. Local and public `/api/health` both report `mode=local`, `primary=false`, `AUTO_PUBLISH=false`, `USE_JOB_QUEUE=false` and `schedulerActive=false`. Railway `/api/health` reports `mode=railway`, `primary=false`, `AUTO_PUBLISH=false`, `USE_JOB_QUEUE=false` and `schedulerActive=false`. Railway has no active publishing role, but the PC is still mirror-only until local flags are changed and the local server is restarted.

Read-only tunnel readiness: `cloudflared` is installed, the Pulse config exists at `D:/pulse-data/cloudflared-pulse.yml`, the credentials file is present and `pulse.orryy.com` routes to `http://localhost:3001`. Public health should still be rechecked immediately before cutover because the tunnel is an always-on dependency.

Why it matters: the channel will not post consistently until one instance is primary. If Railway stays non-primary, the local PC must run scheduler, queue runner and uploads.

What changes: after preflight checks, local `.env` needs exactly the live-primary switch values `PULSE_PRIMARY_INSTANCE=true`, `USE_JOB_QUEUE=true` and `AUTO_PUBLISH=true`, while keeping `DEPLOYMENT_MODE=local`, `USE_SQLITE=true`, `LOCAL_PUBLIC_URL=https://pulse.orryy.com`, `SQLITE_DB_PATH=D:/pulse-data/pulse.db`, persistent `MEDIA_ROOT` and persistent `PULSE_TOKEN_DIR`. The local server must then be restarted. On boot, `server.js` calls `lib/bootstrap-queue.js`, which starts both `lib/scheduler.js` and `lib/services/jobs-runner.js` when the instance is primary.

Risk: enabling local primary can upload to live social accounts. It also relies on the PC, local network, Cloudflare Tunnel/public URL and local storage staying online.

TikTok caveat: TikTok is not safely disabled by the platform doctor alone. The status layer reports TikTok as `blocked_external` unless direct approval or Buffer is enabled, but `publisher.js` still attempts `upload_tiktok.uploadShort()` during auto-publish. If TikTok must remain disabled or dispatch-only, do not enable full `AUTO_PUBLISH=true` until a code-level TikTok skip gate exists, or accept only operator-approved manual dispatch/inbox tooling with `public_auto_publish=false`. `TIKTOK_PRIVACY_LEVEL=SELF_ONLY` is private upload, not a true disable switch.

Rollback: set local `PULSE_PRIMARY_INSTANCE=false`, `AUTO_PUBLISH=false` and `USE_JOB_QUEUE=false`, then restart local and verify local/public health report `primary=false`, `auto_publish=false` and `schedulerActive=false`. Leave Railway standby unless explicitly restoring Railway primary; if Railway is restored, never run local and Railway with `primary=true` at the same time.

Recommendation: approve only a controlled local cutover window using `LOCAL_CUTOVER_RUNBOOK.md`: preflight `/api/health` on local/public/Railway, platform doctor, publish readiness and queue inspect; flip local primary flags; restart local; verify local scheduler and job runner are active and Railway remains non-primary; then watch one scheduled window. Keep ElevenLabs available only as a temporary bridge while local Liam TTS remains the target; do not make Railway primary again just to resume posting.
