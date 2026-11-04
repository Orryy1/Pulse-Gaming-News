#!/bin/bash
# Puts one commit of the factory into ~/PulseFactory/worker-<sha> for the PC's remote jobs (src/macworker.ts),
# without touching the Mac's factory checkout or the bare repo's HEAD and index: `git archive` only reads. The
# PC pushes the commit to refs/heads/pulse-worker (mac/post-receive ignores that ref), then pipes this script
# out of the same commit. Prints the worker folder. Usage: worker-sync.sh <sha>
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
sha=$1
ROOT="$HOME/PulseFactory"
dir="$ROOT/worker-${sha:0:12}"
if [ ! -f "$dir/.ready" ]; then
  rm -rf "$dir" "$dir.tmp"
  mkdir -p "$dir.tmp"
  git --git-dir="$ROOT/repo.git" archive "$sha" factory | tar -x -C "$dir.tmp" --strip-components=1
  if cmp -s "$dir.tmp/package-lock.json" "$ROOT/factory/package-lock.json"; then
    ln -s "$ROOT/factory/node_modules" "$dir.tmp/node_modules"
  else
    (cd "$dir.tmp" && npm ci --no-audit --no-fund >/dev/null 2>&1)
  fi
  # The Epidemic Sound beds are not in git; the Mac's copy serves every worker.
  if [ -d "$ROOT/factory/public/music/es" ]; then
    ln -s "$ROOT/factory/public/music/es" "$dir.tmp/public/music/es"
  fi
  touch "$dir.tmp/.ready"
  mv "$dir.tmp" "$dir"
fi
touch "$dir/.ready"
ln -sfn "$dir" "$ROOT/worker"
# This commit and the one before it stay (a job may still be running on the older one).
ls -dt "$ROOT"/worker-* 2>/dev/null | tail -n +3 | while read -r old; do rm -rf "$old"; done
echo "$dir"
