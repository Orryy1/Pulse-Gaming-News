# TikTok Overnight Automation Report

Generated: 2026-05-07T03:25:31.143Z
Mode: read-only-tiktok-automation-strategy
Verdict: AMBER
Recommended route: fix_fresh_dispatch_creative_blockers

## Token Gate
- ok: true
- reason: ok
- action: token_usable
- refresh available: true
- needs re-auth: false

## Dispatch Gate
- source: fresh_local_dispatch_pack
- packs: 86
- missing_video_and_cover: 2
- missing_video: 58
- stale_render_review_required: 26
- top pack: 1szzhy9 (creative_review_required, duration=74.67)
- older dispatch manifest warnings were not treated as blockers because the fresh local pack is newer:
  - missing_video_and_cover: 2
  - missing_video: 58
  - stale_render_review_required: 26

## Route Strategy
- Official TikTok inbox upload (official_inbox_upload): status=blocked_by_creative_review; public_auto_publish=false; account_risk=low
  Use this first after a pack is ready and a local token is usable. It uploads to TikTok inbox/drafts only; the operator completes the public post in TikTok.
- Official TikTok public API posting (official_public_api): status=blocked_until_tiktok_app_review_or_direct_post_approval; public_auto_publish=true; account_risk=low_after_approval
  Do not rely on this until TikTok app review/direct post approval is confirmed by a real API response.
- Manual phone workflow using dispatch pack (manual_phone_workflow): status=blocked_by_creative_review; public_auto_publish=false; account_risk=very_low
  Safest fallback today. Use when a human can complete the last TikTok app step.
- Audited third-party scheduler (third_party_scheduler): status=vendor_proof_required; public_auto_publish=true; account_risk=medium
  Only use after a vendor proves true TikTok auto-publish without account-risky browser automation.
- Browser automation (browser_automation): status=test_account_only; public_auto_publish=true; account_risk=high
  Never use on the live Pulse TikTok account without a separate explicit approval and test-account burn-in.
- Human VA posting (va_last_resort): status=last_resort; public_auto_publish=true; account_risk=operational_trust_risk
  Only consider after standardised dispatch packs, audit logs and access controls exist.

## Diagnostics
- auth doctor verdict: AMBER
- warnings:
  - direct_public_post_not_approved_or_not_declared
  - dashboard_client_key_error_requires_operator_dashboard_fix
- operator actions:
  - Verify the same TikTok app/environment owns the dashboard client key, Login Kit product, Content Posting API product, URL properties and redirect URI.
  - Confirm the TikTok dashboard redirect URI exactly matches https://pulse.orryy.com/auth/tiktok/callback.
  - If the app is still Draft/Staging, use Sandbox mode with your TikTok account added as a target user, or submit the Production app for review before expecting Production OAuth to work.
  - Confirm you are using the Production app client key for a reviewed/live Production OAuth flow, or the Sandbox client key for a Sandbox target-user OAuth flow.
  - Use npm run tiktok:auth-link locally to generate the protected one-time auth link; direct /auth/tiktok is intentionally API-token protected.
  - If TikTok still reports client_key after exact dashboard values, the app/dashboard state is being rejected before OAuth; save the app again or raise it with TikTok support.
  - After OAuth succeeds, keep public auto-posting disabled until TikTok app approval is confirmed; use inbox upload/manual completion as the safe bridge.

## Blockers
- studio_v2_promotion_red_blocked
- forensic_warnings_remaining
- visual_repeat_pairs_remaining
- weak_rendered_frames_remaining
- dispatch_pack_creative_review_required
- creative_review_required

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
