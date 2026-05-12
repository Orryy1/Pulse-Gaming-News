# Morning Approval Queue

Generated: 2026-05-12

Only live-risk decisions are listed here. Safe local report edits and non-mutating checks do not need approval.

## 1. Studio V2 Pilot

Decision needed: keep blocked.

Current state: proof candidates are `0` render-ready, `16` `repair_voice_first` and `1` reject. Local TTS doctor is green, but there are no render-ready proof candidates.

Risk: approving a live pilot now could push an unready public video.

Validation visible from current context: `npm test` passed `2351/2351`, build passed and local TTS doctor is green.

Recommendation: no. Do not approve Studio V2 pilot until at least one proof candidate is render-ready and has passed the existing visual, caption, frame and voice gates.

## 2. TikTok Token And Official Use Route

Decision needed: approve or defer operator-owned TikTok token/use route work.

Current state: TikTok OAuth was recently connected in browser, but local/live upload remains gated. The official API/inbox route is still token/creative-gated.

Risk: token sync, OAuth handling and official upload tests touch a live platform account even if public posting is not intended.

Rollback: do not mutate tokens and do not send any upload until a clean creative pack and explicit operator approval exist.

Recommendation: defer unless Martin is present and the work is explicitly limited to token/use-route verification with no live posting.

## 3. YouTube Analytics Read-Only

Decision needed: approve or defer read-only analytics access.

Current state: deeper analytics learning remains read-only/OAuth-gated. No YouTube OAuth action was run by this refresh.

Risk: OAuth handling touches a live YouTube account, even with read-only scope.

Rollback: continue using public counters and local history only.

Recommendation: approve only `yt-analytics.readonly` if retention and traffic-source learning is needed now. Do not approve upload, edit, delete or publish scopes as part of this decision.

## 4. Facebook Reels Live Enable Or Verification

Decision needed: decide whether to verify or enable the normal Facebook Reels publisher path.

Current state: a manual Facebook Reel proof worked, but the code path still needs readiness/verification and the normal publisher path remains safety-gated.

Risk: live publisher verification can create platform-side objects or public posts if not kept tightly scoped.

Rollback: keep Facebook Reels manual-only and leave auto-publishing disabled.

Recommendation: do not auto-enable anything from the manual proof. Approve only a controlled verification path if needed, with explicit no-auto-post constraints.

## 5. Production Deployment Of Public-Output Changes

Decision needed: approve or defer production deployment.

Current state: this branch has proof-candidate, caption and frame QA changes pushed, but this documentation refresh made no code changes and no deployment.

Risk: deploying public-output changes can affect generated captions, proof selection, visible output and platform behaviour.

Rollback: keep the branch undeployed until the operator approves the production rollout.

Recommendation: defer production deployment until the current readiness gates are reviewed and the platform-specific live-risk decisions above are resolved.

## 6. Restore Live Autonomous Posting

Decision needed: approve or defer turning live autonomous posting back on.

Current state from Railway health on 2026-05-12: the app is healthy and deployed, but `autonomousMode=false`, `schedulerActive=false` and `auto_publish=false`. The read-only publish-readiness check is AMBER and says publish is possible, but the service is not currently configured to autonomously upload.

Why it matters: this is why the channel is not posting consistently even though ElevenLabs credits are available and the app itself is alive.

What changes: Railway would be restored to the live posting profile, using the existing legacy production renderer and ElevenLabs voice path. Studio V2 would stay off. TikTok public posting would still be treated as externally blocked unless TikTok approval/route status changes.

Risk: enabling autonomous posting can upload to live social accounts. If there is a bad candidate, the existing QA gates should block it, but this is still live platform behaviour.

Rollback: turn `AUTO_PUBLISH=false` and/or set the instance back to observation-only, then restart the Railway service. No database rollback should be needed for merely re-disabling posting.

Recommendation: approve a controlled restore of the legacy/ElevenLabs lane, not a Studio V2 switch. After restore, run publish-readiness first and watch the next publish window before touching TikTok or Studio V2.
