# TikTok Overnight Automation Report

Generated: 2026-05-06T20:07:44.034Z
Mode: read-only-tiktok-automation-strategy
Verdict: AMBER
Recommended route: produce_or_select_fresh_60s_dispatch_pack

## Token Gate
- ok: true
- reason: ok
- action: token_usable
- refresh available: true
- needs re-auth: false

## Dispatch Gate
- packs: 86
- missing_video_and_cover: 2
- missing_video: 58
- stale_render_review_required: 26
- top pack: 1t0zhng (missing_video_and_cover, duration=unknown)

## Route Strategy
- Official TikTok inbox upload (official_inbox_upload): status=needs_ready_60s_dispatch_pack; public_auto_publish=false; account_risk=low
  Use this first after a pack is ready and a local token is usable. It uploads to TikTok inbox/drafts only; the operator completes the public post in TikTok.
- Official TikTok public API posting (official_public_api): status=blocked_until_tiktok_app_review_or_direct_post_approval; public_auto_publish=true; account_risk=low_after_approval
  Do not rely on this until TikTok app review/direct post approval is confirmed by a real API response.
- Manual phone workflow using dispatch pack (manual_phone_workflow): status=needs_ready_pack; public_auto_publish=false; account_risk=very_low
  Safest fallback today. Use when a human can complete the last TikTok app step.
- Audited third-party scheduler (third_party_scheduler): status=vendor_proof_required; public_auto_publish=true; account_risk=medium
  Only use after a vendor proves true TikTok auto-publish without account-risky browser automation.
- Browser automation (browser_automation): status=test_account_only; public_auto_publish=true; account_risk=high
  Never use on the live Pulse TikTok account without a separate explicit approval and test-account burn-in.
- Human VA posting (va_last_resort): status=last_resort; public_auto_publish=true; account_risk=operational_trust_risk
  Only consider after standardised dispatch packs, audit logs and access controls exist.

## Blockers
- missing_video_and_cover
- missing_video
- stale_render_review_required

## Prepared Commands
Safe diagnostics:
- npm run tiktok:auth-doctor
- npm run tiktok:dispatch
- npm run tiktok:overnight-report

## Morning Approval Queue Entries
- Do not approve live-account TikTok browser automation yet.
  Why: Browser automation is account-risky and not needed before the official inbox route is exhausted.
  Risk: Automated TikTok Studio access could trigger anti-abuse systems.
  Rollback: Use official inbox upload or manual phone workflow instead.
  Recommendation: If explored later, use a TikTok test account only.

## Safety
- no TikTok upload
- no OAuth flow triggered
- no token mutation
- no browser-cookie automation
- no production posting
