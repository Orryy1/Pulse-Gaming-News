# Local Restart Readiness

Generated: 2026-05-19T20:13:21.554Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: 46d7fc2
- Local running commit: 5109987 (does not match)
- Public running commit: 5109987 (does not match)

## Runtime
- Local health: pass (200)
- Public health: pass (200)
- Public mode: local
- Public primary: true

## Cadence
- Public posts in 24h: 2
- Recommended daily cap: 3
- Off-schedule posts: 0
- Tight spacing pairs: 0
- Minimum gap: 303 minutes
- Invalid public story rows: 1
- Failed rows with platform IDs: 32

## Cadence Gates
- Publish window hard gate: enabled
- Minimum-gap hard gate: enabled
- Daily-cap hard gate: enabled

## Blockers
- running local server is not on the current git commit
- public server is not on the current git commit
- public script-validation fallback rows need repair before a clean resume

## Warnings
- 63 uncommitted file(s) are present; commit code changes before restart for reproducibility
- 32 failed row(s) still carry platform IDs

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`