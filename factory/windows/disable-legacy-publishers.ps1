# Run ONCE as Administrator. Makes sure nothing from the old Codex pipeline can
# publish to YouTube, so only the Pulse Factory posts. Disables the old
# PulseGaming-* scheduled tasks and services; leaves the local Ollama, VoxCPM
# (Liam voice on :8765) and ASR services alone because the factory uses them.
$ErrorActionPreference = "Continue"
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) { Write-Host "Right-click PowerShell > Run as administrator, then re-run this script." -ForegroundColor Red; exit 1 }

$keepServices = @("PulseGaming-Ollama", "PulseGaming-VoxCPM", "PulseGaming-ASR")
$keepTasks = @("Pulse Factory", "Pulse Tunnel")

Write-Host "== Scheduled tasks"
Get-ScheduledTask | Where-Object { ($_.TaskName -like "PulseGaming-*" -or $_.TaskName -like "Orryy-PulseGaming*") -and $keepTasks -notcontains $_.TaskName } | ForEach-Object {
  Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue | Out-Null
  Write-Host ("  disabled  {0}" -f $_.TaskName)
}
Write-Host "== Services"
Get-Service | Where-Object { $_.Name -like "PulseGaming-*" -and $keepServices -notcontains $_.Name } | ForEach-Object {
  if ($_.Status -ne "Stopped") { Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue }
  Set-Service -Name $_.Name -StartupType Disabled -ErrorAction SilentlyContinue
  Write-Host ("  disabled  {0}" -f $_.Name)
}
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "discord-bridge-v\d" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ("  killed    discord bridge pid {0}" -f $_.ProcessId) }
Write-Host "== Still enabled (should be only the factory, the tunnel and the voice/LLM services):"
Get-ScheduledTask | Where-Object { $_.TaskName -match "Pulse" -and $_.State -ne "Disabled" } | Select-Object TaskName, State | Format-Table -AutoSize
Get-Service | Where-Object { $_.Name -like "PulseGaming-*" -and $_.StartType -ne "Disabled" } | Select-Object Name, Status, StartType | Format-Table -AutoSize
