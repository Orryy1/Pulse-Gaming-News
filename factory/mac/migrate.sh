#!/bin/bash
# Moves the Pulse factory from this PC to the Mac mini (run from the PC in Git Bash, factory folder).
#   mac/migrate.sh hello <user> <ip>   once the Mac has run mac/setup.sh: an ssh alias "pulse-mac"
#   mac/migrate.sh prepare             safe while the PC keeps publishing, and nothing secret: tools,
#                                      code, speech check, vision model and checks (runs by itself
#                                      when the Mac reports in)
#   mac/migrate.sh seed                copies the episodes and gameplay clips ahead of time, with the PC still
#                                      running (15 GB at about 9 MB/s over Wi-Fi: half an hour that then
#                                      does not come out of the channel's downtime). Safe to run again.
#   mac/migrate.sh preflight           every check the cutover makes before touching anything; changes nothing
#   mac/migrate.sh cutover             settings and tunnel credentials, then stops the PC side, copies
#                                      the data, starts the Mac side and checks the public site; if the
#                                      Mac does not come up healthy the PC side is started again
# Going back to the PC days later is mac/rollback.sh, and code updates afterwards are mac/deploy.sh.
# Secrets travel over ssh only and are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=claude/epic-pasteur-7s143q
on_mac() { ssh -o BatchMode=yes pulse-mac "export PATH=/opt/homebrew/bin:\$PATH; $1"; }
FF=/opt/homebrew/opt/ffmpeg-full/bin
SEED_MARK=data/admin/mac_seed_started

# Everything that must be true before the PC side stops. Prints each problem; exit 1 if there is any.
preflight() {
  local bad=0
  say_bad() { echo "   NOT READY: $1"; bad=1; }
  tz=$(on_mac 'date +%Z') || { echo "   NOT READY: the Mac does not answer"; return 1; }
  case "$tz" in GMT|BST) ;; *) say_bad "the Mac's clock is on $tz, not London: set System Settings > General > Date & Time" ;; esac
  on_mac "$FF/ffmpeg -hide_banner -filters 2>/dev/null | grep -qE ' zscale ' && $FF/ffmpeg -hide_banner -filters 2>/dev/null | grep -qE ' rubberband '" || say_bad "ffmpeg-full is missing or has no zscale/rubberband (mac/migrate.sh prepare)"
  on_mac 'command -v cloudflared yt-dlp python3.12 >/dev/null' || say_bad "a tool is missing on the Mac (mac/migrate.sh prepare)"
  on_mac 'curl -sf -m 5 http://127.0.0.1:8877/health >/dev/null' || say_bad "the Mac's speech check on 8877 does not answer"
  [ "$(on_mac 'df -g ~ | awk "NR==2 {print \$4}"')" -gt 60 ] || say_bad "under 60 GB free on the Mac"
  # A Short or a thumbnail job the PC handed to the Mac is the PC factory's own render: it ends with the factory.
  on_mac 'pgrep -f "[r]emotion|[c]hrome-headless-shell" >/dev/null' && say_bad "a render is running on the Mac"
  local here there
  here=$(git rev-parse HEAD)
  there=$(on_mac 'cat ~/PulseFactory/factory/data/admin/release 2>/dev/null' || true)
  [ "$here" = "$there" ] || say_bad "the Mac's code is $there, this branch is $here: git push mac $BRANCH"
  on_mac 'test -s ~/PulseFactory/factory/.env' >/dev/null 2>&1 && on_mac 'launchctl print gui/$(id -u)/com.pulse.factory >/dev/null 2>&1' && say_bad "com.pulse.factory is already loaded on the Mac: one factory per API key"
  local h
  h=$(curl -s -m 10 http://127.0.0.1:8080/health || true)
  case "$h" in *'"uploads_active":0'*) ;; '') say_bad "the PC factory does not answer: start from a healthy PC so a failed move can go back to it" ;; *) say_bad "an upload is running on the PC" ;; esac
  [ -f data/admin/hold-restart ] && say_bad "the hold-restart flag is set"
  if [ -x /c/Claude/orchestrator/orch.cmd ] || [ -f /c/Claude/orchestrator/orch.cmd ]; then
    if /c/Claude/orchestrator/orch.cmd status 2>/dev/null | sed -n '/^RUNNING/,/^WAITING/p' | grep -qE 'pulse: (long|render|short)'; then say_bad "a Pulse render is running on the PC"; fi
  fi
  if [ -f "$SEED_MARK" ]; then echo "   seeded from $(cat "$SEED_MARK")"; else echo "   note: no seed yet, so the final copy takes about 30 min (mac/migrate.sh seed)"; fi
  return $bad
}

case "${1:-}" in
hello)
  user=$2 ip=$3
  # The Mac is on Wi-Fi with a DHCP address: its Bonjour name is used when the PC resolves it, so a new
  # lease does not break the alias; otherwise the address it reported in with.
  host=$ip
  ping -n 1 -w 2000 pulse-mac.local >/dev/null 2>&1 && host=pulse-mac.local
  touch ~/.ssh/config
  if grep -q "^Host pulse-mac" ~/.ssh/config; then
    sed -i "/^Host pulse-mac\$/,/^Host /{s/^  HostName .*/  HostName $host/}" ~/.ssh/config
  else
    printf '\nHost pulse-mac\n  HostName %s\n  User %s\n  IdentityFile ~/.ssh/pulse_mac\n  StrictHostKeyChecking accept-new\n' "$host" "$user" >> ~/.ssh/config
  fi
  on_mac 'echo "reached $(scutil --get ComputerName) as $(whoami); macOS $(sw_vers -productVersion); $(sysctl -n hw.memsize | awk "{print \$1/1073741824}") GB"'
  ;;

prepare)
  echo "== tools"
  on_mac 'for t in node git ffmpeg yt-dlp cloudflared python3.12 rsync; do command -v $t >/dev/null || brew install ${t/python3.12/python@3.12}; done; node -v'
  # The full ffmpeg (keg-only, beside Homebrew's plain one): the plain build has no zscale (the HDR tone-map for console
  # clips) and no rubberband. Homebrew's freetype bottle wants /usr/lib/libhvf.dylib, which macOS 15.0 does not have, so
  # on such a Mac it is built from source (seconds), or every program using it dies at launch (4 Nov 2026).
  on_mac "brew list ffmpeg-full >/dev/null 2>&1 || brew install ffmpeg-full; if [ ! -e /usr/lib/libhvf.dylib ] && otool -L /opt/homebrew/opt/freetype/lib/libfreetype.6.dylib | grep -q libhvf; then brew reinstall --build-from-source freetype; fi; $FF/ffmpeg -hide_banner -filters | grep -E ' (zscale|rubberband) '"
  echo "== code (a bare repo the PC pushes to; mac/post-receive typechecks before switching)"
  on_mac 'mkdir -p ~/PulseFactory/factory && cd ~/PulseFactory && [ -d repo.git ] || git init -q --bare repo.git'
  scp -q mac/post-receive pulse-mac:PulseFactory/repo.git/hooks/post-receive
  on_mac 'chmod +x ~/PulseFactory/repo.git/hooks/post-receive'
  git -C .. remote get-url mac >/dev/null 2>&1 || git -C .. remote add mac pulse-mac:PulseFactory/repo.git
  git -C .. push mac "$BRANCH"
  echo "== speech check (MLX Whisper)"
  on_mac 'cd ~/PulseFactory && [ -x asr/bin/python ] || python3.12 -m venv asr; asr/bin/pip install -q --upgrade pip mlx-whisper'
  # The speech check loads its model at start: up to two minutes before its health answers.
  on_mac 'bash ~/PulseFactory/factory/mac/launchd.sh && for i in $(seq 1 24); do curl -sf -m 5 http://127.0.0.1:8877/health && break; sleep 5; done'
  # The frame screen's vision model and the free Liam voice stay on the PC's 4090 (owner, 28 Oct 2026): the
  # Mac reaches them over the LAN, so no model is pulled onto its 16 GB.
  echo "== depth layers for long videos' stills (src/render/parallax.py on Apple's GPU) and the picture-text reader"
  on_mac 'cd ~/PulseFactory && { [ -x parallax/bin/python ] || python3.12 -m venv parallax; } && parallax/bin/pip install -q --upgrade pip torch transformers opencv-python-headless pillow numpy && parallax/bin/python -c "import torch, cv2, PIL, transformers; print(\"parallax ok, mps:\", torch.backends.mps.is_available())"'
  on_mac 'cd ~/PulseFactory && { [ -x ocr/bin/python ] || python3.12 -m venv ocr; } && ocr/bin/pip install -q --upgrade pip pyobjc-framework-Vision pyobjc-framework-Quartz && ocr/bin/python -c "import Vision, Quartz; print(\"picture-text reader ok\")"'
  echo "== checks on the Mac"
  on_mac 'cd ~/PulseFactory/factory && npx tsc --noEmit -p . && node --import tsx --test tests/*.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"'
  echo "prepare done: run mac/migrate.sh cutover when ready"
  ;;

seed)
  # With the PC still running: no database, no settings, nothing the Mac starts from. A file being written now is
  # copied again at the cutover (the final copy takes everything newer than this mark).
  date -u +%Y-%m-%dT%H:%M:%SZ > "$SEED_MARK.tmp"
  tar -C data -cf - --exclude='*.part' episodes | on_mac 'mkdir -p ~/PulseFactory/factory/data && cd ~/PulseFactory/factory/data && tar -xf -' || echo "   (a file changed while it was read: the final copy takes it)"
  gp="$HOME/Videos/Pulse Gameplay"
  [ -d "$gp/inbox" ] && tar -C "$gp" -cf - inbox | on_mac 'mkdir -p "$HOME/Videos/Pulse Gameplay" && tar -xf - -C "$HOME/Videos/Pulse Gameplay"'
  mv "$SEED_MARK.tmp" "$SEED_MARK"
  echo "seeded: $(on_mac 'du -sh ~/PulseFactory/factory/data/episodes | cut -f1') of episodes on the Mac"
  ;;

preflight)
  preflight && echo "preflight clear"
  ;;

cutover)
  # FORCE_CUTOVER=1 skips only the busy checks' verdict, after a person has read them.
  echo "== preflight"
  if ! preflight; then
    [ "${FORCE_CUTOVER:-}" = 1 ] || { echo "cutover refused: nothing has been touched"; exit 1; }
    echo "   going ahead anyway: FORCE_CUTOVER=1"
  fi
  echo "== settings (.env, with the Mac's paths)"
  home=$(on_mac 'echo $HOME')
  tmp=$(mktemp)
  # The PC serves the frame screen's vision model (11434) over the LAN. Its name is tried first; its hub address when
  # the Mac cannot resolve .local. The free Liam voice stays off (orchestrator, 4 Nov 2026): VOICE_PROVIDER stays
  # elevenlabs-first with LOCAL_TTS_URL on this Mac's own loopback, where nothing listens, so an empty balance is
  # refused in a moment and says so, rather than waiting on a PC that may be signed out. Liam comes back by pointing
  # this at the PC again.
  pc=DESKTOP-D3EI9PV.local
  on_mac "curl -sf -m 5 http://$pc:11434/api/version >/dev/null" || pc=192.168.0.93
  echo "   the Mac reaches the PC as $pc"
  # ffmpeg-full's ffmpeg and ffprobe: the bundled ffprobe-static binary does not run on Apple silicon (error -86, 29 Oct
  # 2026), and Homebrew's plain ffmpeg has no zscale or rubberband. The MAC_* settings mean "a PC factory hands this to
  # the Mac": here the factory is on the Mac, so they go off, or it would ssh to itself. ROUTINE_LAN_ALLOW let the Mac's
  # routines reach the PC; they now use loopback. HOST=0.0.0.0 lets the PC read /orch/reservations.json and nothing else
  # (src/pcschedule.ts lanRequestAllowed). Sketches and local AI video stay off: they need the PC's GPU turn.
  # Windows-only paths are dropped too (1 Nov 2026 audit): the PC's Liam start.bat, the old TTS folder and
  # the Codex helper's Python; the TikTok token path is pointed at data/tokens, where the logins are copied.
  grep -vE '^(DATA_DIR|YTDLP_PATH|FFMPEG_PATH|FFPROBE_PATH|LOCAL_TTS_URL|LOCAL_VISION_URL|VOICE_PROVIDER|REMOTION_CONCURRENCY|LOCAL_TTS_START|PULSE_TTS_DIR|TIKTOK_TOKEN_PATH|BACKUP_DIR|CODEX_PYTHON|CODEX_RUNNER_DIR|MAC_[A-Z_]*|ROUTINE_LAN_ALLOW|ROUTINE_LAN_PORT|HOST|ILLUSTRATE_ENABLED|ILLUSTRATE_VIDEO_ENABLED)=' .env > "$tmp"
  printf 'DATA_DIR=%s/PulseFactory/factory/data\nVOICE_PROVIDER=elevenlabs-first\nLOCAL_TTS_URL=http://127.0.0.1:8766\nLOCAL_VISION_URL=http://%s:11434\nREMOTION_CONCURRENCY=6\nFFMPEG_PATH=%s/ffmpeg\nFFPROBE_PATH=%s/ffprobe\nBACKUP_DIR=%s/PulseFactory/backups\nHOST=0.0.0.0\nMAC_RENDER_SHORTS=false\nMAC_ASR=false\nMAC_FOOTAGE_GATHER=false\nMAC_STILLS=false\nMAC_GAMEPLAY=false\nILLUSTRATE_ENABLED=false\nILLUSTRATE_VIDEO_ENABLED=false\n' "$home" "$pc" "$FF" "$FF" "$home" >> "$tmp"
  tt=$(grep -m1 '^TIKTOK_TOKEN_PATH=' .env | cut -d= -f2- | tr -d '\r')
  [ -n "$tt" ] && printf 'TIKTOK_TOKEN_PATH=%s/PulseFactory/factory/data/tokens/%s\n' "$home" "$(basename "${tt//\\//}")" >> "$tmp"
  scp -q "$tmp" pulse-mac:PulseFactory/factory/.env && rm -f "$tmp"
  on_mac 'chmod 600 ~/PulseFactory/factory/.env'
  echo "== tunnel files (started at cutover)"
  cfg="D:/pulse-data/cloudflared-pulse.yml"
  id=$(grep -E '^tunnel:' "$cfg" | awk '{print $2}' | tr -d '\r')
  on_mac 'mkdir -p ~/.cloudflared && chmod 700 ~/.cloudflared'
  scp -q "$HOME/.cloudflared/$id.json" "pulse-mac:.cloudflared/$id.json"
  sed -e "s#^credentials-file:.*#credentials-file: $home/.cloudflared/$id.json#" -e 's/\r$//' -e '1s/^\xEF\xBB\xBF//' -e 's#http://localhost:8080#http://127.0.0.1:8080#' "$cfg" | on_mac "cat > ~/PulseFactory/cloudflared-pulse.yml"
  # One factory per API key: the PC side, its keep-alive loop included, is fully down before the Mac starts.
  echo "== stopping the PC side"
  schtasks //change //tn "Pulse Factory" //disable >/dev/null; schtasks //end //tn "Pulse Factory" >/dev/null 2>&1 || true
  schtasks //change //tn "Pulse Tunnel" //disable >/dev/null; schtasks //end //tn "Pulse Tunnel" >/dev/null 2>&1 || true
  schtasks //change //tn "Pulse Discord" //disable >/dev/null 2>&1; schtasks //end //tn "Pulse Discord" >/dev/null 2>&1 || true
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.ProcessId -ne \$PID -and \$_.CommandLine -match 'windows.run\.ps1|src.server\.ts|src.discord.bot\.ts|discord-bot\.ps1|cloudflared-pulse' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
  sleep 5
  # One-off record repairs that need the PC's paths (main chat, 4 Nov 2026): once only, with the factory stopped.
  if [ -f data/smoke/relink_ids.mts ] && [ ! -f data/admin/relink_done ]; then
    echo "== repairing three records"
    npx tsx data/smoke/relink_ids.mts write && date -u +%Y-%m-%dT%H:%M:%SZ > data/admin/relink_done
  fi
  echo "== final copy (database and episodes)"
  # usage/ is the day's Claude spend (the daily budget reads it) and abtests/ the Studio A/B tests in progress. Episodes:
  # all of them with no seed; only what changed since the seed otherwise. Not copied, on purpose: sfxlab/ (the lab's
  # working files: public/sfx holds what renders use), smoke/ beyond its scripts, tmp/, and tiktok-browser/ (a Windows
  # Chrome profile whose cookies are locked to this PC, and TIKTOK_BROWSER is off; tiktok-session.json does travel).
  seen=$(cd data && ls -d tokens tiktok-session.json usage abtests 2>/dev/null | tr '\n' ' ')
  tar -C data -cf - db site engage admin discord $seen $(cd data && ls logs/alerts.jsonl logs/alert_digest.md 2>/dev/null | tr '\n' ' ') | on_mac 'mkdir -p ~/PulseFactory/factory/data && cd ~/PulseFactory/factory/data && rm -f db.lock && rm -f db/postmaster.pid && tar -xf -'
  if [ -f "$SEED_MARK" ]; then
    (cd data && find episodes -type f -newermt "$(cat "../$SEED_MARK")" ! -name '*.part' -print0) > /tmp/pulse-delta.$$
    tar -C data -cf - --null -T /tmp/pulse-delta.$$ | on_mac 'cd ~/PulseFactory/factory/data && tar -xf -'
    rm -f /tmp/pulse-delta.$$
  else
    tar -C data -cf - --exclude='*.part' episodes | on_mac 'cd ~/PulseFactory/factory/data && tar -xf -'
  fi
  # The gameplay lane: every clip with its state, reviewed ones included (long videos use them as footage). No double
  # handling: mac sync (C:/Claude/tinotv-vods/sync-mac.mjs) only sends clips still "new" that it has not sent before,
  # and it records what it sends, so the clips carried here are marked as sent.
  gp="$HOME/Videos/Pulse Gameplay"
  if [ -d "$gp" ]; then
    tar -C "$gp" -cf - $(cd "$gp" && ls -d inbox published 2>/dev/null | tr '\n' ' ') | on_mac 'mkdir -p "$HOME/Videos/Pulse Gameplay" && tar -xf - -C "$HOME/Videos/Pulse Gameplay"'
    node -e 'const fs=require("fs"),p=require("path"),g=process.argv[1],f=p.join(g,"pushed-to-mac.json");let d={};try{d=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}for(const id of fs.readdirSync(p.join(g,"inbox"))){d[id]=d[id]||new Date().toISOString()}fs.writeFileSync(f,JSON.stringify(d,null,2))' "$gp"
  fi
  # The experiment list the lane matches clips against: at this path by default, kept current by sync-mac.
  exp="$HOME/gaming-studio/pulse-gaming/docs/GTA6_EXPERIMENT_SHORTS.md"
  [ -f "$exp" ] && on_mac 'mkdir -p "$HOME/gaming-studio/pulse-gaming/docs" && cat > "$HOME/gaming-studio/pulse-gaming/docs/GTA6_EXPERIMENT_SHORTS.md"' < "$exp"
  # The platform logins live outside the data folder (Threads, TikTok, Facebook, Instagram), and the Spanish
  # music beds are not in git.
  if [ -d /d/pulse-data/tokens ]; then
    tar -C /d/pulse-data -cf - tokens | on_mac 'cd ~/PulseFactory/factory/data && tar -xf - && chmod 600 tokens/*'
  fi
  [ -d public/music/es ] && tar -cf - public/music/es | on_mac 'cd ~/PulseFactory/factory && tar -xf -'
  # The small sandbox scripts the QA routines render stills with (data/smoke/*.mts), not the sandboxes themselves.
  ls data/smoke/*.mts >/dev/null 2>&1 && tar -C data -cf - $(cd data && ls smoke/*.mts) | on_mac 'cd ~/PulseFactory/factory/data && tar -xf -'
  echo "== stored Windows paths become the Mac's (database, A/B lists)"
  on_mac 'cd ~/PulseFactory/factory && node --import tsx src/tools/relocate-paths.ts --write'
  echo "== the Mac's Brave routines now read this Mac directly"
  on_mac 'for f in ~/.claude/scheduled-tasks/pulse-*/SKILL.md; do [ -f "$f" ] || continue; grep -q "DESKTOP-D3EI9PV.local:8081" "$f" || continue; cp "$f" "$f.before-cutover"; sed -i "" "s#http://DESKTOP-D3EI9PV.local:8081#http://127.0.0.1:8080#g" "$f"; echo "   $(basename "$(dirname "$f")")"; done'
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
