# Discord Blockers - 2026-05-01

## What was fixed

### Monthly topics crash

Discord reported:

```text
roundup_monthly_topics job #17904 failed
extractKeywords is not a function
```

Root cause:

- `analytics.js` defined `extractKeywords`.
- `weekly_compile.js` imported `extractKeywords` from `analytics.js`.
- `analytics.js` did not export it.

Fix:

- Exported `extractKeywords`.
- Added `tests/services/analytics-keywords.test.js` so the monthly/weekly roundup import contract is pinned.

### Runaway Shorts duration

Discord reported publish candidates failing with:

```text
video_qa: duration_too_long (137.50s)
video_qa: duration_too_long (125.86s)
video_qa: duration_too_long (117.55s)
```

Root cause:

- Video QA correctly blocks MP4s over 75 seconds.
- `assemble.js` was still willing to render audio that was already too long for the Shorts contract.
- Publish therefore wasted the publish window discovering a problem that could have been known before FFmpeg render.

Fix:

- Added `lib/services/short-duration-contract.js`.
- Enforced a 61-75 second final-video contract with one second of render breathing room.
- `assemble.js` now skips render and stamps QA failure when audio is too long.
- `content-qa.js` now fails already-rendered rows when their stamped audio/runtime is too long.
- Added regression tests:
  - `tests/services/short-duration-contract.test.js`
  - `tests/services/assemble-duration-gate.test.js`
  - updated `tests/services/content-qa.test.js`

## Safety

- No Railway variables changed.
- No OAuth triggered.
- No production DB mutation was run manually.
- No publish/produce job was manually triggered.
- No render default was switched.
- No Studio V2 production promotion.
- No hard media-quality gate was enabled.

## Validation

Passed:

```bash
node --test tests/services/analytics-keywords.test.js tests/services/short-duration-contract.test.js tests/services/content-qa.test.js tests/services/assemble-duration-gate.test.js tests/services/video-qa.test.js tests/services/publisher-qa-persistence.test.js
npm run media:extract-frames -- --story-id rss_5b3abe925b27a199 --dry-run
npm run ops:creator-studio -- --story-id rss_5b3abe925b27a199
npm test
npm run build
```

Final full verification:

- `npm test`: 1,632/1,632 pass
- `npm run build`: pass

### Confusing local deploy Discord messages

Discord showed repeated messages like:

```text
Railway Deploy OK
Service: Pulse Gaming
Commit: dev
Deploy: local
```

Root cause:

- `server.js` posted `Railway Deploy OK` on process start whenever the instance was primary.
- Local/dev starts had no `RAILWAY_DEPLOYMENT_ID`, so the message fell back to `Deploy: local`.
- That made local mirror starts look like real Railway deployments.

Fix:

- Added `lib/deploy-notification.js`.
- Real Railway starts still use `Railway Deploy OK` when `RAILWAY_DEPLOYMENT_ID` is present.
- Local/dev starts are skipped by default.
- If `PULSE_LOCAL_DEPLOY_NOTIFY=true` is explicitly set, local starts are labelled `Local Pulse Mirror Started`, not Railway deploys.
- Added `tests/services/deploy-notification.test.js`.

## Manual action still needed

TikTok token refresh failed with `invalid_grant`, which means the refresh token is expired or revoked.

This cannot be safely fixed by code or background automation. The operator must re-authenticate TikTok in the browser:

```text
https://pulse.orryy.com/auth/tiktok?token=YOUR_API_TOKEN
```

The bare URL returns `{"error":"Unauthorized"}` because the auth starter route is intentionally protected. Use the dashboard/auth button if it adds the token automatically or append the `API_TOKEN` value as shown above. Do not share the full tokenised URL.

Detailed note:

- `TIKTOK_REAUTH_OPERATOR_NOTE.md`

## Recommended next build

Prepare the Studio V2 pilot readiness packet for `rss_5b3abe925b27a199` using the MP4, contact sheet, QA report, forensic report, provenance report, runtime proof, subtitle proof, audio caveat and rollback plan.

Do not switch Studio V2 into production from this report. The next decision should be whether one manually approved story is ready for a controlled pilot.
