# Local Restart Readiness

Generated: 2026-06-01T02:46:33.507Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: 650f303
- Local running commit: unknown (does not match)
- Public running commit: unknown (does not match)

## Runtime
- Local health: fail
- Public health: fail (530)
- Public mode: unknown
- Public primary: unknown

## Cadence
- Public posts in 24h: 0
- Recommended daily cap: 3
- Off-schedule posts: 0
- Tight spacing pairs: 0
- Minimum gap: n/a minutes
- Invalid public story rows: 0
- Failed rows with platform IDs: 22

## Windows Scheduler Hygiene
- Inspection: ok
- Relevant Pulse tasks: 1
- Visible-console risks: 1
- Risk tasks: Orryy-PulseGaming

## Cadence Gates
- Publish window hard gate: enabled
- Minimum-gap hard gate: enabled
- Daily-cap hard gate: enabled

## Blockers
- localhost /api/health is not reachable
- public /api/health is not reachable

## Warnings
- 3 uncommitted file(s) are present; commit code changes before restart for reproducibility
- 22 failed row(s) still carry platform IDs
- 1 Pulse-related Windows scheduled task(s) can launch visible console windows

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`
- scheduler_hygiene: `npm run ops:local-restart-readiness -- --json`