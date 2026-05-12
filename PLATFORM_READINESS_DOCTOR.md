# Platform Readiness Doctor

Read-only diagnostic. It performs no OAuth, token mutation, uploads or posts.

Generated: 2026-05-12T21:14:37.808Z
Verdict: AMBER

## Blockers
- tiktok_local_token_refresh_or_sync_required
- tiktok_creative_review_required

## TikTok

- Status: needs_local_token_refresh_or_sync
- Official inbox route: creative_review_required_before_inbox
- Public direct post: blocked_until_tiktok_app_review_or_direct_post_approval
- Recommendation: refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload
- Ready pack: 1szzhy9 (duration unknown)

## Facebook Reels

- Status: enabled_verify_after_upload
- Reason: facebook_reels_enabled
- Manual proof observed: true
- Manual proof note: Manual Page UI Reel upload succeeded on 2026-05-12; treat Facebook Reels as externally possible, but keep automated Graph route under readiness checks.
- Verifier: requires ready status plus published/permalink evidence

## Instagram Reels

- Status: enabled_monitor_next_publish
- Last error category: no_recent_error
- Last error code: none
- URL fallback allowed: false
- Retry same MP4 recommended: false
- Next action: monitor_next_publish
- Fallback policy: do_not_resubmit_same_rejected_mp4

## Safety

- No OAuth triggered
- No token files changed
- No upload attempted
- No public post created
- No production DB rows changed
