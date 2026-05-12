# Morning Approval Queue

Generated: 2026-05-12

Only live-risk decisions are listed here. Safe local report edits and non-mutating checks do not need approval.

## 1. Studio V2 Pilot

Decision needed: keep blocked.

Current state: proof candidates are `0` render-ready, `20` need motion or exact assets and `1` reject. Local TTS doctor is green, but there are no render-ready Flash Lane proof candidates.

Risk: approving a live pilot now could push an unready public video.

Validation visible from current context: `npm test` passed `2417/2417`, build passed and local TTS doctor is green.

Recommendation: no. Do not approve Studio V2 pilot until at least one proof candidate has enough motion backbone/source diversity and has passed the existing visual, caption, frame and voice gates.

## 2. TikTok Token And Official Use Route

Decision needed: approve or defer operator-owned TikTok token refresh/sync and official route verification.

Current state: TikTok OAuth was recently connected in browser, but this repo's local token is expired and needs refresh/sync. The official API/inbox route is still token/creative-gated and public direct posting is not confirmed.

Risk: token sync, OAuth handling and official upload tests touch a live platform account even if public posting is not intended.

Rollback: do not mutate tokens and do not send any upload until a clean creative pack and explicit operator approval exist.

Recommendation: approve only a no-post token refresh/sync and dispatch-readiness check when Martin is present. Do not approve public TikTok posting or browser-cookie automation.

## 3. YouTube Analytics Read-Only

Decision needed: approve or defer read-only analytics access.

Current state: deeper analytics learning remains read-only/OAuth-gated. No YouTube OAuth action was run by this refresh.

Risk: OAuth handling touches a live YouTube account, even with read-only scope.

Rollback: continue using public counters and local history only.

Recommendation: approve only `yt-analytics.readonly` if retention and traffic-source learning is needed now. Do not approve upload, edit, delete or publish scopes as part of this decision.

## 4. Facebook Reels Normal Publisher Verification

Decision needed: decide whether to verify the normal Facebook Reels publisher path during local cutover.

Current state: a manual Facebook Reel proof worked and read-only Graph inspection now classifies Facebook Reels as `eligible_for_normal_publish`; the page can post, the page token is valid and `publish_video` is present.

Risk: live publisher verification can create platform-side objects or public posts if not kept tightly scoped.

Rollback: keep Facebook Reels manual-only and leave auto-publishing disabled.

Recommendation: once local posting is green, approve a controlled verification path with the strict verifier and Facebook Card fallback retained. Do not auto-enable broad posting from the manual proof alone.

## 5. Production Deployment Of Public-Output Changes

Decision needed: approve or defer production deployment.

Current state: this branch has proof-candidate, caption, frame QA and local TTS fallback-safety changes pushed, but no deployment.

Risk: deploying public-output changes can affect generated captions, proof selection, visible output and platform behaviour.

Rollback: keep the branch undeployed until the operator approves the production rollout.

Recommendation: defer production deployment until the current readiness gates are reviewed and the platform-specific live-risk decisions above are resolved.

## 6. Local Primary Cutover

Decision needed: approve or defer switching the PC/local stack into the live primary role.

Current state from local posting readiness on 2026-05-12: the local foundation is present but cutover is blocked by duplicate local control switches in `.env`, public `pulse.orryy.com` health not reaching local Pulse, a disconnected Cloudflare tunnel and mirror-mode flags (`PULSE_PRIMARY_INSTANCE=false`, `USE_JOB_QUEUE=false`, `AUTO_PUBLISH=false`). Railway should remain optional/standby, not the always-on publisher.

Read-only env cleanup plan: keep `AUTO_PUBLISH=false` on line 57 and `USE_JOB_QUEUE=false` on line 58; comment/remove stale duplicate lines 16 and 50. Do not edit secret values from this report.

Why it matters: the channel will not post consistently until one instance is primary. If Railway stays non-primary, the local PC must run scheduler, queue runner and uploads.

What changes: local `.env` would eventually need live-primary values (`DEPLOYMENT_MODE=local`, `PULSE_PRIMARY_INSTANCE=true`, `USE_JOB_QUEUE=true`, `AUTO_PUBLISH=true`) after local health, Cloudflare/public URL, OAuth callbacks, token paths, DB path and media paths pass readiness checks.

Risk: enabling local primary can upload to live social accounts. It also relies on the PC, local network, Cloudflare Tunnel/public URL and local storage staying online.

Rollback: set local `AUTO_PUBLISH=false` or `PULSE_PRIMARY_INSTANCE=false`, stop the local server/runner and leave Railway standby. Railway can later be restored as primary if monetisation justifies the cost.

Recommendation: prepare and test local-primary mode first, then approve a controlled local cutover. Keep ElevenLabs available only as a temporary bridge while local Liam TTS remains the target; do not make Railway primary again just to resume posting.
