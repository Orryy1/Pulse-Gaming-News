# Morning Approval Queue

Generated: 2026-05-07

This queue contains only actions that would affect live risk, production defaults or platform accounts. Safe local tooling and reporting has already been done where possible.

## 1. Studio V2 Pilot Remains Blocked

Decision needed: no live Studio V2 pilot is requested yet.

Why it matters: the latest promotion packet classifies `1szzhy9` as `RED_BLOCKED`. Local Liam narration is now acceptable, but the visual proof still has forensic warnings, repeated visual pairs, weak rendered frames and no current validated clip-source diversity.

What changes: nothing live. Studio V2 stays local-only and legacy `assemble.js` remains the canonical production renderer.

Risk: approving a pilot now could put repetitive, low-information or weak-looking frames in front of the audience, which is exactly the problem Martin flagged in the reviewed enriched MP4.

Rollback: no live action was taken. Keep the production renderer unchanged.

Validation status: focused Studio V2 and motion reports regenerated. The latest resumed segment scan checked `100` merged windows for `rss_5b3abe925b27a199`; only `2` BioShock windows validated. GTA now has `51` failed official-window attempts and Red Dead has `22`, so both are classified as `alternate_source_required`. Focused TikTok, voice, longform and monetisation tests passed. Full `npm test` passed `2125/2125` and `npm run build` passed.

Recommendation: do not approve a Studio V2 live pilot yet. Next safe work is stronger motion acquisition and render selection until the promotion packet is clean.

## 2. TikTok Route Discipline

Decision needed: no TikTok inbox upload or public post is requested from the current pack.

Why it matters: the TikTok token now reports usable and refreshable, but the current best fresh pack is still blocked by creative review because Studio V2 is blocked. The auth doctor no longer carries the stale dashboard client-key warning after a usable token.

What changes: nothing live. TikTok remains prepared for official inbox/manual workflow once a clean 60s pack exists.

Risk: uploading a visually weak proof would damage the channel. Live browser automation also remains account-risky and should not be used on the Pulse account.

Rollback: no TikTok upload was performed. Keep public auto-posting disabled.

Validation status: TikTok focused tests passed, including the regression that suppresses stale dashboard warnings after a usable token. Full `npm test` passed `2125/2125` and `npm run build` passed.

Recommendation: use official inbox/manual workflow only after a clean MP4, cover, caption and voice proof pass review. Do not approve live-account browser automation.

## 3. Paid Or External Voice Shootout

Decision needed: approve or reject a small capped external voice shootout later.

Why it matters: local Liam is now the accepted local proof voice, and the shootout framework is ready. Paid/external providers may spend credits or send reference material outside the machine.

What changes: if approved later, run a capped benchmark against `voice_benchmark_manifest.json` and compare samples with the blind review sheet.

Risk: credit spend and voice-material handling.

Rollback: do not switch production voice. Keep samples under `test/output` and delete rejected local proofs after review.

Validation status: voice shootout focused tests passed. Full `npm test` passed `2125/2125` and `npm run build` passed.

Recommendation: benchmark local Liam first. Delay external providers until there is a clear reason.

## 4. Longform Pilot

Decision needed: approve or reject one manually reviewed longform pilot later.

Why it matters: the longform dossier builder can produce a Weekly Roundup outline with source pack, chapter plan, visual plan, SEO package and Shorts spin-offs. Uploading or scheduling longform changes the live content strategy.

What changes: if approved later, produce one manually selected Weekly Roundup as a controlled Pulse Briefing Lane pilot.

Risk: longform requires stronger sourcing and visual coverage than Shorts.

Rollback: keep the longform tooling local-only and do not upload if the outline fails editorial review.

Validation status: longform focused tests passed. Full `npm test` passed `2125/2125` and `npm run build` passed.

Recommendation: review `LONGFORM_OVERNIGHT_ARCHITECTURE_REPORT.md`, then approve only one manual pilot, not an automatic cadence.

## 5. Monetisation Live Use

Decision needed: approve or reject promoting monetisation outputs into public copy, sponsor outreach or affiliate behaviour.

Why it matters: the monetisation tracker is useful, but it is deliberately report-only. Live affiliate and sponsor behaviour affects disclosure, trust and platform policy.

What changes: if approved later, story-specific affiliate links and disclosure can be promoted into public descriptions or pinned comments.

Risk: random affiliate links, missing disclosures and premature sponsor claims.

Rollback: keep monetisation report-only and remove any non-specific links from public copy.

Validation status: monetisation focused tests passed and report output preserves accented game names correctly. Full `npm test` passed `2125/2125` and `npm run build` passed.

Recommendation: allow report-only use now. Approve live affiliate promotion only story by story after the targeting audit passes.

## 6. YouTube Analytics Read-Only Re-Auth

Decision needed: approve a YouTube OAuth re-auth for detailed analytics read access.

Why it matters: Pulse has a learning loop, but the analytics doctor shows it is currently using public counters/local history rather than full YouTube Studio retention and traffic-source data. The system cannot deeply learn what keeps people watching until `yt-analytics.readonly` is granted.

What changes: the YouTube token would gain read-only Creator Studio analytics access. It should not upload, edit, delete or publish anything.

Risk: OAuth/token handling touches a live platform account, so it must not be triggered silently and token values must never be logged.

Rollback: do not re-auth. Continue using public-counter learning only.

Validation status: `npm run ops:analytics-doctor` reports `AMBER`, `requires_youtube_scope_reauth`, `public_counter_history_only`, `330` platform metric rows, `0` rich retention rows and `0` video performance rows. `npm run ops:youtube-analytics-packet` now plans retention and traffic-source ingestion but blocks safely until re-auth. Learning, comment-digest and YouTube analytics packet tests pass.

Recommendation: approve read-only analytics re-auth after the current local/reporting work is safely committed and pushed.
