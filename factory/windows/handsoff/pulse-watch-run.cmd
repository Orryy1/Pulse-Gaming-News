@echo off
rem One run of the Pulse watch (the "Pulse watch" task calls this through the hidden launcher). %1 = shadow or live.
setlocal
cd /d "%~dp0..\.."
set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\usr\bin;C:\Program Files\Git\bin;%USERPROFILE%\.local\bin;%PATH%"
if not exist "D:\pulse-data\handsoff\pulse-watch" mkdir "D:\pulse-data\handsoff\pulse-watch"
"C:\Program Files\nodejs\node.exe" --import tsx src\tools\pulse-watch.ts --%~1 >> "D:\pulse-data\handsoff\pulse-watch\runs.log" 2>&1
