# TikTok Overnight Automation Report

Generated: 2026-05-15T00:00:39.466Z
Mode: read-only-tiktok-automation-strategy
Verdict: GREEN
Recommended route: official_inbox_upload_prepare_only

## Token Gate
- source: auth_doctor
- token status mode: inspected
- ok: true
- reason: ok
- action: token_usable
- refresh available: true
- needs re-auth: false

## No-Post Readiness Gates
- Browser OAuth: not_verified_by_this_report; local token proven=true; local token status=usable
- Local token: usable; action=none; refresh_available=true; needs_reauth=false
- Official inbox: ready_for_operator_review_not_executed; ready_pack_present=true; public_auto_publish=false
- Direct post: blocked_by_app_review_or_direct_post_approval; blocker=direct_post_approval_not_declared
- Dispatch creative: blocked_by_creative_review; story=1szzhy9; blockers=studio_v2_promotion_red_blocked, forensic_warnings_remaining, visual_repeat_pairs_remaining, weak_rendered_frames_remaining, dispatch_pack_creative_review_required

## Dispatch Gate
- source: fresh_local_dispatch_pack
- packs: 1
- ready_for_operator_review: 1
- top pack: 1szzhy9 (creative_review_required, duration=74.67)
- top ready pack: rss_c27cd78d4621a058 (68.2s)
- older dispatch manifest warnings were not treated as blockers because the fresh local pack is newer:
  - ready_for_operator_review: 1

## Route Strategy
- Official TikTok inbox upload (official_inbox_upload): status=ready_for_operator_review_not_executed; public_auto_publish=false; account_risk=low
  Use this first after a pack is ready and a local token is usable. It uploads to TikTok inbox/drafts only; the operator completes the public post in TikTok.
- Official TikTok public API posting (official_public_api): status=blocked_until_tiktok_app_review_or_direct_post_approval; public_auto_publish=true; account_risk=low_after_approval
  Do not rely on this until TikTok app review/direct post approval is confirmed by a real API response.
- Manual phone workflow using dispatch pack (manual_phone_workflow): status=available; public_auto_publish=false; account_risk=very_low
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
- operator actions:
  - Use npm run tiktok:auth-link locally to generate the protected one-time auth link; direct /auth/tiktok is intentionally API-token protected.
  - After OAuth succeeds, keep public auto-posting disabled until TikTok app approval is confirmed; use inbox upload/manual completion as the safe bridge.

## Blockers
- none for report-only readiness

## Prepared Commands
Safe diagnostics:
- npm run tiktok:auth-doctor
- npm run tiktok:dispatch
- npm run tiktok:overnight-report
Safe dry-run:
- npm run tiktok:inbox-upload -- --story rss_c27cd78d4621a058
Requires approval before execution:
- npm run tiktok:inbox-upload -- --story rss_c27cd78d4621a058 --send-inbox

## Morning Approval Queue Entries
- Approve one TikTok official inbox upload test for rss_c27cd78d4621a058.
  Why: The dispatch pack is locally ready and the token gate reports usable, but sending to TikTok inbox still mutates the live TikTok account.
  Risk: The upload may create a draft/inbox item or hit an app/account-level API rejection.
  Rollback: Delete the TikTok inbox/draft item manually if it appears; no public post should be created by this route.
  Recommendation: Approve a single explicit inbox-upload test before any repeat use.
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
