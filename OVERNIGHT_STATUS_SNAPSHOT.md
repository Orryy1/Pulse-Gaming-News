# Overnight Status Snapshot

Generated: 2026-05-12

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest pushed commit: `1baa1ab0 Add local TTS fallback readiness regression`
- Branch state: aligned with `origin/codex/readiness-qa-failure-window`
- Current slice: local posting readiness and Studio V2 proof repair
- Deployed: no

## Safety

- Safe local/reporting work only.
- `.env`: untouched
- Tokens/OAuth files: untouched
- Railway env vars: untouched
- Cloudflare/DNS: untouched
- Production DB rows: untouched
- Social posting: none
- Scheduler frequency: unchanged
- Production renderer defaults: unchanged
- Production voice defaults: unchanged
- TikTok upload/API actions: not run
- Facebook/Instagram/YouTube live actions: not run

## Validation Visible From Current Context

- Full `npm test`: pass (`2417/2417`)
- `npm run build`: pass
- Local TTS doctor: green
- Proof candidate state: `0` render-ready / `20` needs motion or exact assets / `1` reject

## Local TTS

- Verdict: green
- Local TTS doctor reports the accepted Liam/Pulse voice is loaded.
- No production voice switch was made.
- The bad/demonic local voice fallback now fails closed instead of producing public-risk audio.
- Current proof batch has `6` Liam voice-ready stories; remaining proof-candidate blockers are mostly motion/source-diversity rather than voice.

## Studio V2 And Proof Candidates

- Studio V2 live pilot remains blocked.
- Current proof candidates: `0` render-ready, `20` need motion or exact assets and `1` reject.
- The branch has proof-candidate, caption, frame QA and local TTS fallback-safety changes pushed.
- `1t0zhng` now has accepted Liam audio and exact-subject coverage repaired; it still lacks the required motion backbone/source diversity for Flash Lane proof.
- No production renderer switch or live pilot was triggered.

## TikTok

- TikTok OAuth was recently connected in browser.
- Local/live upload remains gated because this repo's token is expired and requires refresh/sync.
- The official API/inbox route is still token/creative-gated.
- No token mutation, inbox upload, draft upload, direct post or browser automation posting was run by this refresh.

## Facebook Reels

- Manual Facebook Reel test worked.
- Read-only Graph inspection now classifies Facebook Reels as `eligible_for_normal_publish`.
- This does not auto-enable scheduler posting; it means Facebook Reels can be included in a controlled local publisher verification once local posting is green.

## YouTube Analytics

- Keep YouTube analytics read-only.
- Any re-auth for analytics scope remains a live-account OAuth decision.
- No YouTube upload, edit, deletion or OAuth action was run.

## Public Output And Deployment

- Public-output changes remain undeployed.
- No Railway, Cloudflare, production DB or platform posting mutation occurred.
- Any production deployment of public-output changes remains an explicit operator approval item.

## Known Blockers

- Local posting is cutover-blocked: duplicate `.env` control switches, disconnected Cloudflare tunnel/public health and mirror-mode flags.
- `LOCAL_ENV_CLEANUP_PLAN.md` now gives the exact non-secret duplicate line cleanup plan for the local switches.
- Studio V2 has no render-ready Flash Lane proof candidates yet because motion/source-diversity is still thin.
- TikTok needs local token refresh/sync and a clean creative pack before official upload testing.
- Facebook Reels is eligible but still needs controlled verification in the normal publisher path.
- YouTube analytics remains limited unless read-only analytics scope is approved.
- Production deployment of public-output changes remains approval-gated.
