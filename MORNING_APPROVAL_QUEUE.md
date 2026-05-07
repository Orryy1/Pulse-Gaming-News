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

Decision needed: no TikTok inbox upload approval is requested for the current fresh pack.

Why it matters: the local TikTok token reports usable, but the current fresh dispatch pack is tied to the blocked Studio V2 proof for `1szzhy9`. It now inherits the same creative blockers: `studio_v2_promotion_red_blocked`, `forensic_warnings_remaining`, `visual_repeat_pairs_remaining` and `weak_rendered_frames_remaining`.

What changes: nothing live. TikTok remains available as a route once there is a clean 60s pack, but the current pack should not be uploaded to inbox/drafts.

Risk: uploading a visually weak proof would damage the channel even if the official inbox route works. Live-account browser automation can also trigger account-risk systems and remains blocked.

Rollback: no live action was taken. Keep TikTok posting manual/inbox-only and do not create an inbox draft from this MP4.

Tests/build status: TikTok fresh-pack and automation report tests pass. Latest full validation passed: `npm test` `2074/2074`, `npm run build` pass.

Recommendation: do not approve live-account browser automation. Do not approve an inbox upload from the current `1szzhy9` pack. Generate a new fresh TikTok dispatch pack only after Studio V2 produces a clean proof or after a stronger legacy/current MP4 passes the same visual and voice gates.

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
