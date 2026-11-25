#!/bin/bash
# Installs the 3D clip service (src/tools/blender.ts serve) as its own launchd service on the Mac mini,
# com.pulse.blender, so long videos and documentaries get their Blender scenes (BLENDER_SCENES, src/render/blender.ts)
# from this machine: BLENDER_URL=http://127.0.0.1:8797 in the factory's .env. Blender itself lives at
# ~/PulseFactory/blender/Blender.app and its assets at ~/PulseFactory/blender/assets (fetch_assets.py).
# The Mac renders its own clips, so no PC orchestrator turn is taken (ORCH_CLIENT points nowhere on purpose).
# Idempotent; run on the Mac:  bash ~/PulseFactory/factory/mac/blender.sh
set -e
export PATH="/opt/homebrew/bin:$PATH"
LABEL=com.pulse.blender
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/PulseFactory/logs"
CACHE="$HOME/PulseFactory/blender/cache"
mkdir -p "$AGENTS" "$LOGS" "$CACHE"
test -x "$HOME/PulseFactory/blender/Blender.app/Contents/MacOS/Blender" || { echo "Blender is not installed at ~/PulseFactory/blender"; exit 1; }
cat > "$AGENTS/$LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array>
<string>/bin/bash</string><string>-c</string>
<string>cd "$HOME/PulseFactory/factory" &amp;&amp; exec node --env-file=.env --import tsx src/tools/blender.ts serve</string>
</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>BLENDER_CACHE</key><string>$CACHE</string>
<key>ORCH_CLIENT</key><string>file:///nonexistent/orch.mjs</string>
</dict>
<key>StandardOutPath</key><string>$LOGS/$LABEL.log</string>
<key>StandardErrorPath</key><string>$LOGS/$LABEL.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL.plist" && echo "loaded $LABEL"
