@echo off
rem Registers the game library server to start at logon, hidden. Safe to run again: it replaces the task.
rem Undo: schtasks /Delete /TN "Pulse game library server" /F
setlocal
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
set "RUNNER=%~dp0gamelib-serve.cmd"
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & exit /b 1)
schtasks /Create /F /TN "Pulse game library server" /SC ONLOGON /TR "wscript.exe \"%HIDDEN%\" \"%RUNNER%\"" >nul || exit /b 1
echo Done: the game library server starts at logon.
exit /b 0
