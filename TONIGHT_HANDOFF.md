# Tonight Handoff

Date: 2026-05-07

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Base pushed commit before this slice: `c1e3d249 Improve local trailer segment scan resume`
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
- Flash Lane footage acquisition now uses Studio V2 proof-candidate exact subject groups when frame reports are thin, preventing false `no story entities` reports and creating concrete entity shopping lists.
- Studio V2 proof candidates now track intended story target entities separately from found exact assets and validated clips.
- Multi-franchise stories now stay blocked until the actual games/franchises in the script have exact subject and validated motion coverage.
- Headline inference now avoids source labels, quoted fragments and release-time utility tails becoming fake media acquisition targets.
- Official trailer reference resolution is now target-aware, so a single GTA trailer reference does not fully cover a GTA/Red Dead/BioShock story.
- Motion Acquisition Pro now has a partial-reference state and creates targeted official-reference search actions for missing story entities.
- Official trailer resolver now filters explicit PEGI/rating-board Steam movies before they enter reports.
- Segment validation can now keep a shorter trimmed gameplay slice when a trailer window has two clean action samples but a weak tail.
- Local TTS was recovered with `npm run tts:doctor -- --restart --prewarm`; the accepted Liam voice is loaded and the latest smoke proof is `D:\pulse-data\media\output\audio\__local_tts_smoke_sleepy_liam_latest.mp3`.
- Segment validation can now resume from and merge previous local scan reports, so validated windows are preserved while new source/start windows are sampled.
- Deep-scan official clip refs now rotate alternate sources before repeated later windows from the same source.
- New segment validation reports include source provenance for future scans, making failed Steam/IGDB trailer sources easier to diagnose.
- A resumed local scan for `rss_5b3abe925b27a199` checked `100` merged segment windows and found `2` validated windows, both BioShock. GTA and Red Dead remain blocked, so no Studio V2 render was attempted.
- Studio V2 motion-gap reporting now classifies exhausted source families. For `rss_5b3abe925b27a199`, GTA has `51` failed official-window attempts and Red Dead has `22`, so the next action is alternate official sources, not another blind rescan of the same material.
- Source-family grouping now shows GTA failures spread across `8` official source families and Red Dead across `2`, with top rejection reasons per family.
- Segment validation now skips exhausted source families when resuming from a previous local scan. The latest dry-run skipped `28` already-sampled refs and `8` exhausted source-family refs, leaving `6` new unsampled windows instead of blindly revisiting known-bad official sources.
- Legacy Steam CDN trailer URLs are now backfilled into concrete source-family metadata. Old scans now show `steam`, store app IDs and movie IDs instead of `unknown`, which makes alternate-source acquisition decisions much clearer.
- Official trailer reference resolution can now ingest the previous segment-validation report and exclude exhausted Steam source families before planning the next search. The current story check with a five-window threshold excluded `9` known-bad Steam refs and left `5` further candidates for local validation.

## Validation

- Focused analytics/intelligence tests: pass (`32/32`)
- Focused YouTube analytics packet tests: pass (`8/8`)
- Focused official trailer clip-ref and segment-validator tests: pass (`46/46`)
- Focused Flash Lane footage acquisition tests: pass (`11/11`)
- Focused game-title inference tests: pass (`5/5`)
- Focused story-target coverage tests: pass (`39/39`)
- Focused trailer resolver/motion acquisition tests: pass (`18/18`)
- Focused Flash Lane motion/backbone/director tests: pass (`43/43`)
- Combined Studio V2 motion safety tests: pass (`83/83`)
- Focused Studio V2 motion-gap tests: pass (`14/14`)
- Focused official trailer segment-validator tests: pass (`24/24`)
- Focused official trailer reference resolver tests: pass (`11/11`)
- Focused TikTok diagnostics/dispatch tests: pass (`47/47`)
- Focused voice/longform/monetisation tests: pass (`19/19`)
- Full `npm test`: pass (`2131/2131`)
- `npm run build`: pass

## Current Verdicts

- Local TTS: `GREEN`
- Studio V2 live pilot: `RED_BLOCKED`
- Motion acquisition: local-only; refs cover GTA, BioShock and Red Dead, but only two trimmed BioShock gameplay segments validate after 100 merged local segment checks. GTA and Red Dead are now marked `alternate_source_required`; source-family grouping shows GTA exhausted across `8` source families and Red Dead across `2`, and the validator now skips exhausted families on resume. Flash Lane remains blocked until new official source families are found.
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

1. Find alternate official GTA and Red Dead source families before any new multi-franchise Studio V2 proof render.
2. Keep improving official trailer and gameplay-window acquisition until at least one story has three validated clip refs, three validated sources and clean forensic output.
3. Use local Liam only for proof renders while keeping production voice unchanged.
4. Build a fresh TikTok pack only from a clean current MP4, not from the blocked Studio V2 proof.
5. Use the Weekly Roundup dossier as the first Pulse Briefing Lane editorial prototype.
6. Watch the next normal Facebook Reel publish attempt; Page eligibility now looks unblocked but the strict verifier should stay on.
7. Keep monetisation tooling report-only until real analytics and affiliate targeting are clean.
