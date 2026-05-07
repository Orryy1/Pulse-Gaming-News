# Tonight Handoff

Date: 2026-05-07

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Latest pushed commit entering this motion guard pass: `9a33eee2 Add YouTube analytics ingestion packet`
- Deployed: no
- Railway env vars: untouched
- Production DB: untouched
- OAuth: not triggered by this work
- Social posting: none
- Production renderer defaults: unchanged
- Production voice defaults: unchanged

## What Changed In This Continuation

- Local Liam TTS proof reporting was hardened and pushed earlier in `aa00bd84`.
- Studio V2 and motion reports were regenerated after the local TTS fix.
- The Studio V2 selector now clearly shows voice is no longer the main blocker; motion and exact subject visuals are.
- TikTok auth diagnostics were fixed so a usable token no longer keeps the old dashboard client-key warning.
- TikTok dispatch, voice shootout, longform and monetisation reports were refreshed.
- Facebook Reels read-only Graph inspection now reports `eligible_for_normal_publish` with one visible Reel and one visible video.
- Analytics capability doctor was run and documented. Pulse has local/public-counter learning, but not full YouTube Studio analytics yet.
- Learning and comment-digest Markdown renderers now have regression tests that prevent mojibake in public operator reports.
- A read-only YouTube Analytics ingestion packet was added. It plans retention and traffic-source queries but blocks safely until analytics scope is approved.
- Studio V2 official trailer source selection now skips PEGI/ESRB/rating-board references before deep-scan clip refs are created.
- Studio V2 official trailer segment validation now preflight-rejects rating-board references and official segments that start inside the intro/rating window, before any frame extraction.

## Validation

- Focused analytics/intelligence tests: pass (`32/32`)
- Focused YouTube analytics packet tests: pass (`8/8`)
- Focused official trailer clip-ref tests: pass (`23/23`)
- Focused official trailer segment-validator tests: pass (`17/17`)
- Focused Flash Lane motion/backbone/director tests: pass (`43/43`)
- Combined Studio V2 motion safety tests: pass (`83/83`)
- Focused TikTok diagnostics/dispatch tests: pass (`47/47`)
- Focused voice/longform/monetisation tests: pass (`19/19`)
- Full `npm test`: pass (`2104/2104`)
- `npm run build`: pass

## Current Verdicts

- Local TTS: `GREEN`
- Studio V2 live pilot: `RED_BLOCKED`
- Motion acquisition: local-only, still insufficient for Flash Lane
- TikTok auth: `AMBER`, token usable, public direct posting not confirmed
- TikTok dispatch: no ready clean pack for upload
- Facebook Reels: `eligible_for_normal_publish`, keep strict verifier and card fallback
- Analytics learning: `AMBER`, public-counter/local learning only until YouTube analytics scope is approved
- Voice shootout: local benchmark framework ready
- Longform: Weekly Roundup outline ready for editorial review
- Monetisation: pre-monetisation, report-only

## Key Reports

- `OVERNIGHT_STATUS_SNAPSHOT.md`
- `LOCAL_TTS_OVERNIGHT_REPORT.md`
- `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`
- `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- `TIKTOK_OVERNIGHT_AUTOMATION_REPORT.md`
- `VOICE_SHOOTOUT_OVERNIGHT_REPORT.md`
- `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- `MONETISATION_OVERNIGHT_REPORT.md`
- `ANALYTICS_LEARNING_STATUS.md`
- `YOUTUBE_ANALYTICS_INGESTION_PACKET_REPORT.md`
- `MORNING_APPROVAL_QUEUE.md`
- `FACEBOOK_REELS_STATUS.md`

## Current Best Proofs

- Local Liam MP3 proof: `D:\pulse-data\media\test\output\local-media-repair\audio\rss_8ea7f2689732f31a_liam.mp3`
- Studio V2 blocked proof: `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4`
- Studio V2 contact sheet: `test/output/studio-v2-still-deck/1szzhy9_enriched_contact_sheet.jpg`

## Biggest Remaining Blocker

The system can now produce acceptable local Liam narration, but it still cannot safely produce a Flash Lane Studio V2 proof because the official motion windows are not yet good enough. The current gates correctly block repeated, low-detail, black, rating-board, intro-window or weak gameplay-looking segments.

## Morning Approval Items

See `MORNING_APPROVAL_QUEUE.md`:

- Studio V2 pilot remains blocked
- TikTok inbox/manual route should wait for a clean pack
- YouTube Analytics read-only re-auth is needed for deep Creator Studio learning
- Paid/external voice shootout remains approval-gated
- One longform pilot can be considered after editorial review
- Monetisation remains report-only until story-by-story approval

## Recommended Next Work

1. Keep improving official trailer and gameplay-window acquisition until at least one story has three validated clip refs, three validated sources and clean forensic output.
2. Use local Liam only for proof renders while keeping production voice unchanged.
3. Build a fresh TikTok pack only from a clean current MP4, not from the blocked Studio V2 proof.
4. Use the Weekly Roundup dossier as the first Pulse Briefing Lane editorial prototype.
5. Watch the next normal Facebook Reel publish attempt; Page eligibility now looks unblocked but the strict verifier should stay on.
6. Build the read-only YouTube Analytics ingestion packet, then run OAuth only after Martin approves the morning item.
7. Keep monetisation tooling report-only until real analytics and affiliate targeting are clean.
