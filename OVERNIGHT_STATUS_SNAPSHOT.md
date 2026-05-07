# Overnight Status Snapshot

Generated: 2026-05-07 01:38 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest commit: `3a91ba76 Clean monetisation report text hygiene`
- `origin/main`: `2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10`
- Working tree at snapshot refresh: clean before handoff/snapshot refresh
- Deployed: no

## Validation

- Full `npm test`: pass (`2062/2062`)
- `npm run build`: pass
- Local TTS doctor: green
- TikTok auth doctor: AMBER, token usable, public direct-post approval still not confirmed
- No Railway deploy, OAuth trigger, production DB mutation, social posting, scheduler change or production renderer switch was performed.

## Local TTS

- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Latest local TTS doctor verdict: `green`
- Current reason: local TTS is ready with accepted Liam voice loaded
- Latest doctor report: `test/output/local_tts_doctor.md`
- Proof path remains local-only. Do not fall back to the old low/demonic voice.

## Studio V2

- Latest proof candidate: `1szzhy9`
- Latest enriched proof: `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4`
- Promotion packet: `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`
- Status: AMBER local proof only, not production default
- Proof selector: 1 ready Flash proof, 16 need motion or exact assets
- Recent safety upgrade: local proof renders now require accepted local Liam timestamp metadata, so old/demonic local audio cannot silently pass as approved
- Recent creative upgrade: enriched Flash captions now use short phrase reveal plus slide/fade/pop styling instead of static word-only captions
- Blocker: needs human visual review and explicit one-story pilot approval before any live use

## Motion Acquisition

- Motion gap report: `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- Current state: official-reference and frame/clip planning remain local/report-only
- Safety: no production downloads, no browser scraping, no social scraping, no posting

## TikTok

- Auth doctor token status: connected, ok, refresh available
- Overall auth doctor verdict: AMBER because public direct-post approval is not confirmed
- Dispatch status: fresh local dry-run pack exists for `1szzhy9`; no upload was executed
- Recommended bridge: review the 60+ second official inbox pack, then approve a single manual/operator inbox test if the MP4 and cover pass visual review

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
- TikTok dispatch pack is local/dry-run ready only; live inbox upload still needs approval.
- External/paid voice shootout needs approval before spending credits or sending voice material to a provider.
- Longform upload/scheduling needs approval.
- Monetisation changes to live copy, sponsor outreach or affiliate publishing need approval.
