# Tonight Handoff

Update: 2026-05-14

## Latest Branch State

- Branch: `codex/readiness-qa-failure-window`
- Latest local checkpoint before this slice: `d1c851de auto-commit: Codex session checkpoint`
- Deployed: no
- Active public instance: local PC via `pulse.orryy.com`
- Active health: `mode=local`, `primary=true`, `AUTO_PUBLISH=true`, `USE_JOB_QUEUE=true`, `schedulerActive=true`
- Running process: `server.js` started 2026-05-14 07:24, before the latest safety commits
- Railway/env/Cloudflare/OAuth/production DB/social posting: untouched by this work
- Production renderer and production voice defaults: unchanged

## Latest Verification

- Full `npm test`: last full pass before this slice; focused tests are passing for restart readiness, dispatch policy, Discord gating, subtitle timing and publish summaries
- `npm run build`: last build pass before this slice; rerun before restart/deploy
- `npm run ops:publish-cadence -- --hours 24`: AMBER
- `npm run ops:publish-row-repair -- --limit 40`: dry-run report generated
- `npm run ops:local-restart-readiness`: RED, read-only report generated

## What Changed In The Latest Slice

- Script-validation fallback rows are now blocked before public content QA can pass them.
- Publish cadence/cooldown policies exist and report provenance, but hard blocking is still disabled until env approval.
- A dry-run publish row repair planner now identifies bad public rows and failed rows carrying platform IDs without mutating the DB.
- Studio V2 still-deck renders now pad video and audio to the subtitle/narration timeline before burning ASS subtitles, reducing caption freeze/cut-off risk.
- Local/strict assembly now runs approved-voice QA before FFmpeg render, so stale low/demonic local MP3s fail before becoming new local videos.
- Local restart readiness now compares running `/api/health` build metadata with git and blocks a clean restart recommendation when the running primary cannot prove its commit.
- Direct publish dispatch now has a central `AUTO_PUBLISH` gate and better dispatch source labels for API, CLI, scheduler and breaking fast lane routes.
- Breaking fast lane now pins the story it just processed instead of publishing whichever candidate happens to be next.
- Discord video-drop announcements now require a clean publish state and reject stale/`DUPE_*` platform IDs.
- Legacy multi-image assembly now accounts for xfade overlap so video duration covers narration/subtitles instead of cutting/freeze-risking the tail.

## Current Live Signal

- Last 24h public posts: 11
- Off-schedule/direct or fast-lane posts: 10
- Tight spacing pairs under 120 minutes: 7
- Minimum gap: 2 minutes
- Failed rows carrying platform IDs: 24
- Invalid public fallback rows: 2

## Immediate Recommendation

Do not add broad new features before cadence is controlled. The active system is posting from the local PC right now, but the running process has not loaded the latest safety commits. The next live-risk approval should be either:

1. deploy the current safety branch with cadence still warn-only, then observe;
2. deploy and enable `PUBLISH_REQUIRE_WINDOW=true` plus `PUBLISH_REQUIRE_MIN_GAP=true` on the confirmed local primary;
3. run the dry-run DB repair plan through a manual backup/review process before any mutation.

Do not restart the active local primary until `LOCAL_RESTART_READINESS.md` is reviewed and the cadence gate decision is made.

## Reports To Read Now

- `test/output/publish_cadence.md`
- `test/output/publish_row_repair_plan.md`
- `LOCAL_RESTART_READINESS.md`
- `MORNING_APPROVAL_QUEUE.md`

Date: 2026-05-12

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Latest pushed commit: `1baa1ab0 Add local TTS fallback readiness regression`
- Branch state: aligned with `origin/codex/readiness-qa-failure-window`
- Current slice: local posting readiness and Studio V2 proof repair
- Deployed: no
- Railway/env/Cloudflare/OAuth/production DB/social posting: untouched
- Production renderer and production voice defaults: unchanged

## Current Operator Summary

- Local TTS is green with the accepted Liam/Pulse voice loaded.
- The bad/demonic local voice fallback now fails closed instead of silently producing bad audio.
- Full `npm test`: pass (`2417/2417`).
- `npm run build`: pass.
- Studio V2 proof candidates: `0` render-ready, `20` need motion or exact asset work and `1` reject.
- `1t0zhng` now has accepted Liam audio and corrected exact-subject coverage, but still needs more motion/source diversity before a Flash Lane proof.
- Facebook Reels is now graph-eligible from read-only inspection: a visible Reel/video exists, the page can post and the token has `publish_video`.
- TikTok browser OAuth succeeded, but this repo's local TikTok token is expired and needs refresh/sync before official upload testing.
- Local posting is cutover-blocked, not code-blocked: the duplicate local control keys have been cleaned locally, and the remaining blockers are the disconnected Cloudflare tunnel/public health plus mirror-mode flags.
- `LOCAL_TUNNEL_READINESS.md` confirms `cloudflared` is installed, the Pulse tunnel config and credentials are present, and `pulse.orryy.com` routes to `http://localhost:3001`; the tunnel simply has no active connection.

## Platform Readiness

- TikTok: browser-connected, but official upload use is blocked until the local token is refreshed/synced and a clean creative pack is selected. Public auto-posting remains blocked by app approval/direct-post uncertainty.
- Facebook Reels: eligible for controlled normal-publisher verification once local posting is green, with strict verifier and Facebook Card fallback retained.
- YouTube analytics: keep read-only only; any OAuth re-auth for analytics scope remains an operator decision.
- Instagram/Facebook/TikTok normal publishing: still gated by existing platform safety controls.
- Railway: standby/optional only for cost control.

## Reports To Read

- `LOCAL_POSTING_READINESS.md`
- `LOCAL_ENV_CLEANUP_PLAN.md`
- `LOCAL_TUNNEL_READINESS.md`
- `LOCAL_TTS_OVERNIGHT_REPORT.md`
- `OVERNIGHT_STATUS_SNAPSHOT.md`
- `MORNING_APPROVAL_QUEUE.md`
- `PLATFORM_READINESS_DOCTOR.md`
- `FACEBOOK_REELS_STATUS.md`
- `TIKTOK_OPERATOR_CHECKLIST.md`

## Biggest Remaining Blocker

The project is close to local posting, but the live route is blocked by cutover operations: Cloudflare tunnel/public health and local primary/queue/auto-publish flags. TikTok also needs local token refresh/sync before official upload tests.

## Recommended Next Work

1. Start the existing Cloudflare tunnel only in a controlled cutover window, then verify public health still reports local/mirror mode.
2. Keep Studio V2 pilot blocked until a candidate has enough motion backbone and source diversity.
3. Refresh/sync TikTok local token only under explicit no-post constraints, then test dispatch pack readiness without posting.
4. Treat Facebook Reels as ready for controlled normal-publisher verification once local posting is green.
5. Keep Railway standby-only; do not restore it as primary just to resume posting.
