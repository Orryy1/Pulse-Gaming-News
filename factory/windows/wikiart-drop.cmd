@echo off
rem The owner's wiki art drop folder (src/wikiart/drop.ts) into the library: pictures saved by hand under
rem D:\pulse-data\wikiart-drop\<game>\ go in, pictures deleted there come out. Light work (a few ffmpeg calls only when
rem something changed, nothing from the web), so no orchestrator turn. It takes the library's write lock, so it skips
rem quietly while a crawl is writing and catches up on the next run.
rem The scheduled task "Pulse wiki art drop folder" runs this every 30 minutes; wikiart-crawl.cmd runs it before each crawl.
setlocal
cd /d "%~dp0.."
if "%WIKIART_DIR%"=="" set "WIKIART_DIR=D:\pulse-data\wikiart"
if "%WIKIART_DROP_DIR%"=="" set "WIKIART_DROP_DIR=D:\pulse-data\wikiart-drop"
if not exist "%WIKIART_DIR%" mkdir "%WIKIART_DIR%"
set "LOG=%WIKIART_DIR%\drop.out.log"
echo ==== %DATE% %TIME% >> "%LOG%"
node --import tsx src/tools/wikiart.ts import-drop >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
