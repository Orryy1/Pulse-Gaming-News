# Overnight Status Snapshot

Generated: 2026-05-12

## Branch

- Current branch: `codex/readiness-qa-failure-window`
- Latest visible pushed commit: `70df95d8 auto-commit: Codex session checkpoint`
- Branch state: aligned with `origin/codex/readiness-qa-failure-window` at the time of this refresh
- Current slice: platform readiness documentation refresh v1
- Deployed: no

## Safety

- Markdown reports only were targeted by this refresh.
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

- Full `npm test`: pass (`2351/2351`)
- `npm run build`: pass
- Local TTS doctor: green
- Proof candidate state: `0` render-ready / `16` `repair_voice_first` / `1` reject

## Local TTS

- Verdict: green
- Local TTS doctor is currently reported green.
- No production voice switch was made.
- Voice repair remains the dominant proof-candidate issue, with `16` candidates currently marked `repair_voice_first`.

## Studio V2 And Proof Candidates

- Studio V2 live pilot remains blocked.
- Current proof candidates: `0` render-ready, `16` `repair_voice_first`, `1` reject.
- The branch has new proof-candidate, caption and frame QA changes pushed.
- No production renderer switch or live pilot was triggered.

## TikTok

- TikTok OAuth was recently connected in browser.
- Local/live upload remains gated.
- The official API/inbox route is still token/creative-gated.
- No token mutation, inbox upload, draft upload, direct post or browser automation posting was run by this refresh.

## Facebook Reels

- Manual Facebook Reel test worked and has been observed as proof.
- The normal publisher path still needs readiness/verification before it can be counted as enabled.
- This manual proof does not auto-enable Facebook Reels in the scheduler or publisher path.

## YouTube Analytics

- Keep YouTube analytics read-only.
- Any re-auth for analytics scope remains a live-account OAuth decision.
- No YouTube upload, edit, deletion or OAuth action was run.

## Public Output And Deployment

- Public-output changes remain undeployed from this refresh.
- No Railway, Cloudflare, production DB or platform posting mutation occurred.
- Any production deployment of public-output changes remains an explicit operator approval item.

## Known Blockers

- Studio V2 has no render-ready proof candidates yet.
- TikTok needs an approved token/use route and clean creative pack before local official upload testing.
- Facebook Reels needs normal publisher verification before live enablement.
- YouTube analytics remains limited unless read-only analytics scope is approved.
- Production deployment of public-output changes remains approval-gated.
