# Registers a hidden "Pulse Discord" start-up task that keeps the community Discord bot running
# (XP and levels, /rank, live feeds, live stats). Safe to re-run.
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "discord-bot.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Hidden
Stop-ScheduledTask -TaskName "Pulse Discord" -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Pulse Discord" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Pulse Gaming community Discord bot" -Force | Out-Null
Start-ScheduledTask -TaskName "Pulse Discord"
Start-Sleep -Seconds 5
Write-Host "Pulse Discord task: $((Get-ScheduledTask -TaskName 'Pulse Discord').State)"
