#!/bin/bash
# Code updates once the factory runs on the Mac: what scratchpad restart12.ps1 did on the PC. From the PC in Git Bash:
#   bash mac/deploy.sh [branch-or-commit]     default claude/stage
# Takes it only if that is a fast-forward of what the Mac runs, waits for a quiet moment there (no render, no upload, no
# hold-restart flag), pushes, and watches the factory come back. The Mac's hook typechecks first and refuses a broken push; if the
# new code dies inside three minutes mac/run.sh goes back to the old code by itself and says so in Discord.
#   DEPLOY_WAIT_MINUTES=30   how long to wait for a quiet moment (default 30), then give up changing nothing
#   DEPLOY_DRY=1             say what it would do, changing nothing
set -euo pipefail
cd "$(dirname "$0")/.."
LIVE_BRANCH=claude/epic-pasteur-7s143q
what=${1:-claude/stage}
host=${PULSE_DEPLOY_HOST:-pulse-mac}
remote=${PULSE_DEPLOY_REMOTE:-mac}
on_mac() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$host" "export PATH=/opt/homebrew/bin:\$PATH; $1"; }

new=$(git rev-parse "$what^{commit}")
old=$(on_mac "git --git-dir=\${PULSE_ROOT:-\$HOME/PulseFactory}/repo.git rev-parse refs/heads/$LIVE_BRANCH")
if [ "$new" = "$old" ]; then echo "the Mac already has $new"; exit 0; fi
if ! git merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
  echo "refused: $what is not a fast-forward of what the Mac runs ($old). Merge the Mac's commit into it first."
  exit 2
fi
echo "deploying $(git log --oneline -1 "$new")"
git log --oneline "$old..$new" | head -20

# Why not now: the same checks as the hook, read from here so the wait is visible.
why_busy() {
  on_mac 'R=${PULSE_ROOT:-$HOME/PulseFactory}; [ -f "$R/factory/data/admin/hold-restart" ] && echo "hold-restart flag"; pgrep -f "[r]emotion|[c]hrome-headless-shell" >/dev/null && echo "a render"; curl -s -m 10 "http://127.0.0.1:${PULSE_PORT:-8080}/health" 2>/dev/null | grep -q "\"uploads_active\":[1-9]" && echo "an upload"; true' | tr '\n' ' '
}
deadline=$(( $(date +%s) + ${DEPLOY_WAIT_MINUTES:-30} * 60 ))
while :; do
  why=$(why_busy)
  [ -z "$why" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "gave up: still busy ($why); nothing changed"; exit 2; fi
  echo "waiting: $why"
  sleep 60
done
if [ "${DEPLOY_DRY:-}" = 1 ]; then echo "DEPLOY_DRY: quiet now, would push $new"; exit 0; fi

# The push is the deploy (mac/post-receive): typecheck, keep the old code, switch, restart.
git push "$remote" "$new:refs/heads/$LIVE_BRANCH"
# Keep GitHub and the PC's branch in step, so a later rollback starts from the same code.
git update-ref "refs/heads/$LIVE_BRANCH" "$new" "$(git rev-parse "refs/heads/$LIVE_BRANCH")" 2>/dev/null || echo "note: the PC's $LIVE_BRANCH is checked out; leaving it (see the rollback notes)"
git push -q origin "$new:refs/heads/$LIVE_BRANCH" || echo "note: GitHub not updated"

for i in $(seq 1 60); do
  sleep 5
  if on_mac "curl -sf -m 5 http://127.0.0.1:\${PULSE_PORT:-8080}/health >/dev/null"; then
    running=$(on_mac 'cat ${PULSE_ROOT:-$HOME/PulseFactory}/factory/data/admin/release 2>/dev/null')
    if [ "$running" = "$new" ]; then echo "up on $new"; exit 0; fi
    echo "up, but on $running rather than $new: it may have rolled back; read data/logs on the Mac"; exit 1
  fi
done
echo "the factory did not answer within five minutes; launchd keeps restarting it. Read ~/PulseFactory/factory/data/logs on the Mac."
exit 1
