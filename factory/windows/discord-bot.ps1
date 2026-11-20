# Keeps the Pulse community Discord bot running: restarts it 15 seconds after it stops.
# Started hidden by the "Pulse Discord" task (windows/install-discord.ps1), the same way as the factory.
Set-Location (Split-Path -Parent $PSScriptRoot)
$log = Join-Path (Get-Location) "data\logs\discord.log"
while ($true) {
  # cmd does the redirect so node's UTF-8 output lands in the log as plain text
  & cmd /c "node --import tsx src/discord/bot.ts >> `"$log`" 2>&1"
  Start-Sleep -Seconds 15
}
