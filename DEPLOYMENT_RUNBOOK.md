# Deployment Runbook

## Current Rule

Do not deploy from this branch without explicit approval.

## Pre-Deploy Checklist

1. Confirm target branch and commit.
2. Confirm no `.env`, tokens or secrets are staged.
3. Run `npm test`.
4. Run `npm run build`.
5. Run `npm audit --json`.
6. Run `npm run ops:system:doctor`.
7. Run `npm run ops:media:verify`.
8. Run `npm run ops:platform:status`.
9. Run `npm run studio:v2:dossier`.
10. Confirm canonical render is not being replaced by a weaker candidate.

## Platform-Specific Checks

- YouTube: video ID persistence and Discord success reporting.
- Facebook Reel: `video_status=ready` plus `publishing_phase.status=complete` should be treated as success.
- Facebook Card: fallback should not hide Reel failure evidence.
- Instagram Reel: polling logs must include status and error payload fields.
- TikTok: do not retry official posting until app/public posting blocker is resolved or dispatch path is approved.

## Railway

Allowed before approval:

- Read health
- Read logs
- Read deployed commit

Read-only branch-vs-production inspection:

```bash
npm run ops:railway:health
```

This should not fail just because the local experimental branch is ahead of production. For an approved post-deploy parity check, enforce the exact local commit explicitly:

```bash
RAILWAY_HEALTH_EXPECT_LOCAL_COMMIT=true npm run ops:railway:health
```

Forbidden before approval:

- `railway up`
- `railway redeploy`
- `railway restart`
- Env var mutation
- Volume mutation

## Post-Deploy Verification

After an approved deploy only:

1. Confirm health endpoint commit matches the deployed commit.
2. Confirm scheduler state.
3. Confirm queue mode is strict on production.
4. Confirm no duplicate publish jobs have been created.
5. Watch first publish cycle logs before declaring success.
