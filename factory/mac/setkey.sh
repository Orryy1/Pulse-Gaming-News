#!/bin/bash
# Stores a new Anthropic API key in the Mac factory's .env without it ever passing through a chat or a file
# on the PC (19 Nov 2026: the owner's plan includes monthly API credits for a linked Console organisation).
# Run on the Mac mini:  bash ~/PulseFactory/factory/mac/setkey.sh
# It asks for the key (nothing shows while pasting), tests it with one tiny request, and only then saves it.
set -u
cd "$(dirname "$0")/.." || exit 1
printf "Paste the new API key, then press Return (it will not show): "
read -rs KEY
echo
KEY="$(printf %s "$KEY" | tr -d '[:space:]')"
case "$KEY" in
  sk-ant-*) ;;
  *) echo "That does not look like an Anthropic API key (it should start with sk-ant-). Nothing changed."; exit 1 ;;
esac
HDR="$(mktemp)"; OUT="$(mktemp)"; chmod 600 "$HDR" "$OUT"
trap 'rm -f "$HDR" "$OUT"' EXIT
printf 'x-api-key: %s\nanthropic-version: 2023-06-01\ncontent-type: application/json\n' "$KEY" > "$HDR"
CODE=$(curl -s -o "$OUT" -w "%{http_code}" -H @"$HDR" https://api.anthropic.com/v1/messages \
  -d '{"model":"claude-haiku-4-5","max_tokens":5,"messages":[{"role":"user","content":"Say ok"}]}')
if [ "$CODE" != "200" ]; then
  MSG=$(grep -oE '"message":"[^"]*"' "$OUT" | head -1)
  echo "The key did not work (code $CODE) ${MSG}. Nothing changed."
  exit 1
fi
cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)-key"
TMP="$(mktemp)"; chmod 600 "$TMP"
grep -vE '^ANTHROPIC_API_KEY=' .env > "$TMP"
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$TMP"
cat "$TMP" > .env; rm -f "$TMP"
date -u +%FT%TZ > data/key-updated
echo "Saved and tested. Claude will tell the factory to use it within a few minutes."
