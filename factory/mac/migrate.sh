#!/bin/bash
# Moves the Pulse factory from this PC to the Mac mini (run from the PC in Git Bash, factory folder).
#   mac/migrate.sh hello <user> <ip>   once the Mac has run mac/setup.sh: an ssh alias "pulse-mac"
#   mac/migrate.sh prepare             safe while the PC keeps publishing, and nothing secret: tools,
#                                      code, speech check, vision model and checks (runs by itself
#                                      when the Mac reports in)
#   mac/migrate.sh cutover             settings and tunnel credentials, then stops the PC side, copies
#                                      the data, starts the Mac side and checks the public site; if the
#                                      Mac does not come up healthy the PC side is started again
# Secrets travel over ssh only and are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=claude/epic-pasteur-7s143q
on_mac() { ssh -o BatchMode=yes pulse-mac "export PATH=/opt/homebrew/bin:\$PATH; $1"; }

case "${1:-}" in
hello)
  user=$2 ip=$3
  touch ~/.ssh/config
  if ! grep -q "^Host pulse-mac" ~/.ssh/config; then
    printf '\nHost pulse-mac\n  HostName %s\n  User %s\n  IdentityFile ~/.ssh/pulse_mac\n  StrictHostKeyChecking accept-new\n' "$ip" "$user" >> ~/.ssh/config
  fi
  on_mac 'echo "reached $(scutil --get ComputerName) as $(whoami); macOS $(sw_vers -productVersion); $(sysctl -n hw.memsize | awk "{print \$1/1073741824}") GB"'
  ;;

prepare)
  echo "== tools"
  on_mac 'for t in node git ffmpeg yt-dlp cloudflared python3.12 rsync; do command -v $t >/dev/null || brew install ${t/python3.12/python@3.12}; done; node -v'
  echo "== code (a bare repo the PC pushes to; mac/post-receive typechecks before switching)"
  on_mac 'mkdir -p ~/PulseFactory/factory && cd ~/PulseFactory && [ -d repo.git ] || git init -q --bare repo.git'
  scp -q mac/post-receive pulse-mac:PulseFactory/repo.git/hooks/post-receive
  on_mac 'chmod +x ~/PulseFactory/repo.git/hooks/post-receive'
  git -C .. remote get-url mac >/dev/null 2>&1 || git -C .. remote add mac pulse-mac:PulseFactory/repo.git
  git -C .. push mac "$BRANCH"
  echo "== speech check (MLX Whisper)"
  on_mac 'cd ~/PulseFactory && [ -x asr/bin/python ] || python3.12 -m venv asr; asr/bin/pip install -q --upgrade pip mlx-whisper'
  on_mac 'bash ~/PulseFactory/factory/mac/launchd.sh && sleep 3 && curl -s http://127.0.0.1:8877/health'
  # The frame screen's vision model and the free Liam voice stay on the PC's 4090 (owner, 28 Oct 2026): the
  # Mac reaches them over the LAN, so no model is pulled onto its 16 GB.
  echo "== checks on the Mac"
  on_mac 'cd ~/PulseFactory/factory && npx tsc --noEmit -p . && node --import tsx --test tests/*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"'
  echo "prepare done: run mac/migrate.sh cutover when ready"
  ;;

cutover)
  echo "== settings (.env, with the Mac's paths)"
  home=$(on_mac 'echo $HOME')
  tmp=$(mktemp)
  # The PC keeps serving the free Liam voice (8766) and the frame screen's vision model (11434) over the LAN:
  # ElevenLabs first, Liam when the credits run out, as on the PC (Martin's money rule). The PC's name is
  # tried first; its hub address when the Mac cannot resolve .local.
  pc=DESKTOP-D3EI9PV.local
  on_mac "curl -sf -m 5 http://$pc:8766/health >/dev/null" || pc=192.168.0.93
  echo "   the Mac reaches the PC as $pc"
  grep -vE '^(DATA_DIR|YTDLP_PATH|FFMPEG_PATH|FFPROBE_PATH|LOCAL_TTS_URL|LOCAL_VISION_URL|VOICE_PROVIDER|REMOTION_CONCURRENCY)=' .env > "$tmp"
  printf 'DATA_DIR=%s/PulseFactory/factory/data\nVOICE_PROVIDER=elevenlabs-first\nLOCAL_TTS_URL=http://%s:8766\nLOCAL_VISION_URL=http://%s:11434\nREMOTION_CONCURRENCY=6\n' "$home" "$pc" "$pc" >> "$tmp"
  scp -q "$tmp" pulse-mac:PulseFactory/factory/.env && rm -f "$tmp"
  on_mac 'chmod 600 ~/PulseFactory/factory/.env'
  echo "== tunnel files (started at cutover)"
  cfg="D:/pulse-data/cloudflared-pulse.yml"
  id=$(grep -E '^tunnel:' "$cfg" | awk '{print $2}' | tr -d '\r')
  on_mac 'mkdir -p ~/.cloudflared && chmod 700 ~/.cloudflared'
  scp -q "$HOME/.cloudflared/$id.json" "pulse-mac:.cloudflared/$id.json"
  sed -e "s#^credentials-file:.*#credentials-file: $home/.cloudflared/$id.json#" -e 's/\r$//' -e '1s/^\xEF\xBB\xBF//' "$cfg" | on_mac "cat > ~/PulseFactory/cloudflared-pulse.yml"
  # One factory per API key: the PC side, its keep-alive loop included, is fully down before the Mac starts.
  echo "== stopping the PC side"
  schtasks //change //tn "Pulse Factory" //disable >/dev/null; schtasks //end //tn "Pulse Factory" >/dev/null 2>&1 || true
  schtasks //change //tn "Pulse Tunnel" //disable >/dev/null; schtasks //end //tn "Pulse Tunnel" >/dev/null 2>&1 || true
  schtasks //change //tn "Pulse Discord" //disable >/dev/null 2>&1; schtasks //end //tn "Pulse Discord" >/dev/null 2>&1 || true
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.ProcessId -ne \$PID -and \$_.CommandLine -match 'windows.run\.ps1|src.server\.ts|src.discord.bot\.ts|discord-bot\.ps1|cloudflared-pulse' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
  sleep 5
  echo "== final copy (database and episodes)"
  tar -C data -cf - db episodes site engage admin discord $(cd data && ls -d tokens tiktok-session.json 2>/dev/null) | on_mac 'mkdir -p ~/PulseFactory/factory/data && cd ~/PulseFactory/factory/data && rm -f db.lock && tar -xf -'
  # The platform logins live outside the data folder (Threads, TikTok, Facebook, Instagram), and the Spanish
  # music beds are not in git.
  if [ -d /d/pulse-data/tokens ]; then
    tar -C /d/pulse-data -cf - tokens | on_mac 'cd ~/PulseFactory/factory/data && tar -xf - && chmod 600 tokens/*'
  fi
  [ -d public/music/es ] && tar -cf - public/music/es | on_mac 'cd ~/PulseFactory/factory && tar -xf -'
  echo "== the five Brave routines now read the Mac (pulse-mac.local:8080); check them in the scheduled tasks list"
  echo "== starting the Mac side"
  on_mac 'bash ~/PulseFactory/factory/mac/launchd.sh factory'
  ok=no
  for i in $(seq 1 40); do
    if on_mac 'curl -sf -m 5 http://127.0.0.1:8080/health >/dev/null' && [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://pulsegmg.com/)" = 200 ]; then ok=yes; break; fi
    sleep 15
  done
  if [ "$ok" = yes ]; then
    echo "CUTOVER DONE: the Mac is running the factory and serving pulsegmg.com"
  else
    echo "Mac did not come up healthy within 10 minutes: starting the PC side again"
    on_mac 'launchctl bootout gui/$(id -u)/com.pulse.factory 2>/dev/null; launchctl bootout gui/$(id -u)/com.pulse.tunnel 2>/dev/null; launchctl bootout gui/$(id -u)/com.pulse.discord 2>/dev/null' || true
    schtasks //change //tn "Pulse Tunnel" //enable >/dev/null; schtasks //run //tn "Pulse Tunnel" >/dev/null
    schtasks //change //tn "Pulse Factory" //enable >/dev/null; schtasks //run //tn "Pulse Factory" >/dev/null
    schtasks //change //tn "Pulse Discord" //enable >/dev/null 2>&1; schtasks //run //tn "Pulse Discord" >/dev/null 2>&1 || true
    exit 1
  fi
  ;;
*)
  sed -n '2,10p' "$0"
  ;;
esac
