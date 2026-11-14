#!/bin/bash
# Installs the Twitch-to-YouTube relay (src/tools/stream-relay.ts watch) as its own launchd service on the Mac mini,
# com.pulse.streamrelay, separate from the factory so a deploy or factory restart never cuts a live stream.
# Idempotent; run on the Mac:  bash ~/PulseFactory/factory/mac/relay.sh
# The service does nothing until STREAM_RELAY=true is in the factory's .env (it rests and re-reads every 10 minutes).
# Needs streamlink (brew install streamlink) and Homebrew's ffmpeg.
set -e
export PATH="/opt/homebrew/bin:$PATH"
command -v streamlink >/dev/null || brew install streamlink
LABEL=com.pulse.streamrelay
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/PulseFactory/logs"
mkdir -p "$AGENTS" "$LOGS"
cat > "$AGENTS/$LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array>
<string>/bin/bash</string><string>-c</string>
<string>cd "$HOME/PulseFactory/factory" &amp;&amp; exec node --import tsx src/tools/stream-relay.ts watch</string>
</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Interactive</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>$LOGS/$LABEL.log</string>
<key>StandardErrorPath</key><string>$LOGS/$LABEL.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL.plist" && echo "loaded $LABEL"
