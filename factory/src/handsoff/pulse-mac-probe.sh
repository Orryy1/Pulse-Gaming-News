#!/bin/bash
# One read-only look at the Pulse factory on the Mac mini for the hands-off watch (src/tools/pulse-watch.ts), sent
# over ssh on stdin (ssh pulse-mac bash -s < this file), so it needs no deploy. Prints sections that start with a
# line "@@<name>". The admin key is read into a variable and handed to curl on stdin (printf is a shell builtin, so
# the key is never on a command line `ps` can see); it is never printed. Changes nothing on the Mac.
# An admin page that fails prints null (unknown), never [] (nothing there), so a failed read is not "no videos".
export PATH=/opt/homebrew/bin:$PATH
F="$HOME/PulseFactory/factory"
cd "$F" || { echo "@@error"; echo "no factory folder"; exit 0; }
K=$(grep -E "^ADMIN_TOKEN=" .env | head -1 | cut -d= -f2- | tr -d "\"\r")
api() { printf 'header = "x-admin-key: %s"\n' "$K" | curl -s -f -m "${2:-60}" -K - "http://127.0.0.1:8080$1"; }

echo "@@health"; curl -s -m 15 http://127.0.0.1:8080/health; echo
echo "@@disk"; df -g / | tail -1
echo "@@now"; date -u +%Y-%m-%dT%H:%M:%SZ
# The logger keeps writing to the file named after the day it started, so read the two newest by time, not by name.
# Lines are parsed here and re-emitted with long fields shortened, so a long line is never cut into broken JSON.
echo "@@log"
for f in $(ls -t data/logs/factory-*.log 2>/dev/null | head -2); do tail -n 6000 "$f"; done \
  | grep -E '"level":"(error|warn)"|step failed|long_topic_skipped|no long-form topic' | tail -n 2000 | python3 -c '
import json, sys
for line in sys.stdin:
    try: x = json.loads(line)
    except Exception: continue
    out = {k: (v[:400] if isinstance(v, str) else v) for k, v in x.items() if k in ("t", "level", "msg", "id", "error", "status", "attempts", "lane", "reason")}
    print(json.dumps(out))'
echo "@@lastlog"
f=$(ls -t data/logs/factory-*.log 2>/dev/null | head -1)
[ -n "$f" ] && tail -n 1 "$f" | grep -oE '"t":"[^"]*"' | head -1
echo "@@episodes"
api "/admin/qa-notes?days=3" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("null"); sys.exit(0)
print(json.dumps([{"id": e.get("id"), "lane": e.get("lane"), "status": e.get("status"), "created_at": e.get("created_at"),
  "title": (e.get("title") or "")[:120], "last_error": (e.get("last_error") or "")[:300]} for e in d]))'
echo "@@published"
api "/admin/export?days=2" 90 | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("null"); sys.exit(0)
print(json.dumps([{"id": e.get("id"), "lane": e.get("lane"), "live_at": e.get("live_at"), "video": e.get("youtube_video_id")} for e in d]))'
echo "@@gateheld"
api "/admin/events?kinds=release_gate_held&hours=48" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("null"); sys.exit(0)
print(json.dumps([{"id": e.get("episode_id"), "at": e.get("created_at"), "status": e.get("status"), "headline": (e.get("headline") or "")[:120]} for e in d]))'
echo "@@ytguard"
python3 -c '
import json
try: s = json.load(open("data/ytguard/state.json"))
except Exception: s = {}
b = s.get("block") or {}
sb = (s.get("signed") or {}).get("block") or {}
print(json.dumps({"until": b.get("until"), "strikes": b.get("strikes"), "signedUntil": sb.get("until")}))'
echo "@@alerts"
tail -n 150 "$HOME/PulseFactory/state/discord_posts.jsonl" 2>/dev/null | python3 -c '
import json, sys
for line in sys.stdin:
    try: x = json.loads(line)
    except Exception: continue
    print(json.dumps({"at": x.get("at"), "channel": x.get("channel"), "text": (x.get("text") or "")[:500]}))'
echo "@@ports"
for hp in "10.77.0.1 8793" "10.77.0.1 8799" "127.0.0.1 8797"; do
  set -- $hp; if nc -z -G 4 "$1" "$2" >/dev/null 2>&1; then echo "$1:$2 up"; else echo "$1:$2 down"; fi
done
echo "@@procs"; pgrep -u "$(id -u)" -fl "[r]emotion|[f]fmpeg|[c]hrome-headless-shell" 2>/dev/null | cut -c1-160 | head -20
echo "@@hold"; [ -f data/admin/hold-restart ] && echo "hold-restart"
echo "@@slotenv"
grep -E "^[A-Z0-9_]+=" .env \
  | grep -E "^[A-Z0-9_]*(SLOT|DAYS|WEEKS|ENABLED|TIMEZONE|LEAD|SKIP|TARGET|PER_DAY|RECAP|WEEKLY|LONGFORM|DOC|WHY|EVERGREEN|NEWS|DEALS|CUTDOWN)[A-Z0-9_]*=" \
  | grep -vE "^[A-Z0-9_]*(KEY|TOKEN|SECRET|PASS|WEBHOOK|COOKIE|URL|_ID|EMAIL|CREDENTIAL|AUTH|PRIVATE)[A-Z0-9_]*="
echo "@@end"
