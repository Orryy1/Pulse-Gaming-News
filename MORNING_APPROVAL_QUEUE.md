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

## 6. Local Primary Cutover

Decision needed: approve or defer switching the PC/local stack into the live primary role.

Current state from Railway health on 2026-05-12: Railway is healthy but deliberately observation-only (`primary=false`, `USE_JOB_QUEUE=false`, `AUTO_PUBLISH=false`). This matches the cost-control goal: Railway should remain optional/standby, not the always-on publisher.

Why it matters: the channel will not post consistently until one instance is primary. If Railway stays non-primary, the local PC must run scheduler, queue runner and uploads.

What changes: local `.env` would eventually need live-primary values (`DEPLOYMENT_MODE=local`, `PULSE_PRIMARY_INSTANCE=true`, `USE_JOB_QUEUE=true`, `AUTO_PUBLISH=true`) after local health, Cloudflare/public URL, OAuth callbacks, token paths, DB path and media paths pass readiness checks.

Risk: enabling local primary can upload to live social accounts. It also relies on the PC, local network, Cloudflare Tunnel/public URL and local storage staying online.

Rollback: set local `AUTO_PUBLISH=false` or `PULSE_PRIMARY_INSTANCE=false`, stop the local server/runner and leave Railway standby. Railway can later be restored as primary if monetisation justifies the cost.

Recommendation: prepare and test local-primary mode first, then approve a controlled local cutover. Keep ElevenLabs available only as a temporary bridge while local Liam TTS is hardened; do not make Railway primary again just to resume posting.
