# Tonight Handoff

Date: 2026-05-07

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Latest commit: `3a91ba76 Clean monetisation report text hygiene`
- Pushed: yes
- Deployed: no
- Railway env vars: untouched
- Production DB: untouched
- OAuth: not triggered by this work
- Social posting: none
- Production renderer defaults: unchanged
- Production voice defaults: unchanged

## Commits Pushed In This Continuation

- `3b128827` Add Flash Lane subtitle motion styling
- `8bc35592` Refresh overnight status snapshot
- `64602565` Add reproducible local TTS overnight report
- `3e6a3f11` Surface Studio V2 forensic warning evidence
- `883af43e` Add forensic review to motion gap report
- `18758cb9` Prefer fresh TikTok dispatch packs in overnight report
- `faa26d85` Refresh voice shootout pronunciation manifest
- `c0d3ffff` Document longform briefing lane strategy
- `3a91ba76` Clean monetisation report text hygiene

Earlier overnight commits on this branch remain pushed as well:

- `0a61ae13` Retry transient local TTS socket drops
- `f33357e4` Add local TTS doctor
- `6b1d47fc` Add TikTok token maintenance tool
- `0f10d96f` Block stale TikTok inbox media
- `fd4f075e` Improve local media repair apply reporting
- `d77aa768` Resolve still-deck narration via media root
- `2b618922` Harden local Liam TTS proofs
- `14137e5d` Add Studio V2 promotion packet
- `272624b8` Add overnight motion gap report
- `6a209a4b` Add TikTok overnight readiness report
- `10314a57` Add voice shootout framework
- `c870f4e9` Add longform production dossier prototype
- `567f1d3f` Add monetisation readiness report

## Validation

- `node --test tests\services\monetisation-readiness.test.js`: pass, `7/7`
- `npm test`: pass, `2062/2062`
- `npm run build`: pass
- `npm run tts:overnight-report`: report generated earlier in this run
- `npm run tiktok:auth-doctor`: AMBER, token usable, direct public-post approval still not confirmed
- `npm run tiktok:fresh-pack -- --story 1szzhy9 ... --dry-run`: dry-run dispatch pack generated earlier in this run
- `npm run longform:dossier -- --fixture --format weekly_roundup`: dossier generated earlier in this run
- `npm run intelligence:monetisation`: report generated and text-hygiene regression added

## What Was Built

- Local Liam TTS robustness: retry handling, doctor/prewarm workflow, proof reporting and approved-voice guardrails. Bad/demonic fallback voice is not accepted for proof renders.
- Studio V2 promotion readiness: local one-story packet, approved local narration, QA artefacts, forensic warning evidence and no production switch.
- Flash Lane subtitle motion: Studio V2 enriched proofs now use punchier caption movement instead of static subtitle appearance.
- Motion acquisition reporting: official trailer/frame/clip gap report now includes forensic warnings so weak frames and repeat pairs stay visible.
- TikTok automation readiness: auth diagnostics, fresh-pack preference, stale media blocking, token-status reporting and operator route report. No upload was executed.
- Fresh TikTok dispatch pack: local dry-run pack for `1szzhy9` with approved Liam voice evidence, current MP4, cover, caption, token gate clear and no live upload.
- TikTok cover candidate scanner: extracts local cover frames, rejects obvious rating/slate/stale-person risks and writes a contact sheet for human visual choice.
- Voice shootout framework: benchmark manifest, local Liam status, blind review sheet, pronunciation watchlist and paid/external provider lockouts.
- Longform prototype: Weekly Roundup dossier with the agreed Flash Lane vs Briefing Lane strategy, source pack, chapters, visual plan, SEO package and Shorts spin-offs.
- Monetisation readiness: milestone tracker, affiliate audit, media-kit draft and revenue-path report with no fantasy projections. Report output now preserves accented game names cleanly.

## Key Reports

- `OVERNIGHT_STATUS_SNAPSHOT.md`
- `LOCAL_TTS_OVERNIGHT_REPORT.md`
- `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`
- `MOTION_ACQUISITION_OVERNIGHT_REPORT.md`
- `TIKTOK_OVERNIGHT_AUTOMATION_REPORT.md`
- `VOICE_SHOOTOUT_OVERNIGHT_REPORT.md`
- `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`
- `MONETISATION_OVERNIGHT_REPORT.md`
- `MORNING_APPROVAL_QUEUE.md`
- `test/output/local_tts_overnight_report.json`
- `test/output/tiktok-fresh-dispatch/tiktok_fresh_dispatch_pack.md`
- `test/output/tiktok-cover-candidates/tiktok_cover_candidates.md`
- `test/output/tiktok-cover-candidates/tiktok_cover_candidates_contact_sheet.jpg`

## Best Local Proof

- MP4: `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4`
- Contact sheet: `test/output/studio-v2-still-deck/1szzhy9_enriched_contact_sheet.jpg`
- QA: `test/output/studio-v2-still-deck/1szzhy9_enriched_qa.json`
- Forensic report: `test/output/studio-v2-still-deck/qa_forensic_1szzhy9_enriched_report.json`
- Status: AMBER local proof. It is useful evidence but not production-ready without human visual review.

## Biggest Remaining Blockers

- Studio V2 needs a controlled one-story pilot approval before any live use.
- TikTok has a usable local token and a fresh local dry-run dispatch pack, but the MP4/cover still need human visual review before any inbox upload.
- TikTok public direct posting remains dependent on TikTok app/API approval state.
- Local Liam is proof-ready, but production voice must not switch without explicit approval.
- Longform is architecture/prototype only and must not be scheduled or uploaded automatically.
- Monetisation is report-only. Live affiliate or sponsor copy still needs approval and story-by-story checks.
- Real YouTube Analytics deep learning remains limited until full analytics scope/data plumbing is approved and verified.

## Morning Approval Items

See `MORNING_APPROVAL_QUEUE.md`:

- One-story Studio V2 pilot
- TikTok route discipline
- Paid/external voice shootout
- Longform pilot
- Monetisation live use

## Recommended Next Work

1. Review the fresh TikTok dispatch MP4 and cover, then decide whether to run one official inbox upload test.
2. Improve Studio V2 visual taste gates further: reject rating cards, title slates, black frames, washed low-detail frames and repeated frame pairs before render.
3. Run another local Liam Studio V2 proof on a stronger, newer story after motion-gap screening.
4. Build a proper Pulse Flash Lane render profile: rapid captions, game-footage backbone, short topic cards and fewer static cover-art holds.
5. Expand the Pulse Briefing Lane into one source-backed weekly roundup pilot, still local-only.
6. Wire real YouTube Analytics scope when approved so the learning loop can move beyond shallow counters.
