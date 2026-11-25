@echo off
rem Registers the stream recordings job (windows\vod-daily.ps1): every three hours from 05:15, hidden. It downloads new
rem Twitch past broadcasts of tinotv and spencey96, indexes them for the Mac's footage search and prunes old ones.
rem Replaces the old "TinoTV VOD download" task (disabled since 7 Nov), which stays disabled. Safe to run again.
rem Undo: schtasks /Delete /TN "Pulse stream recordings" /F
setlocal
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
set "RUNNER=%~dp0vod-daily.ps1"
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & exit /b 1)
schtasks /Create /F /TN "Pulse stream recordings" /SC HOURLY /MO 3 /ST 05:15 /TR "wscript.exe \"%HIDDEN%\" \"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe\" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%RUNNER%\"" >nul || exit /b 1
schtasks /Change /TN "TinoTV VOD download" /DISABLE >nul 2>&1
echo Done: new stream recordings are fetched and indexed every three hours.
exit /b 0
