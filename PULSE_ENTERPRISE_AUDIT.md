# Pulse Enterprise Audit

Generated: 2026-04-28

Branch: `codex/pulse-enterprise-hardening`

## Scope

This audit is local and read-only with respect to production. It inspected the repo, scripts, local artefacts, public production health and generated diagnostic reports. It did not deploy, merge, post, mutate Railway, trigger OAuth, change live env vars, modify production DB rows or clean production media.

## Live System

Public health at `https://marvelous-curiosity-production.up.railway.app/api/health` reports:

- Health: OK
- Version: `v2.2.0`
- Deployed commit: `36bdbf0`
- Deployment id: `f048dda1-5399-48e1-bdff-41455c253aaf`
- Branch: `main`
- Scheduler active: true
- Autonomous mode: true
- Dispatch mode: strict queue
- SQLite path: `/data/pulse.db`
- SQLite path appears persistent, not ephemeral

The local branch is ahead of that production commit and remains experimental.

## What Is Working

- Story hunting, scoring and scheduler framework exist.
- YouTube is the proven upload path in local status data, with one recent story carrying a YouTube Shorts URL.
- Public production health endpoint is reachable and clear enough for a first-pass check.
- Media verification can resolve local story media paths and flag missing, tiny or zero-byte artefacts.
- Existing tests cover scheduler safety, dispatch mode, media paths, uploader surfaces, Studio V2 gates, TikTok diagnosis, comments, analytics digest and thumbnail safety.
- Studio V2 canonical remains the strongest render lane by available QA evidence.
- HyperFrames is useful in the card lane but should not replace the ffmpeg video backbone.

## What Is Unproven

- Facebook Reel success after the ready/complete status fix still needs a real platform proof cycle.
- Instagram Reel reliability needs live Graph payload evidence from the improved polling logs.
- Queue inspection skipped locally because `USE_SQLITE` was not enabled in the local process.
- Performance Intelligence and Comment Copilot are currently fixture/local-report driven, not connected to real YouTube Analytics or read-only comment APIs in this pass.
- Monthly Release Radar is a format scaffold only. It deliberately blocks on insufficient verified candidates.

## What Is Broken Or Degraded

- TikTok official API public posting remains blocked by the unaudited-app/public-posting condition in the local diagnosis.
- The Studio V2 QA dossier reports the current multi-channel renders as `warn`, not release-ready.
- Local media inventory shows most current candidate stories as `blog_only` because cached clips and visual assets are thin.
- Railway CLI is unavailable locally, so authenticated Railway CLI health checks were not performed.

## What Is Externally Blocked

- TikTok public posting likely requires TikTok app audit, approved scopes and account/app alignment. The current local diagnosis says FILE_UPLOAD is already the active method, so switching to PULL_FROM_URL is not the fix.
- Real YouTube Analytics ingestion needs safe read-only auth and confirmed scopes before it should replace fixture/local digest inputs.

## Experimental Areas

- Studio V2.1 hero moments and authored variants.
- Multi-channel themed renders.
- Performance Intelligence recommendations.
- Comment Copilot reply drafting.
- TikTok dispatch mode.
- Monthly Release Radar long-form package.

## Safe To Promote After Review

- Thumbnail safety filtering and candidate generation, subject to visual spot checks.
- Read-only ops commands:
  - `npm run ops:system:doctor`
  - `npm run ops:media:verify`
  - `npm run ops:db:backup-dry-run`
  - `npm run ops:platform:status`
- TikTok dispatch pack generation as a manual fallback, because it does not post.
- Media inventory scoring as a pre-production advisory gate.

## Must Not Be Promoted Yet

- Studio V2.1 as default render.
- Current multi-channel Studio V2 variants as release-ready output.
- Any automatic analytics-driven scoring change.
- Any real auto-reply or comment moderation action.
- TikTok browser/RPA posting.
- Monthly Release Radar output without real source verification.

