#!/bin/bash
# The Mac's copy of C:\Claude\tinotv-vods\download-vods.ps1: new TinoTV Twitch past broadcasts into
# ~/Videos/TinoTV VODs, skipped when the disk would drop under its floor. The PC pulls each finished file and
# the Mac's copy then goes (src/macworker.ts pullGameplay), so the owner's archive stays on the PC.
set -u
export PATH="/opt/homebrew/bin:$PATH"
OUT="$HOME/Videos/TinoTV VODs"
HERE="$HOME/PulseFactory/gameplay"
mkdir -p "$OUT" "$HERE"
free=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if [ "$free" -lt "${VOD_FLOOR_GB:-55}" ]; then echo "skipped: only $free GB free"; exit 0; fi
yt-dlp "https://www.twitch.tv/tinotv/videos?filter=archives&sort=time" \
  --download-archive "$HERE/downloaded.txt" \
  -f "best[height<=1080]/best" \
  -P "home:$OUT" -P "temp:/tmp/tinotv-vods" \
  -o "%(upload_date>%Y-%m-%d)s %(title).80B [%(id)s].%(ext)s" \
  --no-part --retries 10 --fragment-retries 20 --concurrent-fragments 4 \
  --match-filters "!is_live" 2>&1 | grep -E "Destination|ERROR|already been" || true
