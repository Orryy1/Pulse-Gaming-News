# Local Restart Readiness

Generated: 2026-05-16T09:04:12.564Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: 0ad77f4
- Local running commit: 0ad77f4 (matches)
- Public running commit: 0ad77f4 (matches)

## Runtime
- Local health: pass (200)
- Public health: pass (200)
- Public mode: local
- Public primary: false

## Cadence
- Public posts in 24h: 0
- Recommended daily cap: 3
- Off-schedule posts: 0
- Tight spacing pairs: 0
- Minimum gap: n/a minutes
- Invalid public story rows: 5
- Failed rows with platform IDs: 31

## Cadence Gates
- Publish window hard gate: enabled
- Minimum-gap hard gate: enabled
- Daily-cap hard gate: enabled

## Blockers
- public server is not reporting primary=true
- public script-validation fallback rows need repair before a clean resume

## Warnings
- 6 uncommitted file(s) are present; commit code changes before restart for reproducibility
- 31 failed row(s) still carry platform IDs

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`