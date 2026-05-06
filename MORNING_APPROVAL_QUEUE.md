# Morning Approval Queue

Generated: 2026-05-06

This queue contains only actions that would affect live risk, production defaults or platform accounts. Everything here should stay manual until Martin approves it in plain English.

## 1. One-Story Studio V2 Pilot

Decision needed: approve or reject a one-story Studio V2 pilot candidate for `1szzhy9`.

Why it matters: the latest local proof is the first one that has approved local Liam narration, 60+ second runtime, motion-backed official trailer references, green QA and zero forensic fails. It is still not a production default.

What changes: if approved later, one manually selected story may be rendered through Studio V2 for a controlled pilot. The production renderer must not be switched globally.

Risk: the proof still has forensic warnings and needs human visual review. A pilot could look worse than the legacy renderer if clip taste or pacing does not match the channel.

Rollback: keep legacy `assemble.js` as canonical. If the pilot fails visual review or upload QA, publish using the existing legacy path and do not set any Studio V2 production flag.

Tests/build status: `node --test tests\services\studio-v2-promotion-packet.test.js` passed. Full suite/build status will be refreshed in the final overnight handoff.

Recommendation: review `STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md`, the MP4 and the contact sheet in the morning. Do not approve a global Studio V2 switch.

## 2. TikTok Route Discipline

Decision needed: keep live-account TikTok browser automation blocked and use only the official inbox route or manual phone workflow until a proper ready dispatch pack exists.

Why it matters: the local TikTok token now reports usable, but the overnight dispatch gate found no current pack ready for TikTok. Existing candidates are missing media or stale, so uploading them would waste the newly restored route.

What changes: no live TikTok upload should run yet. The next safe step is to produce a fresh 60+ second pack with approved voice, current MP4, cover, caption and token gate clear, then approve a single official inbox upload test.

Risk: live-account browser automation can trigger account-risk systems. Uploading stale or poor media would also damage the channel even if the API route works.

Rollback: keep TikTok posting manual/inbox-only. If a future inbox upload creates a draft item, delete it manually in TikTok before posting.

Tests/build status: TikTok dispatch and automation report tests passed locally. Full suite/build status will be refreshed in the final overnight handoff.

Recommendation: do not approve live-account browser automation. Approve only a single official inbox upload test after a fresh dispatch pack reaches `ready_for_operator_review`.
