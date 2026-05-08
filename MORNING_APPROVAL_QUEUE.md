# Morning Approval Queue

Generated: 2026-05-08

Only live-risk actions are listed here. Safe local tooling, report generation and tests were done automatically.

## 1. Do Not Pilot Studio V2 Yet

Decision needed: no approval requested yet.

Why it matters: the latest Studio V2 promotion packet remains `RED_BLOCKED`. Local Liam is no longer the main blocker. The blocker is visual quality: not enough validated motion, not enough clip dominance and remaining forensic/repetition risk.

What changes: nothing live. Legacy `assemble.js` stays canonical.

Risk: approving a pilot now could publish the same kind of dull, repetitive or weak-looking video Martin rejected.

Rollback: no action needed because no pilot was run.

Validation: focused modified-area tests passed `116/116`, full `npm test` passed `2193/2193`, build passed and proof candidates still show `0` ready Flash proofs.

Recommendation: do not approve a Studio V2 live pilot until a packet is green.

## 2. TikTok Local Token Refresh Or Sync

Decision needed: approve operator-owned token refresh/sync later.

Why it matters: earlier operator/browser OAuth was reported as successful on `pulse.orryy.com`, but this local repo's TikTok token store still reports expired. Official inbox upload cannot be tested locally until the local token gate is clear.

What changes: local TikTok token files would be refreshed or synced. Public auto-posting should remain disabled.

Risk: OAuth/token actions touch a live platform account.

Rollback: keep a token-file backup and do not upload until `npm run tiktok:auth-doctor` is green.

Validation: `npm run tiktok:auth-doctor` is `AMBER`, `npm run tiktok:token -- --dry-run` reports `dry_run_refresh_available`, no token mutation occurred.

Recommendation: do this with Martin present, then test only the official inbox/draft route with a clean current MP4.

## 3. TikTok Browser Automation

Decision needed: reject for the live Pulse account for now.

Why it matters: browser automation is account-risky and not needed before the official inbox/manual route is exhausted.

What changes: nothing if rejected. If explored later, it must be test-account only.

Risk: live-account automation could trigger TikTok anti-abuse systems.

Rollback: use official inbox upload or manual phone workflow.

Recommendation: do not approve live-account browser automation.

## 4. YouTube Analytics Read-Only Re-Auth

Decision needed: approve a YouTube OAuth re-auth for `yt-analytics.readonly`.

Why it matters: Pulse can see public counters, but it cannot deeply learn retention, audience drop-off and traffic sources without Creator Studio analytics scope.

What changes: YouTube token gains read-only analytics scope. It should not upload, edit, delete or publish anything.

Risk: OAuth/token handling touches a live platform account.

Rollback: do not re-auth and continue with public-counter learning only.

Validation: analytics doctor is `AMBER`; YouTube analytics packet is `BLOCKED` until scope is granted.

Recommendation: approve read-only analytics re-auth after this branch is safely merged.

## 5. Paid Or External Voice Shootout

Decision needed: approve a capped external benchmark only if local Liam is not enough.

Why it matters: local Liam is now good enough for proof work. External services may cost money or send voice material off-machine.

What changes: sample generation for external providers only, not a production voice switch.

Risk: credit spend and voice-material handling.

Rollback: keep production voice unchanged and delete rejected samples.

Recommendation: benchmark local Liam first. Delay external providers.

## 6. Longform Pilot

Decision needed: approve one manually reviewed Pulse Briefing Lane pilot later.

Why it matters: longform needs stronger sourcing, richer context and better visuals than Shorts.

What changes: one Weekly Roundup or similar manually approved pilot, not an automatic cadence.

Risk: unsupported facts or weak visual coverage would damage credibility.

Rollback: keep longform local-only.

Recommendation: review the longform dossier first, then approve one controlled pilot.

## 7. Monetisation Live Use

Decision needed: approve story-specific affiliate/sponsor usage only after targeting review.

Why it matters: monetisation output is useful, but random links or weak disclosure would harm trust.

What changes: affiliate links or sponsor language could enter public descriptions/pinned comments.

Risk: missing disclosure, irrelevant links or premature sponsor claims.

Rollback: keep monetisation report-only and remove any weak links from public copy.

Recommendation: keep report-only until analytics and affiliate targeting are stronger.
