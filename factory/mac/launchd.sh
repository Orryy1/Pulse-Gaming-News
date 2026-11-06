#!/bin/bash
# Writes and loads the Mac's three background services (run on the Mac; idempotent):
#   com.pulse.asr      the speech check (mac/asr_server.py) on 127.0.0.1:8877
#   com.pulse.tunnel   Cloudflare tunnel for pulse.orryy.com and pulsegmg.com
#   com.pulse.factory  the factory (mac/run.sh), only when called with "factory" (the cutover)
#   com.pulse.discord  the community Discord bot (src/discord/bot.ts), also from the cutover
# Each starts at boot and is restarted by launchd if it stops.
set -e
AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS" "$HOME/PulseFactory/logs"
plist() { # label, program and args...
  local label=$1; shift
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "<key>Label</key><string>$label</string>"
    echo '<key>ProgramArguments</key><array>'
    for a in "$@"; do echo "<string>$a</string>"; done
    echo '</array>'
    echo '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>'
    echo '<key>ProcessType</key><string>Interactive</string>'
    echo "<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>"
    echo "<key>StandardOutPath</key><string>$HOME/PulseFactory/logs/$label.log</string>"
    echo "<key>StandardErrorPath</key><string>$HOME/PulseFactory/logs/$label.log</string>"
    echo '</dict></plist>'
  } > "$AGENTS/$label.plist"
  # A service already loaded answers bootstrap with "Input/output error": it is restarted on the new plist instead.
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  sleep 1
  if launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist" 2>/dev/null; then
    echo "loaded $label"
  else
    launchctl kickstart -k "gui/$(id -u)/$label" && echo "restarted $label"
  fi
}
plist com.pulse.asr "$HOME/PulseFactory/asr/bin/python" "$HOME/PulseFactory/factory/mac/asr_server.py"
if [ "$1" = "factory" ]; then
  plist com.pulse.tunnel /opt/homebrew/bin/cloudflared tunnel --config "$HOME/PulseFactory/cloudflared-pulse.yml" --no-autoupdate run
  plist com.pulse.factory /bin/bash "$HOME/PulseFactory/factory/mac/run.sh"
  plist com.pulse.discord /bin/bash -c "cd $HOME/PulseFactory/factory && exec node --import tsx src/discord/bot.ts"
fi
