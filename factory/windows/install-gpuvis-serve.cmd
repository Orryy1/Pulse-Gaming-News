@echo off
rem Registers the GPU visuals service to start at logon, hidden. Safe to run again: it replaces the task.
rem Undo: schtasks /Delete /TN "Pulse GPU visuals service" /F
setlocal
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
set "RUNNER=%~dp0gpuvis-serve.cmd"
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & exit /b 1)
schtasks /Create /F /TN "Pulse GPU visuals service" /SC ONLOGON /TR "wscript.exe \"%HIDDEN%\" \"%RUNNER%\"" >nul || exit /b 1
echo Done: the GPU visuals service starts at logon.
exit /b 0
