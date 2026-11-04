#!/bin/bash
# The Mac's copy of C:\Claude\tinotv-vods\download-vods.ps1: new TinoTV Twitch past broadcasts into
# ~/Videos/TinoTV VODs, skipped when the disk would drop under its floor, with the same phone notices. The PC
# pulls each finished file and the Mac's copy then goes (src/macworker.ts pullGameplay), so the owner's archive
# stays on the PC.
set -u
export PATH="/opt/homebrew/bin:$PATH"
OUT="$HOME/Videos/TinoTV VODs"
HERE="$HOME/PulseFactory/gameplay"
NTFY="https://ntfy.sh/leonida-alerts-547db63b3fb46528bf"
mkdir -p "$OUT" "$HERE"
touch "$HERE/downloaded.txt"
notify() { curl -s -m 15 -H "Title: $1" -H "Tags: video_game" -d "$2" "$NTFY" >/dev/null 2>&1 || true; }
free=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if [ "$free" -lt "${VOD_FLOOR_GB:-55}" ]; then
  echo "skipped: only $free GB free"
  notify "TinoTV VODs not downloaded" "Only $free GB free on the Mac mini. Free up space so tonight's VODs can be saved before Twitch deletes them."
  exit 0
fi
yt-dlp -U >/dev/null 2>&1 || true # Twitch changes often; keep yt-dlp current
before=$(wc -l < "$HERE/downloaded.txt")
yt-dlp "https://www.twitch.tv/tinotv/videos?filter=archives&sort=time" \
  --download-archive "$HERE/downloaded.txt" \
  -f "best[height<=1080]/best" \
  -P "home:$OUT" -P "temp:/tmp/tinotv-vods" \
  -o "%(upload_date>%Y-%m-%d)s %(title).80B [%(id)s].%(ext)s" \
  --no-part --retries 10 --fragment-retries 20 --concurrent-fragments 4 \
  --match-filters "!is_live" 2>&1 | grep -E "Destination|ERROR|already been" || true
new=$(( $(wc -l < "$HERE/downloaded.txt") - before ))
echo "done: $new new VOD(s)"
if [ "$new" -gt 0 ]; then
  notify "TinoTV VODs saved" "$new new stream VOD(s) saved on the Mac mini; they come to Videos\\TinoTV VODs on the PC once scored."
fi
