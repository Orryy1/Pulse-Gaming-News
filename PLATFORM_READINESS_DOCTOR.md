# Platform Readiness Doctor

Read-only diagnostic. It performs no OAuth, token mutation, uploads or posts.

Generated: 2026-05-29T03:32:04.374Z
Verdict: AMBER

## Blockers
- tiktok_local_token_refresh_or_sync_required

## TikTok

- Status: needs_local_token_refresh_or_sync
- Official inbox route: prepared_not_executed
- Public direct post: blocked_until_tiktok_app_review_or_direct_post_approval
- Recommendation: refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload
- Ready pack: 1s4denn (75.9s)

### TikTok No-Post Readiness

- Browser OAuth: reported_success; local token proven=false; local token status=expired_but_refreshable
- Local token: expired_but_refreshable; action=refresh_or_sync_local_token
- Official inbox: needs_local_token_refresh_or_sync; public_auto_publish=false
- Direct post: blocked_by_app_review_or_direct_post_approval; blocker=direct_post_approval_not_declared
- Dispatch creative: ready_for_operator_review; story=1s4denn; blockers=none

## X

- Status: operator_disabled
- Reason: x_optional_disabled
- Public auto-publish: false
- Network calls allowed: false
- Operator switch: disabled
- Credentials: present; missing=0
- API billing: not_declared
- Direct post lane: blocked_until_enablement_complete
- Recommendation: keep_x_disabled_until_paid_api_and_credentials_are_confirmed

## Facebook Reels

- Status: enabled_verify_after_upload
- Reason: facebook_reels_enabled
- Manual proof observed: true
- Manual proof note: read_only_graph_eligibility_visible_reel_or_video_found
- Graph eligibility: eligible_for_normal_publish; reason=visible_graph_video_or_reel_found
- Graph evidence: visible_reel_or_video=true; token_valid=true; page_can_post=true
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
