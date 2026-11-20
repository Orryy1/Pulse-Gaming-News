@echo off
title Pulse wiki art drop folder (PC)
rem Registers the wiki art drop folder check on the PC: every 30 minutes windows\wikiart-drop.cmd runs from this
rem checkout, hidden, and brings pictures the owner saved into D:\pulse-data\wikiart-drop into the library.
rem Run it from the live checkout (C:\PulseFactory\factory\windows), never from a scratch worktree that gets cleared.
rem Safe to run again: it replaces the task. Needs no admin.
rem Undo: schtasks /Delete /TN "Pulse wiki art drop folder" /F
setlocal
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
set "RUNNER=%~dp0wikiart-drop.cmd"
echo "%RUNNER%" | findstr /I /L /C:"\\scratch\\" >nul && (echo This copy is in a scratch worktree: run the one in the live checkout instead. & exit /b 1)
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & exit /b 1)
schtasks /Create /F /TN "Pulse wiki art drop folder" /SC MINUTE /MO 30 /TR "wscript.exe \"%HIDDEN%\" \"%RUNNER%\"" >nul || exit /b 1
echo Done: the wiki art drop folder is checked every 30 minutes.
exit /b 0
