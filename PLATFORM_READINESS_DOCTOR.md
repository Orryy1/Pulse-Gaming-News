# Platform Readiness Doctor

Read-only diagnostic. It performs no OAuth, token mutation, uploads or posts.

Generated: 2026-05-08T04:30:54.329Z
Verdict: AMBER

## Blockers
- tiktok_local_token_refresh_or_sync_required
- tiktok_creative_review_required
- instagram_reel_rerender_required

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
- Manual proof note: manual_reel_upload_succeeded
- Verifier: requires ready status plus published/permalink evidence

## Instagram Reels

- Status: blocked_by_media_processing_rejection
- Last error category: media_processing_rejected
- Last error code: 2207076
- URL fallback allowed: false
- Retry same MP4 recommended: false
- Next action: rerender_mp4_codec_qa_required
- Fallback policy: do_not_resubmit_same_rejected_mp4

## Safety

- No OAuth triggered
- No token files changed
- No upload attempted
- No public post created
- No production DB rows changed
