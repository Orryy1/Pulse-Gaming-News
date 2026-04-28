# TikTok Operator Checklist

Generated: 2026-04-28

## Current diagnosis

TikTok remains externally blocked for public Direct Post.

Evidence from local static diagnosis:

- uploader uses `FILE_UPLOAD`
- auth URL requests `video.publish` and `video.upload`
- privacy resolver supports TikTok's documented privacy levels
- browser fallback is gated
- pinned live error is `unaudited_client_can_only_post_to_private_accounts`

## Check in TikTok Developer Portal

- [ ] App is approved for Content Posting API Direct Post.
- [ ] `video.publish` is approved, not just requested.
- [ ] `video.upload` is approved, not just requested.
- [ ] Connected account is the intended Pulse Gaming account.
- [ ] The account has granted the expected scopes.
- [ ] `creator_info/query` returns `PUBLIC_TO_EVERYONE` as an allowed privacy level.
- [ ] Public posting is not blocked by app review status.
- [ ] App description is framed as a Pulse Gaming media publishing workflow, not a personal auto-poster.
- [ ] Privacy policy and terms pages are live and match the app use case.
- [ ] Demo/screenshots show original Pulse Gaming video publishing and no fake engagement.

## Safe diagnostic option

If the operator wants to prove the upload path without a public TikTok post, test only after explicit approval:

```text
TIKTOK_PRIVACY_LEVEL=SELF_ONLY
```

That should remain a controlled diagnostic. It is not a production publishing solution.

## Current route order

1. Official TikTok API approval route
2. Third-party scheduler with true auto-publish
3. Semi-automated phone approval workflow
4. Browser/RPA automation of TikTok Studio on a test account only
5. VA poster as last resort

## Do not do

- Do not switch back to `PULL_FROM_URL`.
- Do not trigger OAuth casually.
- Do not use browser cookies for live posting.
- Do not auto-post through unofficial automation.
- Do not treat TikTok code as the blocker unless new evidence contradicts the app-review diagnosis.

