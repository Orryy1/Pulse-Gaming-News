# Overnight Status Snapshot

Generated: 2026-05-07 04:28 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest pushed commit entering this target-coverage pass: `f5755390 Use proof candidate entities for footage acquisition`
- Working tree during this snapshot: Studio V2 story-target coverage and headline inference hardening
- Deployed: no

## Safety

- Railway env vars: untouched
- Cloudflare/DNS: untouched
- OAuth: not triggered by this work
- Production DB: untouched
- Social posting: none
- Scheduler frequency: unchanged
- Production renderer defaults: unchanged
- Production voice defaults: unchanged

## Validation

- Focused official trailer clip-ref tests: pass (`23/23`)
- Focused official trailer segment-validator tests: pass (`17/17`)
- Focused Flash Lane footage acquisition tests: pass (`11/11`)
- Focused game-title inference tests: pass (`5/5`)
- Focused story-target coverage tests: pass (`39/39`)
- Focused Flash Lane motion/backbone/director tests: pass (`43/43`)
- Combined Studio V2 motion safety tests: pass (`83/83`)
- Focused analytics/intelligence tests: pass (`32/32`)
- Focused YouTube analytics packet tests: pass (`8/8`)
- Full `npm test`: pass (`2113/2113`)
- `npm run build`: pass

## Local TTS

- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Local TTS overnight verdict: `GREEN`
- Latest proof: `rss_8ea7f2689732f31a` local Liam MP3, measured `65.44s`
- Current state: local Liam is viable for proof renders and the old low/demonic fallback is not accepted.

## Studio V2

- Proof selector: `0` ready Flash proofs, `20` blocked by motion/exact-asset gaps
- Closest story: `rss_5b3abe925b27a199`, but it still lacks validated clip refs/sources and has forensic warnings
- Promotion packet story: `1szzhy9`
- Promotion packet verdict: `RED_BLOCKED`
- Main blockers: forensic warnings, repeated visual pairs, weak rendered frames, insufficient current segment validation and insufficient clip-source diversity
- Live status: local-only, no production switch

## Motion Acquisition

- Motion gap report: `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- `1szzhy9` segment validation found `0/16` usable segments after strict gameplay/taste gates.
- Rejection pattern: repetitive samples, insufficient gameplay action, low-detail frames, black frames and sample extraction failures.
- New guardrail: resolver references that are only PEGI/ESRB/rating-board material are filtered before clip refs, and official trailer segments before 36s are rejected before extraction.
- Footage acquisition planner now falls back to Studio V2 proof-candidate exact subject groups when frame reports are thin, so it produces concrete entity shopping lists instead of hiding work behind `no story entities`.
- Proof candidates now separate intended story target entities from found exact assets and validated clips, so a Take-Two/GTA/Red Dead/BioShock story cannot pass on one single-game asset pile.
- Headline inference now strips source labels, quoted phrases and release-time utility tails before creating acquisition targets.
- Live status: local/report-only

## TikTok

- Auth doctor: `AMBER`
- Token status: connected, usable, refresh available
- Direct public-post approval: not confirmed
- Dispatch manifest: generated without upload
- Fresh pack: refused to auto-select a live render without explicit `--mp4`, which is the intended safety behaviour
- Live status: no upload, no browser automation, no token mutation

## Facebook Reels

- Status report: `FACEBOOK_REELS_STATUS.md`
- Verdict: `eligible_for_normal_publish`
- Evidence: Graph sees `1` video, `1` Reel and a valid Page token with `publish_video`.
- Local flag: `FACEBOOK_REELS_ENABLED=true`
- Safety: read-only check only, no Facebook post

## Analytics And Learning

- Status report: `ANALYTICS_LEARNING_STATUS.md`
- Analytics doctor: `AMBER`
- Detailed YouTube Analytics: `requires_youtube_scope_reauth`
- Learning dataset: `public_counter_history_only`
- Platform metric rows: `330`
- Rich retention rows: `0`
- Video performance rows: `0`
- Learning digest: generated under `test/output/learning-digest/`
- Comment digest: generated under `test/output/comment-digest/`
- YouTube analytics ingestion packet: `BLOCKED`, `requires_youtube_scope_reauth`
- YouTube analytics packet report: `YOUTUBE_ANALYTICS_INGESTION_PACKET_REPORT.md`
- Safety: no OAuth, no token printing, no DB mutation, no scoring-weight changes, no auto-replies

## Voice Shootout

- Report: `VOICE_SHOOTOUT_OVERNIGHT_REPORT.md`
- Verdict: `AMBER_READY_FOR_LOCAL_BENCHMARKS`
- Local Liam is ready for local benchmark review.
- Paid/external providers remain approval-gated.

## Longform

- Report: `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- Current prototype: Weekly Roundup local outline
- Status: outline ready for editorial review, no upload or scheduler change

## Monetisation

- Report: `MONETISATION_OVERNIGHT_REPORT.md`
- Current stage: pre-monetisation
- Snapshot: `1/12` checks cleared, YPP not eligible
- Status: report-only

## Known Blockers

- Studio V2 needs better validated motion before a live pilot.
- TikTok public posting remains dependent on app/API approval state.
- TikTok inbox/manual workflow needs a clean MP4 pack first.
- Deep YouTube Studio learning needs a read-only analytics OAuth re-auth before retention and traffic-source data can be ingested.
- Facebook Reels should be watched on the next normal publish to confirm API upload success, but Page eligibility now looks unblocked.
- External voice providers need approval before spending credits or sending voice material externally.
- Longform upload/scheduling needs approval.
- Monetisation changes to live copy or sponsor outreach need approval.
