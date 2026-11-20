@echo off
rem The game library server the Mac mini reads footage and wiki art from (port 8793, relayed over the cable).
rem Started at logon by the "Pulse game library server" task (install-gamelib-serve.cmd). A second copy exits on the busy port.
setlocal
set "GAME_LIBRARY_DIR=D:\pulse-data\library"
cd /d "%~dp0.."
if not exist "D:\pulse-data\logs" mkdir "D:\pulse-data\logs"
node --import tsx src/tools/gamelib.ts serve --port=8793 >> "D:\pulse-data\logs\gamelib-serve.log" 2>&1
