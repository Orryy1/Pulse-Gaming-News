# Local Restart Readiness

Generated: 2026-05-14T22:02:39.938Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: 525f3cc
- Local running commit: unknown (does not match)
- Public running commit: unknown (does not match)

## Runtime
- Local health: fail
- Public health: fail (502)
- Public mode: unknown
- Public primary: unknown

## Cadence
- Public posts in 24h: 10
- Recommended daily cap: 3
- Off-schedule posts: 9
- Tight spacing pairs: 6
- Minimum gap: 2 minutes
- Invalid public story rows: 2
- Failed rows with platform IDs: 24

## Cadence Gates
- Publish window hard gate: enabled
- Minimum-gap hard gate: enabled
- Daily-cap hard gate: enabled

## Blockers
- localhost /api/health is not reachable
- public /api/health is not reachable
- public script-validation fallback rows need repair before a clean resume

## Warnings
- 3 uncommitted file(s) are present; commit code changes before restart for reproducibility
- 24 failed row(s) still carry platform IDs

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`