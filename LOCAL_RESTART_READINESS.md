# Local Restart Readiness

Generated: 2026-05-14T21:18:50.222Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: e0b2860
- Local running commit: unknown (does not match)
- Public running commit: unknown (does not match)

## Runtime
- Local health: pass (200)
- Public health: pass (200)
- Public mode: local
- Public primary: true

## Cadence
- Public posts in 24h: 11
- Recommended daily cap: 3
- Off-schedule posts: 10
- Tight spacing pairs: 7
- Minimum gap: 2 minutes
- Invalid public story rows: 2
- Failed rows with platform IDs: 24

## Cadence Gates
- Publish window hard gate: disabled
- Minimum-gap hard gate: disabled
- Daily-cap hard gate: disabled

## Blockers
- running local server does not expose build.commit_sha yet
- public server does not expose build.commit_sha yet
- off-schedule posts were detected but publish window hard gate is not enabled
- tight publish spacing was detected but publish cooldown hard gate is not enabled
- daily public post cap was exceeded but publish daily-cap hard gate is not enabled
- public script-validation fallback rows need repair before a clean resume

## Warnings
- 2 uncommitted file(s) are present; commit code changes before restart for reproducibility
- 24 failed row(s) still carry platform IDs

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`