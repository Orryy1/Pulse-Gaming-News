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
- Facebook Card/Story fallback.

Blocked or gated:
- TikTok public direct post: external app-review/audit gate.
- Facebook Reels: Page/Reels eligibility or visibility gate.
- X/Twitter: intentionally disabled.

## Facebook Reels Evidence

Read-only Graph probe:
- Page is published.
- Page can post.
- Token is valid.
- Token has `publish_video`.
- `/videos`: 0.
- `/video_reels`: 0.
- `/posts`: 5.
- Page followers: 0.
- Page fans: 0.
- Page verified: false.

Recommendation:
- Keep `FACEBOOK_REELS_ENABLED=false`.
- Run one manual Meta Business Suite/Page UI Reel test with a known-good MP4.
- Re-run `npm run facebook:reels:eligibility`.
- Only consider a controlled Graph API Reel probe once Graph shows a visible video/Reel surface.

## TikTok Route Ladder

1. Audited third-party scheduler with true TikTok auto-publish.
2. Official TikTok inbox upload/draft route, requiring operator completion.
3. Pulse phone dispatch pack.
4. Browser/RPA only on a test account, not the main Pulse account.
5. VA/manual posting as last resort.

The code now models the official inbox route as public-auto-publish=false and manual-completion=true. It is not wired into normal publishing.

## Safety

- No external posts made.
- No OAuth triggered.
- No Railway env changes.
- No production DB mutation.
- No browser automation.
- No production route switched.

## Validation

- `node --test tests/services/enterprise-ops.test.js tests/services/tiktok-exports.test.js tests/services/facebook-reels-eligibility.test.js tests/services/intelligence-pass.test.js`: pass.
- `npm test`: 1796/1796 pass.
- `npm run build`: pass.
- `npm run ops:social-platforms`: AMBER report generated.
- `npm run ops:publish-readiness`: AMBER, publish possible with advisories.

## Outputs

- `test/output/social_platform_operations.md`
- `test/output/social_platform_operations.json`
- `test/output/facebook_reels_eligibility.md`
- `test/output/tiktok_dispatch_manifest.md`
- `test/output/tiktok_403_diagnosis.md`

## Next Practical Actions

1. Pick and test an audited scheduler that truly auto-publishes TikToks to the connected account.
2. Run a manual Facebook Reel from the Page/Business Suite to determine whether the Page itself can publish Reels.
3. Add an operator-only TikTok inbox upload command after re-auth is healthy.
4. Keep browser automation off the main account.
