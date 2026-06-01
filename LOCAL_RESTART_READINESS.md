# Local Restart Readiness

Generated: 2026-06-01T03:15:22.344Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: ce13cf6
- Local running commit: ce13cf6 (matches)
- Public running commit: unknown (does not match)

## Runtime
- Local health: pass (200)
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

## Windows Scheduler Repair Work Orders
- Work order: windows_scheduler_hidden_launcher:Orryy-PulseGaming
  - Task: \Orryy-PulseGaming
  - Blocker: visible_console_scheduler_launcher
  - Operator approval required: true
  - Requires elevated PowerShell: true
  - Backup: `Export-ScheduledTask -TaskName 'Orryy-PulseGaming' -TaskPath '\' | Out-File -FilePath 'test\output\scheduler_task_backups\Orryy-PulseGaming.xml' -Encoding utf8`
  - Command: `Set-ScheduledTask -TaskName 'Orryy-PulseGaming' -TaskPath '\' -Action (New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '"C:\Claude\orryy-expansion\agents\run_daily.py" pulse_gaming')`
  - Validate: `npm run ops:local-restart-readiness -- --json`

## Cadence Gates
- Publish window hard gate: enabled
- Minimum-gap hard gate: enabled
- Daily-cap hard gate: enabled

## Blockers
- public /api/health is not reachable

## Warnings
- 2 uncommitted file(s) are present; commit code changes before restart for reproducibility
- 22 failed row(s) still carry platform IDs
- 1 Pulse-related Windows scheduled task(s) can launch visible console windows

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`
- scheduler_hygiene: `npm run ops:local-restart-readiness -- --json`