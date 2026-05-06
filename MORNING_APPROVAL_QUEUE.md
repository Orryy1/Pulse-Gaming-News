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
