# Overnight Status Snapshot

Generated: 2026-05-06 21:45 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest commit: `567f1d3f Add monetisation readiness report`
- `origin/main`: `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`
- Working tree at snapshot refresh: clean before final handoff edits
- Deployed: no

## Validation

- Full `npm test`: pass (`2035/2035`)
- `npm run build`: pass
- Local TTS doctor: green
- TikTok auth doctor: AMBER, token usable, public direct-post approval still not confirmed
- No Railway deploy, OAuth trigger, production DB mutation, social posting, scheduler change or production renderer switch was performed.

## Local TTS

- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Latest local TTS doctor verdict: `green`
- Current reason: local TTS is ready with accepted Liam voice loaded
- Proof path remains local-only. Do not fall back to the old low/demonic voice.

## Studio V2

- Latest proof candidate: `1szzhy9`
- Latest enriched proof: `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4`
- Promotion packet: `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`
- Status: AMBER local proof only, not production default
- Blocker: needs human visual review and explicit one-story pilot approval before any live use

## Motion Acquisition

- Motion gap report: `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- Current state: official-reference and frame/clip planning remain local/report-only
- Safety: no production downloads, no browser scraping, no social scraping, no posting

## TikTok

- Auth doctor token status: connected, ok, refresh available
- Overall auth doctor verdict: AMBER because public direct-post approval is not confirmed
- Dispatch status: no current pack is ready; candidates are stale or missing media/cover
- Recommended bridge: fresh 60+ second official inbox pack, then manual/operator review

## Voice Shootout

- Report: `VOICE_SHOOTOUT_OVERNIGHT_REPORT.md`
- Status: local framework ready for Liam benchmark
- External/paid providers remain blocked pending approval

## Longform

- Report: `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- Dossier aliases: `test/output/longform_dossier.md` and `test/output/longform_dossier.json`
- Current prototype: Weekly Roundup local outline with segments, source pack, chapter plan, visual plan, SEO package and Shorts spin-off plan
- Status: local-only, no upload or scheduler change

## Monetisation

- Report: `MONETISATION_OVERNIGHT_REPORT.md`
- Dossier aliases: `test/output/monetisation_readiness.md` and `test/output/monetisation_readiness.json`
- Status: milestone tracker, affiliate audit and media-kit draft are report-only
- YPP fixture state: not eligible
- Affiliate policy: targeted links only, disclosure required, platform-policy stories stay review unless they have a real product angle

## Known Blockers

- Studio V2 cannot become production default without approval.
- TikTok direct public posting still depends on TikTok app/API approval state.
- No TikTok dispatch pack is currently ready.
- External/paid voice shootout needs approval before spending credits or sending voice material to a provider.
- Longform upload/scheduling needs approval.
- Monetisation changes to live copy, sponsor outreach or affiliate publishing need approval.

