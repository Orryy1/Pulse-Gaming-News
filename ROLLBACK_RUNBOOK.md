# Rollback Runbook

## When To Roll Back

Rollback is appropriate if:

- Scheduler fails to start.
- Queue jobs duplicate or stall.
- YouTube upload breaks.
- Media paths resolve to missing live files.
- A deploy changes public output quality materially for the worse.
- Platform tokens or env handling regress.

## Immediate Safe Steps

1. Stop new manual actions.
2. Capture health output, logs and deployed commit.
3. Do not clean media or mutate DB rows.
4. Identify last known good commit.
5. Prepare a rollback PR or approved Railway redeploy only after operator approval.

## Evidence To Capture

- `/api/health` response
- Railway deployment id
- Scheduler state
- Queue state
- Last successful publish logs
- Failed job ids
- Platform error payloads
- Media path checks

## Recovery Tests

After rollback:

```bash
npm test
npm run build
npm run ops:system:doctor
npm run ops:media:verify
npm run ops:platform:status
```

If a platform publish was in-flight, inspect state before retrying anything.

