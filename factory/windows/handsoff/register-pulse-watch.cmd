@echo off
title Pulse watch (PC)
rem Registers the Windows task "Pulse watch": every 15 minutes, src/tools/pulse-watch.ts checks the Pulse factory
rem with no model and starts a Claude fix session only for a new or lasting fault (src/handsoff/gate.ts).
rem   register-pulse-watch.cmd shadow [factory folder]   logs what it would do, launches nothing (first few hours)
rem   register-pulse-watch.cmd live   [factory folder]   the real thing (after the shadow log has been checked)
rem The factory folder defaults to C:\PulseFactory\factory. Runs as this user, hidden, no elevation needed.
rem Log: D:\pulse-data\handsoff\pulse-watch\decisions.jsonl. Undo: schtasks /Delete /TN "Pulse watch" /F
setlocal
set "MODE=%~1"
if "%MODE%"=="" set "MODE=shadow"
if /I not "%MODE%"=="shadow" if /I not "%MODE%"=="live" (echo Mode must be shadow or live. & goto :fail)
set "FACTORY=%~2"
if "%FACTORY%"=="" set "FACTORY=C:\PulseFactory\factory"
set "NODE=C:\Program Files\nodejs\node.exe"
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
if not exist "%NODE%" (echo Node.js is not at %NODE%. & goto :fail)
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & goto :fail)
if not exist "%FACTORY%\src\tools\pulse-watch.ts" (echo No pulse-watch.ts in %FACTORY%. & goto :fail)
set "RUNNER=%FACTORY%\windows\handsoff\pulse-watch-run.cmd"
schtasks /Create /F /TN "Pulse watch" /SC MINUTE /MO 15 /TR "wscript.exe \"%HIDDEN%\" \"%RUNNER%\" %MODE%" >nul || goto :fail
call "%RUNNER%" %MODE%
echo.
echo Done: "Pulse watch" runs every 15 minutes in %MODE% mode from %FACTORY%.
exit /b 0
:fail
echo.
echo Something went wrong; nothing else was changed.
exit /b 1
