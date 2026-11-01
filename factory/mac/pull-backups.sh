#!/bin/bash
# Copies the Mac's nightly encrypted backups off the Mac (run on the PC in Git Bash, after the cutover).
# On the PC the factory wrote its 03:00 restore point straight into Google Drive (G:/My Drive/Pulse backups).
# The Mac has no Google Drive, so it writes them to ~/PulseFactory/backups (BACKUP_DIR, set by
# mac/migrate.sh cutover) and this pulls each new one into the same Drive folder, under mac/, so they are
# off the Mac within a day. Already-copied files are skipped; copies older than 30 days are pruned, as the
# factory prunes its own. The files are AES-256-GCM encrypted with APP_SECRET, so nothing readable travels.
#   bash mac/pull-backups.sh            (a daily PC task at 04:00 runs this; see the report of 1 Nov 2026)
# Verify one: BACKUP_DIR="G:/My Drive/Pulse backups/mac" node --import tsx src/tools/backup.ts --verify
set -euo pipefail
DEST="${PULL_BACKUPS_DEST:-/g/My Drive/Pulse backups/mac}"
mkdir -p "$DEST"
list=$(ssh -o BatchMode=yes -o ConnectTimeout=20 pulse-mac 'ls ~/PulseFactory/backups 2>/dev/null | grep -E "^pulse-.*\.tar\.enc$"' || true)
copied=0
for f in $list; do
  [ -s "$DEST/$f" ] && continue
  scp -q -p -o BatchMode=yes "pulse-mac:PulseFactory/backups/$f" "$DEST/$f.part" && mv "$DEST/$f.part" "$DEST/$f" && copied=$((copied + 1))
done
find "$DEST" -name 'pulse-*.tar.enc' -mtime +30 -delete 2>/dev/null || true
newest=$(ls "$DEST" | grep -E '^pulse-.*\.tar\.enc$' | sort | tail -1)
echo "pulled $copied new backup(s); newest in Drive: ${newest:-none}"
# No backup newer than two days on the Mac means its nightly job is failing: say so, loudly, in the task log.
if [ -z "$newest" ] || [ $(( $(date +%s) - $(date -r "$DEST/$newest" +%s) )) -gt 172800 ]; then
  echo "WARNING: no Mac backup newer than two days" >&2
  exit 1
fi
