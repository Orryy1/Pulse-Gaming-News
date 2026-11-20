# Stops the factory and removes its scheduled task. Leaves data\ and .env alone.
Stop-ScheduledTask -TaskName "Pulse Factory" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "Pulse Factory" -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match "src[\\/]server\.ts" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Pulse Factory stopped and removed from start-up."
