@echo off
title Connect TikTok (Pulse)
cd /d C:\PulseFactory\factory
node --import tsx src/cli.ts tiktok-login
echo.
pause
