@echo off
title Pulse routine files (PC)
rem One tap on the PC: every 10 minutes, fetch the pictures the Studio browser routines attach (A/B test
rem thumbnails, community post pictures) from the factory on the Mac mini into C:\PulseFactory\routine-files.
rem Safe to run again: it replaces the task and the script copy. Undo: schtasks /Delete /TN "Pulse routine files" /F
setlocal
set "DEST=%LOCALAPPDATA%\PulseRoutineFiles"
set "NODE=C:\Program Files\nodejs\node.exe"
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
if not exist "%NODE%" (echo Node.js is not at %NODE%. & goto :fail)
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & goto :fail)
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%~dp0pull-routine-files.mjs" "%DEST%\pull-routine-files.mjs" >nul || goto :fail
schtasks /Create /F /TN "Pulse routine files" /SC MINUTE /MO 10 /TR "wscript.exe \"%HIDDEN%\" \"%NODE%\" \"%DEST%\pull-routine-files.mjs\"" >nul || goto :fail
"%NODE%" "%DEST%\pull-routine-files.mjs" || echo The first fetch did not finish; the task tries again in 10 minutes.
echo.
echo Done: the PC now fetches the routines' pictures every 10 minutes.
pause
exit /b 0
:fail
echo.
echo Something went wrong; nothing else was changed.
pause
exit /b 1
