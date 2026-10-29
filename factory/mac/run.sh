#!/bin/bash
# Keeps the factory running on the Mac (launchd starts this at boot; see com.pulse.factory.plist).
# Code arrives by `git push mac` from the PC (mac/post-receive checks and restarts), so unlike the
# Windows launcher this loop does not pull updates itself.
cd "$HOME/PulseFactory/factory" || exit 1
export PATH="/opt/homebrew/bin:$PATH"
mkdir -p data/logs data/admin
PREV="$HOME/PulseFactory/factory-prev"

# A short note to the owner's Discord (the webhook from .env), best effort.
notify() {
  local url
  url=$(grep -m1 '^DISCORD_WEBHOOK_URL=' .env 2>/dev/null | cut -d= -f2-)
  [ -n "$url" ] || return 0
  curl -s -m 15 -H 'content-type: application/json' -d "$(printf '{"content":"%s"}' "$1")" "$url" >/dev/null 2>&1 || true
}

while true; do
  log="data/logs/factory-$(date +%Y-%m-%d).log"
  release=$(cat data/admin/release 2>/dev/null)
  good=$(cat data/admin/good_release 2>/dev/null)
  echo "[$(date -Iseconds)] starting factory${release:+ ($release)}" >> "$log"
  started=$(date +%s)
  node --import tsx src/server.ts >> "$log" 2>&1
  code=$?
  ran=$(( $(date +%s) - started ))
  echo "[$(date -Iseconds)] factory exited with $code after ${ran}s; restarting in 30s" >> "$log"
  if [ "$ran" -lt 180 ] && [ -n "$release" ] && [ "$release" != "$good" ] && [ -d "$PREV" ]; then
    # Fresh code (deployed by mac/post-receive), and it died inside three minutes: back to the version that ran.
    echo "[$(date -Iseconds)] release $release died ${ran}s after boot; rolling back to ${good:-the previous code}" >> "$log"
    echo "$release" > data/admin/bad_release
    rsync -a --delete --exclude /data --exclude /.env --exclude /node_modules "$PREV/" "$HOME/PulseFactory/factory/"
    if ! cmp -s package-lock.json "$PREV/package-lock.json" 2>/dev/null; then npm ci --no-audit --no-fund >/dev/null 2>&1; fi
    [ -n "$good" ] && echo "$good" > data/admin/release || rm -f data/admin/release
    notify "⚠️ Pulse Factory (Mac): the update ${release:0:9} died ${ran}s after starting, so I went back to the previous version, which is running again. That update will not be deployed again; push a fix on top of it. The log has the error: data/logs/factory-$(date +%Y-%m-%d).log"
  elif [ "$ran" -ge 180 ] && [ -n "$release" ]; then
    # It ran: this is the version to fall back to from now on.
    echo "$release" > data/admin/good_release
    rm -f data/admin/bad_release
  fi
  sleep 30
done
