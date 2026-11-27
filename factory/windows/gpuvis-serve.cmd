@echo off
rem The PC's GPU picture service the Mac mini asks for upscaled and extended stills (port 8799, relayed over the cable).
rem Every job takes a gpu turn from the PC orchestrator. Started at logon by the "Pulse GPU visuals service" task
rem (install-gpuvis-serve.cmd). A second copy exits on the busy port.
setlocal
cd /d "%~dp0.."
if not exist "D:\pulse-data\logs" mkdir "D:\pulse-data\logs"
node --import tsx src/gpuvis/server.ts >> "D:\pulse-data\logs\gpuvis-serve.log" 2>&1
