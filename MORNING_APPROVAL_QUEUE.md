# Morning Approval Queue

Generated: 2026-05-07

This queue contains only actions that would affect live risk, production defaults or platform accounts. Everything here should stay manual until Martin approves it in plain English.

## 1. Studio V2 Pilot Is Blocked For Now

Decision needed: no live pilot approval is requested yet.

Why it matters: the stricter promotion gate now treats remaining forensic warnings, repeated visual pairs and weak rendered frames as pilot blockers. This matches the quality bar for Pulse Flash Lane: a proof that still has repeated-looking scenes or low-information frames should not be treated as ready just because runtime, narration and basic QA pass.

What changes: nothing changes live. The current proof for `1szzhy9` is now classified as `RED_BLOCKED`, not `AMBER_LOCAL_PROOF`, so it should stay out of any live Studio V2 pilot queue.

Risk: if this gate were ignored, Studio V2 could still produce Shorts that look repetitive, dark, washed out or less polished than a serious gaming TikTok channel. The current blockers are `forensic_warnings_remaining`, `visual_repeat_pairs_remaining` and `weak_rendered_frames_remaining`.

Rollback: no live action was taken. Keep legacy `assemble.js` as canonical and keep Studio V2 local-only until a clean packet is regenerated.

Tests/build status: focused Studio V2 promotion and motion gap tests passed. Latest full validation passed: `npm test` `2072/2072`, `npm run build` pass.

Recommendation: do not approve a Studio V2 live pilot yet. Next safe work is to improve motion acquisition and render selection until `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md` is clean with zero forensic warnings, zero repeated visual pairs and zero weak rendered frames.

## 2. TikTok Route Discipline

Decision needed: approve or reject one official TikTok inbox upload test from the fresh local dispatch pack.

Why it matters: the local TikTok token now reports usable and a fresh local dry-run dispatch pack exists for `1szzhy9`, with 74.67s runtime, approved local Liam voice evidence, cover, caption and stale-render checks. It still needs human visual review before any live upload.

What changes: if approved later, run one explicit official inbox upload command for the selected MP4 only. This sends a TikTok inbox/draft item for manual completion; it must not create a public post automatically.

Risk: live-account browser automation can trigger account-risk systems and remains blocked. Uploading a visually weak proof would also damage the channel even if the official inbox route works, so the MP4 and cover must be reviewed first.

Rollback: keep TikTok posting manual/inbox-only. If an inbox upload creates a draft item, delete it manually in TikTok before posting.

Tests/build status: TikTok automation report now prefers the fresh local dry-run dispatch pack and keeps dashboard/auth warnings visible. Final full validation passed: `npm test` `2062/2062`, `npm run build` pass.

Recommendation: do not approve live-account browser automation. Approve only a single official inbox upload test after reviewing `test/output/tiktok-fresh-dispatch/tiktok_fresh_dispatch_pack.md`, the MP4, the selected cover and `test/output/tiktok-cover-candidates/tiktok_cover_candidates_contact_sheet.jpg`.

## 3. Paid/External Voice Shootout

Decision needed: approve or reject a small capped external voice shootout using ElevenLabs/Fish or any other paid/external provider.

Why it matters: the local framework is ready and local Liam is available for safe benchmarking, but paid/external providers can spend credits or upload voice material outside the machine.

What changes: if approved later, run a capped batch against the fixed benchmark scripts in `voice_benchmark_manifest.json` and compare against local Liam using the blind review sheet.

Risk: paid credits may be spent and private/reference voice material could leave the machine if the wrong provider is used.

Rollback: do not switch production voice. Keep all generated samples under `test/output` and delete any rejected samples after review.

Tests/build status: voice shootout focused tests passed. Final full validation passed: `npm test` `2062/2062`, `npm run build` pass.

Recommendation: run local Liam first. Approve a paid/external shootout only after local Liam has been scored against the blind review sheet.

## 4. Longform Pilot

Decision needed: approve or reject a local-to-live weekly roundup pilot after reviewing the local dossier.

Why it matters: the longform dossier builder can now produce a Weekly Roundup outline with source pack, chapters, visual plan, SEO package and Shorts spin-offs. Publishing or scheduling that format would change live output strategy.

What changes: if approved later, one manually selected weekly roundup can be produced as a controlled longform pilot. No automatic cadence should be enabled at first.

Risk: longform needs stronger source checks and visual coverage than Shorts. A weak first longform can hurt credibility if dates, platforms or rumours are overstated.

Rollback: keep the longform tool local-only. If the pilot fails review, do not upload it and keep existing Shorts workflow unchanged.

Tests/build status: longform focused tests now pin the Flash Lane vs Briefing Lane split. Final full validation passed: `npm test` `2062/2062`, `npm run build` pass.

Recommendation: review `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md` first. Approve only a single manually reviewed Weekly Roundup pilot, not an automatic scheduler.

## 5. Monetisation Live Use

Decision needed: approve or reject promoting monetisation outputs into live public copy, sponsor outreach or stronger affiliate behaviour.

Why it matters: the monetisation readiness report is now useful, but it is deliberately report-only. Live affiliate or sponsor behaviour affects money, disclosure and audience trust.

What changes: if approved later, story-specific affiliate links and disclosure can be promoted more deliberately into public descriptions or pinned comments. Sponsor/media-kit outreach can also be prepared from real metrics.

Risk: random affiliate links, missing disclosures or premature sponsor claims would reduce trust. The current media-kit draft has missing analytics metrics and is not outreach-ready.

Rollback: keep monetisation reporting only. Revert any live copy changes and remove any non-specific affiliate links from public descriptions.

Tests/build status: monetisation focused tests now pin encoding-clean report output and Pokémon spelling. Final full validation passed: `npm test` `2062/2062`, `npm run build` pass.

Recommendation: allow report-only use now. Approve live affiliate promotion only after each story passes the affiliate targeting audit. Do not start sponsor outreach until real analytics fields are populated.
