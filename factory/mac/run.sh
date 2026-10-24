#!/bin/bash
# Keeps the factory running on the Mac (launchd starts this at boot; see com.pulse.factory.plist).
# Code arrives by `git push mac` from the PC (mac/post-receive checks and restarts), so unlike the
# Windows launcher this loop does not pull updates itself.
cd "$HOME/PulseFactory/factory" || exit 1
export PATH="/opt/homebrew/bin:$PATH"
mkdir -p data/logs
while true; do
  log="data/logs/factory-$(date +%Y-%m-%d).log"
  echo "[$(date -Iseconds)] starting factory" >> "$log"
  node --import tsx src/server.ts >> "$log" 2>&1
  echo "[$(date -Iseconds)] factory exited with $?; restarting in 30s" >> "$log"
  sleep 30
done
