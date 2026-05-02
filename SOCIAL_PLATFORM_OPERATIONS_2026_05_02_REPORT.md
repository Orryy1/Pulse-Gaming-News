# Social Platform Operations - 2026-05-02

## What Changed

- Added `npm run ops:social-platforms`.
- Added `lib/ops/social-platform-operations.js`.
- Extended TikTok dispatch packs with an official inbox-upload route descriptor.
- Added `upload_tiktok.js::buildInboxUploadInitRequest()` and `uploadVideoToInbox()` as a non-production-wired route.

## Current Verdict

AMBER.

Working:
- YouTube upload path.
- Instagram Reel path.
- Facebook Reels API path, proven live by approved Graph probe on 2026-05-02.
- Facebook Card/Story fallback.

Blocked or gated:
- TikTok public direct post: external app-review/audit gate.
- X/Twitter: intentionally disabled.

## Facebook Reels Evidence

Graph/API evidence:
- Page is published.
- Page can post.
- Token is valid.
- Token has `publish_video`.
- `/videos`: 2.
- `/video_reels`: 2.
- `/posts`: 7.
- Page followers: 0.
- Page fans: 0.
- Page verified: false.
- Approved live API probe created Reel `1345999384246992` and verified `/reel/1345999384246992/` after 3 polls.
- Local `.env` now has `FACEBOOK_REELS_ENABLED=true`.
- Local server was restarted on port 3001 so the patched uploader is loaded.

Recommendation:
- Keep Facebook Reels enabled locally.
- Let the next normal publish window attempt FB Reel first, with FB Card fallback still active.
- Do not change Railway variables from this local proof alone.
- Keep the post-publish verifier strict: Graph `success:true` is not enough unless a public permalink appears.

## TikTok Route Ladder

1. Audited third-party scheduler with true TikTok auto-publish.
2. Official TikTok inbox upload/draft route, requiring operator completion.
3. Pulse phone dispatch pack.
4. Browser/RPA only on a test account, not the main Pulse account.
5. VA/manual posting as last resort.

The code now models the official inbox route as public-auto-publish=false and manual-completion=true. It is not wired into normal publishing.

## Safety

- One approved external Facebook Reel API probe was made.
- No OAuth triggered.
- No Railway env changes.
- No production DB mutation.
- No browser automation.
- No production route switched.

## Validation

- `node --test tests/services/facebook-reel-verify.test.js tests/services/facebook-reels-eligibility.test.js tests/services/enterprise-ops.test.js`: 33/33 pass.
- `npm test`: 1797/1797 pass.
- `npm run build`: pass.
- `npm run ops:social-platforms`: AMBER report generated.
- `npm run ops:publish-readiness`: AMBER, publish possible with advisories.
- `curl https://pulse.orryy.com/api/health`: OK, mode local, primary true, scheduler active.

## Outputs

- `test/output/social_platform_operations.md`
- `test/output/social_platform_operations.json`
- `test/output/facebook_reels_eligibility.md`
- `test/output/tiktok_dispatch_manifest.md`
- `test/output/tiktok_403_diagnosis.md`

## Next Practical Actions

1. Pick and test an audited scheduler that truly auto-publishes TikToks to the connected account.
2. Fix TikTok developer-dashboard/client-key blocker; the generated Pulse URL uses the documented comma-separated scope format, so the remaining issue is likely app environment/status/domain/app-key configuration.
3. Add an operator-only TikTok inbox upload command after re-auth is healthy.
4. Keep browser automation off the main account.
