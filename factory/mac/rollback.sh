#!/bin/bash
# Back to the PC a day or a week after the cutover (migrate.sh's own rollback only covers a failure during it). From the
# PC in Git Bash, factory folder. Never two factories at once: the Mac side is confirmed stopped and unable to restart
# before the PC side is enabled, and the data comes home between the two.
#   bash mac/rollback.sh check     what it would do: sizes, what is running, how many episodes are new. Changes nothing.
#   bash mac/rollback.sh go        does it; refuses while the Mac renders or uploads (FORCE_ROLLBACK=1 overrides)
# What comes home: the database, new episodes, site, engage, admin, discord, usage, abtests, tokens, gameplay clips and
# manifests, and the alert ledger. The PC's old copy of the database stays beside it as db.before-rollback-<time>.
# Left on the Mac, ready for another try: code, its .env, the seed. Scheduled tasks to switch back by hand are listed at
# the end, because some are the main chat's to change.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:-check}
on_mac() { ssh -o BatchMode=yes -o ConnectTimeout=15 pulse-mac "export PATH=/opt/homebrew/bin:\$PATH; $1"; }
M='~/PulseFactory/factory/data'
SERVICES='com.pulse.factory com.pulse.tunnel com.pulse.discord'

mac_running() { on_mac 'launchctl list | grep -E "com.pulse.(factory|tunnel|discord)$" | awk "{print \$3 \" pid=\" \$1}"; pgrep -f "[s]rc/server.ts" | sed "s/^/server pid /"' || true; }
pc_running() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.ProcessId -ne \$PID -and \$_.CommandLine -match 'src.server\.ts' } | Select-Object -ExpandProperty ProcessId" | tr -d '\r'
}

case "$mode" in
check)
  echo "== the Mac side"; mac_running
  echo "== busy?"
  on_mac 'pgrep -f "[r]emotion|[c]hrome-headless-shell" >/dev/null && echo "a render is running" || echo "no render"; curl -s -m 10 http://127.0.0.1:8080/health | head -c 400; echo'
  echo "== sizes on the Mac"
  on_mac "du -sh $M/db $M/episodes $M/site $M/engage $M/admin 2>/dev/null"
  echo "== new since the cutover"
  mark=$(cat data/admin/relink_done 2>/dev/null || cat data/admin/mac_seed_started 2>/dev/null || echo "2026-11-05T00:00:00Z")
  echo "   episode folders changed on the Mac since $mark: $(on_mac "find $M/episodes -maxdepth 1 -type d -newermt '$mark' | wc -l")"
  echo "== the PC side"
  echo "   factory process: $(pc_running | wc -w) running"
  schtasks //query //tn "Pulse Factory" //fo csv //nh | cut -d, -f3 || true
  df -h data | tail -1
  echo "nothing changed. mac/rollback.sh go does it."
  ;;
go)
  if on_mac 'pgrep -f "[r]emotion|[c]hrome-headless-shell" >/dev/null || curl -s -m 10 http://127.0.0.1:8080/health | grep -q "\"uploads_active\":[1-9]"'; then
    [ "${FORCE_ROLLBACK:-}" = 1 ] || { echo "the Mac is rendering or uploading: wait, or FORCE_ROLLBACK=1. Nothing changed."; exit 2; }
  fi
  [ -z "$(pc_running)" ] || { echo "a factory is already running on the PC: not touching anything"; exit 2; }

  echo "== stopping the Mac side, for good until asked (booted out, and the login items moved aside so a restart stays out)"
  for s in $SERVICES; do on_mac "launchctl bootout gui/\$(id -u)/$s 2>/dev/null; mv -f ~/Library/LaunchAgents/$s.plist ~/Library/LaunchAgents/$s.plist.off 2>/dev/null; true"; done
  sleep 8
  if on_mac 'pgrep -f "[s]rc/server.ts|[c]loudflared tunnel" >/dev/null'; then
    echo "the Mac side is still running after the stop: nothing else done. Look at it first."; exit 1
  fi
  # Anything still mid-file finishes before the copy; the database is closed once the server is gone.
  on_mac "rm -f $M/db/postmaster.pid"

  echo "== Mac paths back to the PC's, on the Mac's copy (it stays usable: forward slashes work on both)"
  on_mac 'cd ~/PulseFactory/factory && node --import tsx src/tools/relocate-paths.ts --write --to-pc'

  echo "== the PC's old database kept aside"
  stamp=$(date +%Y%m%d-%H%M%S)
  [ -d data/db ] && mv data/db "data/db.before-rollback-$stamp"
  rm -f data/db.lock

  echo "== data home"
  on_mac "cd $M && tar -cf - db site engage admin discord \$(ls -d tokens tiktok-session.json usage abtests logs/alerts.jsonl logs/alert_digest.md 2>/dev/null | tr '\n' ' ')" | tar -C data -xf -
  mark=$(cat data/admin/mac_seed_started 2>/dev/null || echo "2026-11-05T00:00:00Z")
  # Episodes: what is newer than the seed; the older ones never left the PC. Folders that retention removed on the Mac
  # stay here until the PC's own retention takes them.
  on_mac "cd $M && find episodes -type f -newermt '$mark' ! -name '*.part' -print0 | tar -cf - --null -T -" | tar -C data -xf -
  gp="$HOME/Videos/Pulse Gameplay"
  mkdir -p "$gp"
  on_mac 'cd "$HOME/Videos/Pulse Gameplay" && tar -cf - $(ls -d inbox published 2>/dev/null | tr "\n" " ")' | tar -C "$gp" -xf -
  # Platform logins came from D:/pulse-data/tokens and may have been refreshed on the Mac.
  [ -d data/tokens ] && [ -d /d/pulse-data/tokens ] && cp -p data/tokens/* /d/pulse-data/tokens/ || true
  # The PC's own settings file was never changed, so it is right as it stands. Tokens stored in the database are
  # encrypted with APP_SECRET, which is the same on both.

  echo "== starting the PC side"
  schtasks //change //tn "Pulse Tunnel" //enable >/dev/null; schtasks //run //tn "Pulse Tunnel" >/dev/null
  schtasks //change //tn "Pulse Factory" //enable >/dev/null; schtasks //run //tn "Pulse Factory" >/dev/null
  schtasks //change //tn "Pulse Discord" //enable >/dev/null 2>&1; schtasks //run //tn "Pulse Discord" >/dev/null 2>&1 || true
  ok=no
  for i in $(seq 1 40); do
    if curl -sf -m 5 http://127.0.0.1:8080/health >/dev/null && [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://pulsegmg.com/)" = 200 ]; then ok=yes; break; fi
    sleep 15
  done
  [ "$ok" = yes ] && echo "ROLLBACK DONE: the PC is running the factory and serving pulsegmg.com" || { echo "the PC did not come up within 10 minutes: read data/logs. The Mac stays stopped."; exit 1; }
  cat <<'NOTE'
By hand now (the main chat's to change):
  - On the Mac: the routines in ~/.claude/scheduled-tasks point at 127.0.0.1:8080. Put the .before-cutover files back and
    set ROUTINE_LAN_ALLOW in the PC's .env (it still holds it), or re-enable the PC's copies and turn the Mac's off.
  - The PC's "Pulse backups pull" task: disable; backups go straight to Google Drive again.
  - sync-mac.mjs pauses by itself now that "Pulse Factory" is enabled again.
  - If MAC_GAMEPLAY was on: re-enable "Pulse gameplay highlight finder" and "TinoTV VOD download" after copying
    ~/PulseFactory/gameplay/downloaded.txt back to C:\Claude\tinotv-vods\downloaded.txt, so no VOD downloads twice.
  - Tell the Master orchestrator: the PC's render queue has Pulse in it again, and pulse.json is the PC's own again.
  - Code: this PC's branch may be behind what the Mac ran (mac/deploy.sh pushes to GitHub). Fast-forward it first.
NOTE
  ;;
*) sed -n 2,10p "$0" ;;
esac
