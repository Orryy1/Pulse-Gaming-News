@echo off
title Pulse wiki art crawl (PC)
rem Registers the wiki art crawl on the PC: twice a day (04:10 and 15:10) windows\wikiart-crawl.cmd runs from this
rem checkout, hidden, and waits for its orchestrator turn. Safe to run again: it replaces the task.
rem Undo: schtasks /Delete /TN "Pulse wiki art crawl" /F
setlocal
set "HIDDEN=%USERPROFILE%\.hidden-launch\run-hidden.vbs"
set "RUNNER=%~dp0wikiart-crawl.cmd"
if not exist "%HIDDEN%" (echo The hidden launcher is not at %HIDDEN%. & exit /b 1)
schtasks /Create /F /TN "Pulse wiki art crawl" /SC DAILY /ST 04:10 /TR "wscript.exe \"%HIDDEN%\" \"%RUNNER%\"" >nul || exit /b 1
schtasks /Create /F /TN "Pulse wiki art crawl (afternoon)" /SC DAILY /ST 15:10 /TR "wscript.exe \"%HIDDEN%\" \"%RUNNER%\"" >nul || exit /b 1
echo Done: the wiki art crawl runs at 04:10 and 15:10, each time in an orchestrator turn.
exit /b 0
