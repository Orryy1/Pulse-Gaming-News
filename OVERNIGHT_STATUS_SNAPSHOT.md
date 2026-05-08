# Overnight Status Snapshot

Generated: 2026-05-08 10:12 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Current base commit before this slice: `f51f8895`
- Latest pushed slice: local Liam voice shootout sample generation under `test/output`
- Current working slice: Studio V2/Flash Lane wrong-story exact asset zero tolerance
- Deployed: no

## Safety

- Railway env vars: untouched
- Cloudflare/DNS: untouched
- OAuth: not triggered by this work
- Production DB rows: untouched
- Social posting: none
- Scheduler frequency: unchanged
- Production renderer defaults: unchanged
- Production voice defaults: unchanged
- TikTok browser automation: not used

## Validation

- Latest focused voice tests: pass (`36/36`)
- Latest local voice shootout apply-local command generated 2 local Liam benchmark samples under `test/output/voice-shootout/audio`
- Latest Studio V2 focused tests: pass (`38/38`)
- Full `npm test`: pass (`2294/2294`)
- `npm run build`: pass
- `git diff --check`: pass with CRLF warnings only

## Local TTS

- Verdict: `GREEN`
- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Latest smoke proof: `D:\pulse-data\media\output\audio\__local_tts_smoke_sleepy_liam_latest.mp3`
- Voice-ready proof: `D:\pulse-data\media\test\output\local-media-repair\audio\rss_8ea7f2689732f31a_liam.mp3`
- Voice shootout proofs: `test/output/voice-shootout/audio/voice_shootout_prices_voxcpm2_1.mp3` and `test/output/voice-shootout/audio/voice_shootout_game_titles_voxcpm2_1.mp3`
- The old low/demonic fallback voice is blocked by the local Liam safety gate.
- New hard proof fields: pitch profile, spoken outro and WPM evidence must now travel with local MP3s before Studio V2 can treat them as voice-ready.
- Voice shootout now has 2 public blind-review rows and keeps the private model map local.

## Studio V2 And Flash Lane

- Ready local Flash proofs: `0`
- Current closest story: `rss_5b3abe925b27a199`
- Local Liam audio for that story is ready at about `72.5s`
- Exact subject assets are numerous but still contaminated; any wrong-story exact asset now blocks Flash proof promotion immediately.
- Current closest story needs exact-subject deck repair first, then non-exhausted official BioShock and Red Dead sources plus another usable GTA window; Marathon is a separate candidate blocker.
- Studio V2 live pilot verdict: `RED_BLOCKED`

## Motion Acquisition

- Motion report: `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- Current strategy: alternate official sources, not another blind rescan of exhausted Steam/trailer windows.
- New intake gate: operator-supplied official sources must pass `npm run media:intake-official-sources` and stay reference-only before resolver/segment validation can use them.
- Latest local scans rejected weak Oblivion windows and found only one usable The Division window plus one usable Tales window, so neither became Flash-ready.
- One-story trailer-reference commands now avoid overwriting the canonical batch report unless `--write-latest-report` is explicitly supplied.
- No video render was started from the blocked proof.

## TikTok

- Auth doctor verdict: `AMBER`
- Local token status: expired but refreshable or syncable
- Earlier operator/browser OAuth was reported as successful on `pulse.orryy.com`, but this local proof did not refresh or verify the local token file.
- Official inbox/manual route remains the safest route once a clean MP4 pack exists.
- Public direct-post approval is still not confirmed.
- New safe gate: dispatch now checks whether MP4 and cover files actually exist, not just whether DB paths are populated.
- Platform doctor: `PLATFORM_READINESS_DOCTOR.md` now separates local token readiness from browser OAuth success and blocks inbox upload until the selected MP4 pack clears creative review.

## Facebook And Instagram

- Facebook Reels: manual upload proof observed; code path remains verifier-guarded and must see ready/published/permalink evidence before counting a Reel as live.
- Instagram Reels: latest `2207076` media processing error is classified as rerender/codec QA work; URL fallback must not resubmit the same rejected MP4.

## Analytics And Learning

- Analytics doctor verdict: `AMBER`
- Current learning depth: public counters/local history only
- YouTube Studio retention and traffic-source learning is blocked until read-only `yt-analytics.readonly` re-auth is approved.
- Learning and comment digest tools remain report-only and do not auto-reply.

## Longform

- Report: `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- Status: stricter Weekly Roundup local outline is `insufficient_segments` until enough confirmed/verified stories are available
- New guardrail: rumours and unsupported release-date stories are deferred instead of being mixed into selected longform segments.
- No upload, scheduler change or production DB write was made.

## Monetisation

- Report: `MONETISATION_OVERNIGHT_REPORT.md`
- Stage: pre-monetisation
- Cleared milestones: `2/22`
- YPP eligible: false
- Local state source: SQLite contributed `23` YouTube public uploads in 90 days and `10,768` local YouTube views; the affiliate tag came from env as a masked public value.
- Missing monetisation inputs are now explicit: subscribers, longform watch hours, TikTok follower/views, newsletter/blog metrics and detailed retention/AVP.
- Expanded YPP early-access tracking is now separate from full YPP ad-revenue tracking.
- TikTok Creator Rewards tracking now includes account type, eligible region, good standing, payment/tax setup, original-content readiness and 60s video eligibility.
- Affiliate report output remains report-only, but this branch adds public-output safety gates for future deployment: story-specific audit required and Amazon Associate disclosure shown.

## Known Blockers

- Studio V2 needs better validated gameplay/motion before any live pilot.
- Studio V2 also needs zero wrong-story exact assets before any local Flash proof can be considered.
- TikTok local token needs refresh or sync before official inbox upload can be tested locally.
- A clean current MP4 pack is required before TikTok manual/inbox workflow.
- Deep YouTube learning needs read-only analytics OAuth re-auth.
- Live affiliate, sponsor, longform upload and production voice/renderer changes all remain approval-gated.
