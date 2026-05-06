# Morning Approval Queue

Generated: 2026-05-06

This queue contains only actions that would affect live risk, production defaults or platform accounts. Everything here should stay manual until Martin approves it in plain English.

## 1. One-Story Studio V2 Pilot

Decision needed: approve or reject a one-story Studio V2 pilot candidate for `1szzhy9`.

Why it matters: the latest local proof is the first one that has approved local Liam narration, 60+ second runtime, motion-backed official trailer references, green QA and zero forensic fails. It is still not a production default.

What changes: if approved later, one manually selected story may be rendered through Studio V2 for a controlled pilot. The production renderer must not be switched globally.

Risk: the proof still has forensic warnings and needs human visual review. A pilot could look worse than the legacy renderer if clip taste or pacing does not match the channel.

Rollback: keep legacy `assemble.js` as canonical. If the pilot fails visual review or upload QA, publish using the existing legacy path and do not set any Studio V2 production flag.

Tests/build status: focused Studio V2 promotion tests passed. Final full validation passed: `npm test` `2035/2035`, `npm run build` pass.

Recommendation: review `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`, the MP4 and the contact sheet in the morning. Do not approve a global Studio V2 switch.

## 2. TikTok Route Discipline

Decision needed: keep live-account TikTok browser automation blocked and use only the official inbox route or manual phone workflow until a proper ready dispatch pack exists.

Why it matters: the local TikTok token now reports usable, but the overnight dispatch gate found no current pack ready for TikTok. Existing candidates are missing media or stale, so uploading them would waste the newly restored route.

What changes: no live TikTok upload should run yet. The next safe step is to produce a fresh 60+ second pack with approved voice, current MP4, cover, caption and token gate clear, then approve a single official inbox upload test.

Risk: live-account browser automation can trigger account-risk systems. Uploading stale or poor media would also damage the channel even if the API route works.

Rollback: keep TikTok posting manual/inbox-only. If a future inbox upload creates a draft item, delete it manually in TikTok before posting.

Tests/build status: TikTok dispatch and automation report tests passed locally. Final full validation passed: `npm test` `2035/2035`, `npm run build` pass.

Recommendation: do not approve live-account browser automation. Approve only a single official inbox upload test after a fresh dispatch pack reaches `ready_for_operator_review`.

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
