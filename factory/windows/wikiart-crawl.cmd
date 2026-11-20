@echo off
rem The wiki art crawl (src/wikiart/), one turn: the publisher's named stills from the game library first (no web),
rem then up to 110 minutes of polite wiki crawling, always inside an orchestrator turn (class cpu, priority 20) so it
rem waits for renders and Pulse's upload windows. The scheduled task "Pulse wiki art crawl" runs this twice a day.
setlocal
cd /d "%~dp0.."
if "%WIKIART_DIR%"=="" set "WIKIART_DIR=D:\pulse-data\wikiart"
if "%GAME_LIBRARY_DIR%"=="" set "GAME_LIBRARY_DIR=D:\pulse-data\library"
if not exist "%WIKIART_DIR%" mkdir "%WIKIART_DIR%"
set "LOG=%WIKIART_DIR%\crawl.out.log"
echo ==== %DATE% %TIME% >> "%LOG%"
for %%G in ("Grand Theft Auto VI" "Grand Theft Auto V") do node --import tsx src/tools/wikiart.ts import-library %%G >> "%LOG%" 2>&1
call C:\Claude\orchestrator\orch.cmd run --class cpu --project pulse --job "wiki art crawl" --priority 20 --est 120 -- node --import tsx src/tools/wikiart.ts crawl --minutes=110 >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
