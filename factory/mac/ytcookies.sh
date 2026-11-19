#!/bin/bash
# Signs the game footage fetcher in to YouTube on the Mac mini (owner, 19 Nov 2026), so it can fetch age-restricted
# uploads (GTA VI full movies and playthroughs). Run it once in Terminal after signing the separate, disposable 18+
# Google account (never the Pulse or Orryy channel accounts) in to its own Brave profile, and again whenever Discord
# says the download account needs signing in again:
#
#   bash ~/PulseFactory/factory/mac/ytcookies.sh
#
# It lists the Brave profiles, you pick the download account's one by number, it exports that profile's YouTube and
# Google cookies to data/yt_cookies.txt (owner-only, never committed: data/ is ignored by git), then checks one
# age-restricted video and prints PASS or FAIL. macOS asks once for "Brave Safe Storage" in the Keychain: click
# Always Allow. Cookie values are never printed.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FACTORY="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA="$FACTORY/data"
OUT="$DATA/yt_cookies.txt"
STAMP="$DATA/yt-cookies-updated"
BRAVE="$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
EXPORT_URL="https://www.youtube.com/watch?v=jNQXAC9IVRw"
AGE_URL="https://www.youtube.com/watch?v=byDw86z-oZo"

YTDLP="$(command -v yt-dlp 2>/dev/null || true)"
if [ -z "$YTDLP" ] && [ -x /opt/homebrew/bin/yt-dlp ]; then YTDLP=/opt/homebrew/bin/yt-dlp; fi
if [ -z "$YTDLP" ]; then
  echo "FAIL: yt-dlp is not installed on this Mac (looked on the PATH and in /opt/homebrew/bin)."
  exit 1
fi

if [ ! -d "$BRAVE" ]; then
  echo "FAIL: no Brave profiles found in $BRAVE"
  exit 1
fi

# The profile's display name from its Preferences file (JSON): plutil reads JSON on macOS, python3 as a fallback.
profile_name() {
  local prefs="$1/Preferences" name=""
  name="$(plutil -extract profile.name raw -o - "$prefs" 2>/dev/null || true)"
  if [ -z "$name" ] && command -v python3 >/dev/null 2>&1; then
    name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("profile",{}).get("name",""))' "$prefs" 2>/dev/null || true)"
  fi
  echo "${name:-(no name)}"
}

FOLDERS=()
NAMES=()
for dir in "$BRAVE"/Default "$BRAVE"/Profile*; do
  [ -f "$dir/Preferences" ] || continue
  FOLDERS+=("$(basename "$dir")")
  NAMES+=("$(profile_name "$dir")")
done

if [ "${#FOLDERS[@]}" -eq 0 ]; then
  echo "FAIL: no Brave profiles found in $BRAVE"
  exit 1
fi

echo "Brave profiles on this Mac:"
for i in "${!FOLDERS[@]}"; do
  printf "  %d) %s   (folder: %s)\n" "$((i + 1))" "${NAMES[$i]}" "${FOLDERS[$i]}"
done
echo
read -r -p "Type the number of the download account's profile and press Return: " PICK
if ! [[ "$PICK" =~ ^[0-9]+$ ]] || [ "$PICK" -lt 1 ] || [ "$PICK" -gt "${#FOLDERS[@]}" ]; then
  echo "FAIL: \"$PICK\" is not one of the numbers above. Nothing was changed."
  exit 1
fi
FOLDER="${FOLDERS[$((PICK - 1))]}"
echo
echo "Exporting the cookies of \"${NAMES[$((PICK - 1))]}\" ($FOLDER)."
echo "If macOS asks about \"Brave Safe Storage\", type your Mac password if asked and click Always Allow."
echo

umask 077
mkdir -p "$DATA"
RAW="$(mktemp "$DATA/.yt_cookies_raw.XXXXXX")"
KEPT="$(mktemp "$DATA/.yt_cookies_kept.XXXXXX")"
ERR="$(mktemp "$DATA/.yt_cookies_err.XXXXXX")"
cleanup() { rm -f "$RAW" "$KEPT" "$ERR"; }
trap cleanup EXIT

if ! "$YTDLP" --cookies-from-browser "brave:$FOLDER" --cookies "$RAW" --skip-download --print id "$EXPORT_URL" >/dev/null 2>"$ERR"; then
  echo "FAIL: yt-dlp could not export the cookies. Its last words (no cookie values in them):"
  tail -n 5 "$ERR" | sed 's/^/  /'
  echo "If you clicked Deny on the Keychain question, run this again and click Always Allow."
  exit 1
fi

# Keep only youtube.com and google.com cookies (Netscape format: the domain is the first tab-separated field, with
# "#HttpOnly_" in front of HttpOnly ones); the comment header stays.
awk -F'\t' '
  /^#HttpOnly_/ { d = substr($1, 11) }
  /^#/ && !/^#HttpOnly_/ { print; next }
  !/^#/ { d = $1 }
  NF < 7 { next }
  d ~ /(^|\.)(youtube|google)\.com$/ { print }
' "$RAW" >"$KEPT"

COUNT="$(grep -c -v -E '^#[^H]|^$' "$KEPT" || true)"
if [ "${COUNT:-0}" -eq 0 ]; then
  echo "FAIL: that profile has no YouTube or Google cookies. Open Brave with the download account's profile, sign in"
  echo "at youtube.com, then run this again."
  exit 1
fi
if ! awk -F'\t' '$6 == "SAPISID" || $6 == "__Secure-3PAPISID" || $6 == "LOGIN_INFO" { found = 1 } END { exit !found }' "$KEPT"; then
  echo "Warning: the cookies do not look signed in to YouTube. The check below will tell for sure."
fi

mv -f "$KEPT" "$OUT"
chmod 600 "$OUT"
echo "Saved $COUNT YouTube and Google cookies to $OUT (only you can read it)."
echo
echo "Checking one age-restricted video with them..."

if "$YTDLP" --cookies "$OUT" --skip-download --no-warnings --print id "$AGE_URL" 2>"$ERR" | grep -q '^byDw86z-oZo$'; then
  chmod 600 "$OUT"
  date -u >"$STAMP"
  echo
  echo "PASS: the download account is signed in and can see age-restricted videos."
  ENV_FILE="$FACTORY/.env"
  if [ -f "$ENV_FILE" ] && grep -q '^YTDLP_COOKIES_FILE=' "$ENV_FILE"; then
    if grep -qx "YTDLP_COOKIES_FILE=$OUT" "$ENV_FILE"; then
      echo "The factory's .env already points at this file. Nothing else to do."
    else
      echo "Note: the factory's .env has a different YTDLP_COOKIES_FILE line. It should be:"
      echo "  YTDLP_COOKIES_FILE=$OUT"
    fi
  elif [ -f "$ENV_FILE" ]; then
    read -r -p "Switch the game footage fetcher on to use it now (adds one line to the factory's .env)? [Y/n] " YES
    if [ -z "$YES" ] || [[ "$YES" =~ ^[Yy] ]]; then
      printf '\nYTDLP_COOKIES_FILE=%s\n' "$OUT" >>"$ENV_FILE"
      echo "Added. The factory uses it from its next restart."
    else
      echo "Not added. To switch it on later, add this line to $ENV_FILE:"
      echo "  YTDLP_COOKIES_FILE=$OUT"
    fi
  else
    echo "To switch it on, add this line to the factory's .env:"
    echo "  YTDLP_COOKIES_FILE=$OUT"
  fi
  exit 0
fi

chmod 600 "$OUT" 2>/dev/null || true
echo
echo "FAIL: YouTube did not show the age-restricted video with these cookies. Its last words (no cookie values in them):"
tail -n 3 "$ERR" | sed 's/^/  /'
echo "Check that the download account is signed in at youtube.com in that Brave profile and that its birthday makes"
echo "it 18 or over, then run this again."
exit 1
