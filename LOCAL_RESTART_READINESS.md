# Local Restart Readiness

Generated: 2026-06-01T05:16:32.981Z
Verdict: RED
Safety: read-only; does not restart the server, edit env vars, mutate DB rows, touch Railway or post

## Build Match
- Current commit: caf664b
- Local running commit: caf664b (matches)
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
- Relevant Pulse/Orryy tasks: 5
- Visible-console risks: 5
- Risk tasks: Orryy-GTA6Evening, Orryy-GTA6Morning, Orryy-MusicScout, Orryy-PulseGaming, Orryy-SleepyEmpire

## Windows Scheduler Repair Work Orders
- Work order: windows_scheduler_hidden_launcher:Orryy-GTA6Evening
  - Task: \Orryy-GTA6Evening
  - Blocker: visible_console_scheduler_launcher
  - Operator approval required: true
  - Requires elevated PowerShell: true
  - Backup: `Export-ScheduledTask -TaskName 'Orryy-GTA6Evening' -TaskPath '\' | Out-File -FilePath 'test\output\scheduler_task_backups\Orryy-GTA6Evening.xml' -Encoding utf8`
  - Command: `Set-ScheduledTask -TaskName 'Orryy-GTA6Evening' -TaskPath '\' -Action (New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '"C:\Claude\orryy-expansion\agents\run_daily.py" gta6_domination') -ErrorAction Stop`
  - Validate: `npm run ops:local-restart-readiness -- --json`
- Work order: windows_scheduler_hidden_launcher:Orryy-GTA6Morning
  - Task: \Orryy-GTA6Morning
  - Blocker: visible_console_scheduler_launcher
  - Operator approval required: true
  - Requires elevated PowerShell: true
  - Backup: `Export-ScheduledTask -TaskName 'Orryy-GTA6Morning' -TaskPath '\' | Out-File -FilePath 'test\output\scheduler_task_backups\Orryy-GTA6Morning.xml' -Encoding utf8`
  - Command: `Set-ScheduledTask -TaskName 'Orryy-GTA6Morning' -TaskPath '\' -Action (New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '"C:\Claude\orryy-expansion\agents\run_daily.py" gta6_domination') -ErrorAction Stop`
  - Validate: `npm run ops:local-restart-readiness -- --json`
- Work order: windows_scheduler_hidden_launcher:Orryy-MusicScout
  - Task: \Orryy-MusicScout
  - Blocker: visible_console_scheduler_launcher
  - Operator approval required: true
  - Requires elevated PowerShell: true
  - Backup: `Export-ScheduledTask -TaskName 'Orryy-MusicScout' -TaskPath '\' | Out-File -FilePath 'test\output\scheduler_task_backups\Orryy-MusicScout.xml' -Encoding utf8`
  - Command: `Set-ScheduledTask -TaskName 'Orryy-MusicScout' -TaskPath '\' -Action (New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '"C:\Claude\orryy-expansion\agents\run_daily.py" orryy_scout') -ErrorAction Stop`
  - Validate: `npm run ops:local-restart-readiness -- --json`
- Work order: windows_scheduler_hidden_launcher:Orryy-PulseGaming
  - Task: \Orryy-PulseGaming
  - Blocker: visible_console_scheduler_launcher
  - Operator approval required: true
  - Requires elevated PowerShell: true
  - Backup: `Export-ScheduledTask -TaskName 'Orryy-PulseGaming' -TaskPath '\' | Out-File -FilePath 'test\output\scheduler_task_backups\Orryy-PulseGaming.xml' -Encoding utf8`
  - Command: `Set-ScheduledTask -TaskName 'Orryy-PulseGaming' -TaskPath '\' -Action (New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '"C:\Claude\orryy-expansion\agents\run_daily.py" pulse_gaming') -ErrorAction Stop`
  - Validate: `npm run ops:local-restart-readiness -- --json`
- Work order: windows_scheduler_hidden_launcher:Orryy-SleepyEmpire
  - Task: \Orryy-SleepyEmpire
  - Blocker: visible_console_scheduler_launcher
  - Operator approval required: true
  - Requires elevated PowerShell: true
  - Backup: `Export-ScheduledTask -TaskName 'Orryy-SleepyEmpire' -TaskPath '\' | Out-File -FilePath 'test\output\scheduler_task_backups\Orryy-SleepyEmpire.xml' -Encoding utf8`
  - Command: `Set-ScheduledTask -TaskName 'Orryy-SleepyEmpire' -TaskPath '\' -Action (New-ScheduledTaskAction -Execute 'pythonw.exe' -Argument '"C:\Claude\orryy-expansion\agents\run_daily.py" sleepy_empire') -ErrorAction Stop`
  - Validate: `npm run ops:local-restart-readiness -- --json`

## Cadence Gates
- Publish window hard gate: enabled
- Minimum-gap hard gate: enabled
- Daily-cap hard gate: enabled

## Blockers
- public /api/health is not reachable

## Warnings
- 22 failed row(s) still carry platform IDs
- 5 Pulse/Orryy-related Windows scheduled task(s) can launch visible console windows

Recommendation: do_not_restart_primary_until_blockers_are_cleared

## Commands
- cadence: `npm run ops:publish-cadence -- --hours 24`
- row_repair_plan: `npm run ops:publish-row-repair -- --limit 40`
- restart_readiness: `npm run ops:local-restart-readiness`
- scheduler_hygiene: `npm run ops:local-restart-readiness -- --json`
