# Morning Approval Queue

Generated: 2026-05-06

This queue contains only actions that would affect live risk, production defaults or platform accounts. Everything here should stay manual until Martin approves it in plain English.

## 1. One-Story Studio V2 Pilot

Decision needed: approve or reject a one-story Studio V2 pilot candidate for `1szzhy9`.

Why it matters: the latest local proof is the first one that has approved local Liam narration, 60+ second runtime, motion-backed official trailer references, green QA and zero forensic fails. It is still not a production default.

What changes: if approved later, one manually selected story may be rendered through Studio V2 for a controlled pilot. The production renderer must not be switched globally.

Risk: the proof still has forensic warnings and needs human visual review. The current proof is `AMBER_LOCAL_PROOF`, not green: forensic QA warns on two repeated visual pairs at 46.5s/49.5s and 55.5s/58.5s, plus two weak rendered frame samples at 16.5s (`dead_dark_frame`) and 22.5s (`washed_low_detail_frame`). A pilot could look worse than the legacy renderer if clip taste or pacing does not match the channel.

Rollback: keep legacy `assemble.js` as canonical. If the pilot fails visual review or upload QA, publish using the existing legacy path and do not set any Studio V2 production flag.

Tests/build status: focused Studio V2 promotion and motion gap tests passed. Latest full validation passed: `npm test` `2059/2059`, `npm run build` pass.

Recommendation: review `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`, `test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4` and `test/output/studio-v2-still-deck/1szzhy9_enriched_contact_sheet.jpg` in the morning. If the visual taste still feels short of the high-energy Flash Lane bar, reject the pilot and keep improving motion acquisition. Do not approve a global Studio V2 switch.

## 2. TikTok Route Discipline

Decision needed: approve or reject one official TikTok inbox upload test from the fresh local dispatch pack.

Why it matters: the local TikTok token now reports usable and a fresh local dry-run dispatch pack exists for `1szzhy9`, with 74.67s runtime, approved local Liam voice evidence, cover, caption and stale-render checks. It still needs human visual review before any live upload.

What changes: if approved later, run one explicit official inbox upload command for the selected MP4 only. This sends a TikTok inbox/draft item for manual completion; it must not create a public post automatically.

Risk: live-account browser automation can trigger account-risk systems and remains blocked. Uploading a visually weak proof would also damage the channel even if the official inbox route works, so the MP4 and cover must be reviewed first.

Rollback: keep TikTok posting manual/inbox-only. If an inbox upload creates a draft item, delete it manually in TikTok before posting.

Tests/build status: fresh dispatch pack and TikTok cover candidate tests passed locally. Final full validation passed: `npm test` `2045/2045`, `npm run build` pass.

Recommendation: do not approve live-account browser automation. Approve only a single official inbox upload test after reviewing `test/output/tiktok-fresh-dispatch/tiktok_fresh_dispatch_pack.md`, the MP4, the selected cover and `test/output/tiktok-cover-candidates/tiktok_cover_candidates_contact_sheet.jpg`.

## 3. Paid/External Voice Shootout

Decision needed: approve or reject a small capped external voice shootout using ElevenLabs/Fish or any other paid/external provider.

Why it matters: the local framework is ready and local Liam is available for safe benchmarking, but paid/external providers can spend credits or upload voice material outside the machine.

What changes: if approved later, run a capped batch against the fixed benchmark scripts in `voice_benchmark_manifest.json` and compare against local Liam using the blind review sheet.

Risk: paid credits may be spent and private/reference voice material could leave the machine if the wrong provider is used.

Rollback: do not switch production voice. Keep all generated samples under `test/output` and delete any rejected samples after review.

Tests/build status: voice shootout focused tests, full `npm test` and `npm run build` passed locally.

Recommendation: run local Liam first. Approve a paid/external shootout only after local Liam has been scored against the blind review sheet.

## 4. Longform Pilot

Decision needed: approve or reject a local-to-live weekly roundup pilot after reviewing the local dossier.

Why it matters: the longform dossier builder can now produce a Weekly Roundup outline with source pack, chapters, visual plan, SEO package and Shorts spin-offs. Publishing or scheduling that format would change live output strategy.

What changes: if approved later, one manually selected weekly roundup can be produced as a controlled longform pilot. No automatic cadence should be enabled at first.

Risk: longform needs stronger source checks and visual coverage than Shorts. A weak first longform can hurt credibility if dates, platforms or rumours are overstated.

Rollback: keep the longform tool local-only. If the pilot fails review, do not upload it and keep existing Shorts workflow unchanged.

Tests/build status: longform focused tests passed. Final full validation passed: `npm test` `2035/2035`, `npm run build` pass.

Recommendation: review `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md` first. Approve only a single manually reviewed Weekly Roundup pilot, not an automatic scheduler.

## 5. Monetisation Live Use

Decision needed: approve or reject promoting monetisation outputs into live public copy, sponsor outreach or stronger affiliate behaviour.

Why it matters: the monetisation readiness report is now useful, but it is deliberately report-only. Live affiliate or sponsor behaviour affects money, disclosure and audience trust.

What changes: if approved later, story-specific affiliate links and disclosure can be promoted more deliberately into public descriptions or pinned comments. Sponsor/media-kit outreach can also be prepared from real metrics.

Risk: random affiliate links, missing disclosures or premature sponsor claims would reduce trust. The current media-kit draft has missing analytics metrics and is not outreach-ready.

Rollback: keep monetisation reporting only. Revert any live copy changes and remove any non-specific affiliate links from public descriptions.

Tests/build status: monetisation focused tests passed. Final full validation passed: `npm test` `2035/2035`, `npm run build` pass.

Recommendation: allow report-only use now. Approve live affiliate promotion only after each story passes the affiliate targeting audit. Do not start sponsor outreach until real analytics fields are populated.
