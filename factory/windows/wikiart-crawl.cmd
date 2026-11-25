@echo off
rem The wiki art crawl (src/wikiart/), one turn inside an orchestrator lease (class cpu, priority 20) so it waits for
rem renders and Pulse's upload windows: the publisher's named stills from the game library first (no web), then up to
rem 110 minutes of polite wiki crawling. The crawl takes the library's write lock, so two turns never overlap.
rem The scheduled tasks "Pulse wiki art crawl" and "Pulse wiki art crawl (afternoon)" run this twice a day.
setlocal
cd /d "%~dp0.."
if "%WIKIART_DIR%"=="" set "WIKIART_DIR=D:\pulse-data\wikiart"
if "%GAME_LIBRARY_DIR%"=="" set "GAME_LIBRARY_DIR=D:\pulse-data\library"
if not exist "%WIKIART_DIR%" mkdir "%WIKIART_DIR%"
set "LOG=%WIKIART_DIR%\crawl.out.log"
echo ==== %DATE% %TIME% >> "%LOG%"
rem The owner's drop folder first (quick, no web, no orchestrator turn): see windows\wikiart-drop.cmd.
node --import tsx src/tools/wikiart.ts import-drop >> "%LOG%" 2>&1
call C:\Claude\orchestrator\orch.cmd run --class cpu --project pulse --job "wiki art crawl" --priority 20 --est 120 -- node --import tsx src/tools/wikiart.ts crawl --minutes=110 "--import=Grand Theft Auto VI;Grand Theft Auto V" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
