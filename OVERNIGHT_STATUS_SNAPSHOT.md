# Overnight Status Snapshot

Generated: 2026-05-08 00:42 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest pushed commit before this snapshot: `5d5eca3c`
- Current slice pending commit: TikTok dispatch cover-file verification and refreshed overnight reports
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

- TikTok/dispatch focused tests: pass (`44/44`)
- Voice, longform, monetisation and analytics focused tests: pass (`59/59`)
- Full `npm test`: pass (`2180/2180`)
- `npm run build`: pass

## Local TTS

- Verdict: `GREEN`
- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Latest smoke proof: `D:\pulse-data\media\output\audio\__local_tts_smoke_sleepy_liam_latest.mp3`
- Voice-ready proof: `D:\pulse-data\media\test\output\local-media-repair\audio\rss_8ea7f2689732f31a_liam.mp3`
- The old low/demonic fallback voice is blocked by the local Liam safety gate.

## Studio V2 And Flash Lane

- Ready local Flash proofs: `0`
- Current closest story: `rss_5b3abe925b27a199`
- Local Liam audio for that story is ready at about `72.5s`
- Exact subject assets are strong enough for planning, but motion is not strong enough for a premium TikTok-style proof.
- Current blocker: needs a non-exhausted official Red Dead motion source and better clip dominance.
- Studio V2 live pilot verdict: `RED_BLOCKED`

## Motion Acquisition

- Motion report: `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- Current strategy: alternate official sources, not another blind rescan of exhausted Steam/trailer windows.
- Latest Flash Lane state says one candidate still needs alternate official motion source work.
- No video render was started from the blocked proof.

## TikTok

- Auth doctor verdict: `AMBER`
- Local token status: expired but refreshable or syncable
- Browser OAuth succeeded earlier on `pulse.orryy.com`, but the local token file is still stale.
- Official inbox/manual route remains the safest route once a clean MP4 pack exists.
- Public direct-post approval is still not confirmed.
- New safe gate: dispatch now checks whether MP4 and cover files actually exist, not just whether DB paths are populated.

## Analytics And Learning

- Analytics doctor verdict: `AMBER`
- Current learning depth: public counters/local history only
- YouTube Studio retention and traffic-source learning is blocked until read-only `yt-analytics.readonly` re-auth is approved.
- Learning and comment digest tools remain report-only and do not auto-reply.

## Longform

- Report: `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- Status: Weekly Roundup local outline ready for editorial review
- No upload, scheduler change or production DB write was made.

## Monetisation

- Report: `MONETISATION_OVERNIGHT_REPORT.md`
- Stage: pre-monetisation
- Cleared milestones: `1/12`
- YPP eligible: false
- Affiliate and sponsor outputs remain report-only.

## Known Blockers

- Studio V2 needs better validated gameplay/motion before any live pilot.
- TikTok local token needs refresh or sync before official inbox upload can be tested locally.
- A clean current MP4 pack is required before TikTok manual/inbox workflow.
- Deep YouTube learning needs read-only analytics OAuth re-auth.
- Live affiliate, sponsor, longform upload and production voice/renderer changes all remain approval-gated.
