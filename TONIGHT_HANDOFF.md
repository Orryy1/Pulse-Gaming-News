# Tonight Handoff

Date: 2026-05-12

## Branch

- Branch: `codex/readiness-qa-failure-window`
- Latest pushed commit: `1baa1ab0 Add local TTS fallback readiness regression`
- Branch state: aligned with `origin/codex/readiness-qa-failure-window`
- Current slice: local posting readiness and Studio V2 proof repair
- Deployed: no
- Railway/env/Cloudflare/OAuth/production DB/social posting: untouched
- Production renderer and production voice defaults: unchanged

## Current Operator Summary

- Local TTS is green with the accepted Liam/Pulse voice loaded.
- The bad/demonic local voice fallback now fails closed instead of silently producing bad audio.
- Full `npm test`: pass (`2417/2417`).
- `npm run build`: pass.
- Studio V2 proof candidates: `0` render-ready, `20` need motion or exact asset work and `1` reject.
- `1t0zhng` now has accepted Liam audio and corrected exact-subject coverage, but still needs more motion/source diversity before a Flash Lane proof.
- Facebook Reels is now graph-eligible from read-only inspection: a visible Reel/video exists, the page can post and the token has `publish_video`.
- TikTok browser OAuth succeeded, but this repo's local TikTok token is expired and needs refresh/sync before official upload testing.
- Local posting is cutover-blocked, not code-blocked: the duplicate local control keys have been cleaned locally, and the remaining blockers are the disconnected Cloudflare tunnel/public health plus mirror-mode flags.
- `LOCAL_TUNNEL_READINESS.md` confirms `cloudflared` is installed, the Pulse tunnel config and credentials are present, and `pulse.orryy.com` routes to `http://localhost:3001`; the tunnel simply has no active connection.

## Platform Readiness

- TikTok: browser-connected, but official upload use is blocked until the local token is refreshed/synced and a clean creative pack is selected. Public auto-posting remains blocked by app approval/direct-post uncertainty.
- Facebook Reels: eligible for controlled normal-publisher verification once local posting is green, with strict verifier and Facebook Card fallback retained.
- YouTube analytics: keep read-only only; any OAuth re-auth for analytics scope remains an operator decision.
- Instagram/Facebook/TikTok normal publishing: still gated by existing platform safety controls.
- Railway: standby/optional only for cost control.

## Reports To Read

- `LOCAL_POSTING_READINESS.md`
- `LOCAL_ENV_CLEANUP_PLAN.md`
- `LOCAL_TUNNEL_READINESS.md`
- `LOCAL_TTS_OVERNIGHT_REPORT.md`
- `OVERNIGHT_STATUS_SNAPSHOT.md`
- `MORNING_APPROVAL_QUEUE.md`
- `PLATFORM_READINESS_DOCTOR.md`
- `FACEBOOK_REELS_STATUS.md`
- `TIKTOK_OPERATOR_CHECKLIST.md`

## Biggest Remaining Blocker

The project is close to local posting, but the live route is blocked by cutover operations: Cloudflare tunnel/public health and local primary/queue/auto-publish flags. TikTok also needs local token refresh/sync before official upload tests.

## Recommended Next Work

1. Start the existing Cloudflare tunnel only in a controlled cutover window, then verify public health still reports local/mirror mode.
2. Keep Studio V2 pilot blocked until a candidate has enough motion backbone and source diversity.
3. Refresh/sync TikTok local token only under explicit no-post constraints, then test dispatch pack readiness without posting.
4. Treat Facebook Reels as ready for controlled normal-publisher verification once local posting is green.
5. Keep Railway standby-only; do not restore it as primary just to resume posting.
