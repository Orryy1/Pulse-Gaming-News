# Pulse System Audit and Roadmap

Generated: 2026-04-28

## Branch and Safety

- Branch: `codex/pulse-full-stabilise-and-learn`
- Main touched: no
- Deploy performed: no
- Production/Railway mutation: no
- Read-only Railway check: yes
- OAuth triggered: no
- Platform posting triggered: no

## Production Parity

- Local head: `819739a06c362207c256dcbbb91d79e3175eb0bc`
- Railway latest deployment: `9b14600b-f2ed-4ed0-8445-b878fb5d3176`
- Railway deployed commit: `819739a06c362207c256dcbbb91d79e3175eb0bc`
- Health endpoint: 200 OK
- Scheduler: active
- Dispatch: queue, strict
- SQLite path: `/data/pulse.db`
- Railway health verdict: review, 0 hard fails

Review reason:

- latest app logs include a Discord.js ready-event deprecation warning. Local branch now fixes the lightweight auto-post client to use `Events.ClientReady`.

## GitHub and Railway Auth

- Railway CLI works through `npx @railway/cli`.
- Global `railway` binary is not required.
- GitHub CLI is installed but not authenticated.
- HTTPS GitHub push is expected to fail until `gh auth login` or Git Credential Manager auth is completed.
- See `GITHUB_RAILWAY_AUTH_RECOVERY.md`.

## Current System State

Working:

- story hunting
- scoring and approval framework
- queue-backed scheduler
- YouTube upload path
- Facebook Card fallback
- Instagram Story fallback
- Studio V2 canonical render
- thumbnail safety chain
- local performance intelligence fixtures
- local comment copilot fixtures
- TikTok dispatch pack generation
- Railway health and ops tooling

Degraded:

- Facebook Reel is gated off by `FACEBOOK_REELS_ENABLED` after live evidence showed Graph accepted uploads but no visible Reels appeared.
- Instagram Reel remains intermittent; logging now requests Graph error fields.
- TikTok public Direct Post remains externally blocked by app approval/public-posting status.
- GitHub CLI auth is missing on this machine.
- Studio multichannel outputs are warning-level, not release-ready.

Experimental:

- Studio V2.1 hero-moment candidate
- creator-grade render variants
- performance intelligence real-mode ingest
- comment copilot real-mode ingest
- Monthly Release Radar prototype

Unknown:

- Whether Facebook Page Reels eligibility has cleared since the latest probe.
- Whether the current YouTube OAuth token includes `yt-analytics.readonly`; the auth URL now requests it, but existing tokens do not expand automatically.
- Whether real YouTube comments should be ingested tonight; the code path is read-only but should stay gated.

## Platform Audit

### YouTube

Status: proven core path.

Evidence:

- uploader validates MP4 size before upload
- media paths resolve through `lib/media-paths`
- custom thumbnail selection runs thumbnail safety QA before upload
- OAuth URL includes `yt-analytics.readonly` for future analytics

Next expected behaviour:

- YouTube remains the main production publishing path.
- Analytics real mode needs operator-controlled re-auth if the current token lacks the analytics scope.

### Facebook Reel

Status: gated off by default.

Evidence:

- `publisher.js` checks `FACEBOOK_REELS_ENABLED === "true"`
- when off, outcome is `page_not_eligible`
- `upload_facebook.js` only treats a Reel as ready when publish is explicit or `published=true` plus a permalink exists
- `complete` alone is treated as processing because live evidence showed false success
- page-content probe exists at `tools/diagnostics/fb-page-content-probe.js`

Next expected behaviour:

- Discord should show Facebook Reel as paused/page-not-eligible, not a false success.
- Facebook Card fallback should continue.
- Only re-enable Reels after the read-only probe shows real visible Page videos/Reels.

### Facebook Card

Status: working fallback.

Evidence:

- publish summary keeps FB Card separate from FB Reel.
- tests prevent FB Card success from masquerading as FB Reel success.

### Instagram Reel

Status: intermittent but more observable.

Evidence:

- polling requests `status_code,status,error_code,error_subcode,error_message`
- binary, URL and Story polling paths use the shared field list
- timeout/error messages preserve the last status summary

Next expected behaviour:

- the next `2207076`-style failure should include actionable Graph error details.

### Instagram Story

Status: fallback has worked.

Evidence:

- Story image path resolves through media paths.
- Story polling uses the richer Instagram status fields.

### TikTok

Status: externally blocked for public posting.

Evidence:

- static diagnosis verdict: `unaudited_app_public_posting`
- current upload path is `FILE_UPLOAD`
- scopes include `video.publish` and `video.upload`
- dispatch pack generation works locally

Next expected behaviour:

- do not keep rewriting the uploader.
- solve app approval or use dispatch/scheduler workflow.

### X/Twitter

Status: intentionally disabled.

Evidence:

- uploader tests pin disabled-by-default behaviour.

## Scheduler and Queue Audit

Working:

- production health reports queue/strict mode
- schedules are seeded idempotently
- produce windows run before publish windows
- publish windows are 09:00, 14:00 and 19:00 UTC
- stale job reaper is scheduled every minute
- terminal job failure Discord alert is gated

Local ops output:

- `ops:queue:inspect`: skip locally, no failed jobs, no stale claims
- `ops:db:backup-dry-run`: pass

Recommended fixes:

- keep failed-job Discord alert enabled in production if not already
- do not widen publish cadence until queue visibility is routinely checked after windows

## Media Path and QA Audit

Working:

- uploaders resolve MP4s through `lib/media-paths`
- production uses persistent `/data/pulse.db`
- generated media can be routed via `MEDIA_ROOT`
- `validateVideo` rejects 0-byte and suspiciously small MP4s
- video QA checks duration and black-frame risk
- content QA records script/media reasons

Local ops output:

- `ops:media:verify`: pass, 0 issues

Recommended fixes:

- keep tightening any direct `fs.pathExistsSync` render references that bypass `mediaPaths` when they touch production media
- keep QA failure reasons visible in Discord summaries

## Studio Render Audit

Canonical:

- remains default
- gauntlet best candidate is `1sn9xhe:canonical`
- canonical score: 100
- forensic: pass
- subtitles: pass
- repeated SFX: controlled

V2.1:

- rejection gate candidate currently passes
- V2.1 does not automatically replace canonical
- next step is human visual review against canonical

Gauntlet:

- overall gauntlet verdict is fail because historical/rendered variants remain in the candidate pool
- failures are useful known-bad calibration examples, not reasons to replace canonical

Current channel readiness:

- pulse-gaming: warn
- stacked: warn
- the-signal: warn
- release-ready channels: 0/3

Creative bottleneck:

- media inventory report: 1 short-only story, 9 blog-only stories
- the next real render-quality leap depends more on source inventory than another overlay pass

## Format Architecture

Implemented locally:

- Daily Shorts
- Daily Briefing
- Weekly Roundup
- Monthly Release Radar
- Before You Download
- Trailer Breakdown
- Rumour Radar
- Blog-only / reject lane

Monthly Release Radar prototype:

- candidate schema generated
- top 10 ranked
- fact-check gate generated
- rejected list generated
- long-form script generated
- chapters generated
- SEO package generated
- pinned comment generated
- 10 Shorts scripts generated
- 10 Shorts title options generated
- blog article generated
- newsletter version generated
- manual review checklist generated

Important limitation:

- current Monthly Release Radar output is fixture-based and contains `NEEDS_SOURCE`; it is not publishable until release dates and source fields are resolved.

## Performance Intelligence Loop

Exists:

- schema tables for snapshots, features, comments, patterns, render versions, recommendations and experiments
- fixture-mode analytics client
- gated real-mode YouTube Analytics client
- digest generator

Output:

- `test/output/learning-digest/digest-2026-04-28.md`
- `test/output/learning-digest/digest-2026-04-28.json`

Real data status:

- not connected in this pass
- real mode requires operator-gated auth with `yt-analytics.readonly`
- no automatic scoring-weight changes are enabled

## Comment Copilot

Exists:

- fixture-mode comment ingest
- gated real-mode YouTube comment ingest
- classifier
- draft-only reply queue
- viewer-signal summary

Output:

- `test/output/comment-digest/comments-2026-04-28.md`
- `test/output/comment-digest/comments-2026-04-28.json`
- `test/output/comment-digest/reply-queue-2026-04-28.json`
- `test/output/comment-digest/viewer-signals-2026-04-28.json`

Safety:

- no replies sent
- no likes/hearts
- no moderation
- all replies are drafts

## TikTok Operator Path

Likely blocker:

- unaudited TikTok app/public posting approval

Required external action:

- reframe the TikTok developer app as a Pulse Gaming media publishing workflow
- verify Direct Post approval
- verify `video.publish` and `video.upload`
- confirm allowed privacy levels through TikTok dashboard/API

Code changes needed:

- none unless new evidence contradicts the app-review diagnosis

See:

- `TIKTOK_OPERATOR_CHECKLIST.md`
- `test/output/tiktok_403_diagnosis.md`
- `test/output/tiktok_dispatch_manifest.md`

## Prioritised Next Actions

### P0 - do next

- Complete GitHub auth (`gh auth login` or Git Credential Manager), then push this branch.
- Run the next publish window and verify Discord output shows Facebook Reel as paused/page-not-eligible, Facebook Card as separate fallback and Instagram error details if a Reel fails.
- Re-run `npm run ops:railway:health` after the next publish window and inspect errors/warnings.
- Verify whether the current YouTube OAuth token includes `yt-analytics.readonly`.

### P1 - do soon

- Run read-only Facebook Page content probe after Meta has had more time to age the Page.
- Connect Performance Intelligence to real YouTube Analytics in gated read-only mode.
- Connect Comment Copilot to real YouTube comments in gated read-only mode.
- Add a weekly media inventory digest that flags `blog_only` stories before render time.
- Improve Studio channel variants with a limiter and source inventory upgrades before more visual effects.

### P2 - later

- Build a real Monthly Release Radar source acquisition workflow.
- Build long-form render templates only after source facts and assets clear the gate.
- Research third-party TikTok schedulers with true auto-publish.
- Add operator dashboard widgets for queue health, platform status and learning digest.

### Do not do

- Do not promote V2.1 over canonical on metrics alone.
- Do not re-enable Facebook Reels until visible Page evidence exists.
- Do not keep rewriting TikTok upload method; `FILE_UPLOAD` is already active.
- Do not use browser-cookie posting for live accounts.
- Do not auto-reply to YouTube comments.
- Do not force premium videos from `blog_only` media inventory.

## Honest Judgement

The system is healthier than it was, but it is not yet enterprise-grade.

It is now substantially more observable and safer around the known platform failure modes. The biggest remaining bottleneck is source/media inventory, not another render flourish. Before the next deploy, GitHub auth should be fixed so GitHub and Railway do not drift. During the next publish window, watch Discord for platform-specific truthfulness: YouTube success, Facebook Reel paused not false-success, Facebook Card separate and Instagram Reel failures with real error codes.

