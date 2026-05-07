# Overnight Status Snapshot

Generated: 2026-05-07 03:30 BST

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest pushed commit entering this refresh: `aa00bd84 Harden local Liam TTS proof reporting`
- Working tree during this snapshot: safe report refresh plus TikTok auth-doctor diagnostic fix
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

- Focused TikTok diagnostics and dispatch tests: pass (`47/47`)
- Focused voice, longform and monetisation tests: pass (`19/19`)
- Full `npm test`: pass (`2091/2091`)
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
- Live status: local/report-only

## TikTok

- Auth doctor: `AMBER`
- Token status: connected, usable, refresh available
- Direct public-post approval: not confirmed
- Dispatch manifest: generated without upload
- Fresh pack: refused to auto-select a live render without explicit `--mp4`, which is the intended safety behaviour
- Live status: no upload, no browser automation, no token mutation

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
- External voice providers need approval before spending credits or sending voice material externally.
- Longform upload/scheduling needs approval.
- Monetisation changes to live copy or sponsor outreach need approval.
