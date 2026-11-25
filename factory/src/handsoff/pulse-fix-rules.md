These are the fixing rules of the old Pulse hourly watch (C:\Users\MORR\.claude\scheduled-tasks\pulse-hourly-watch\SKILL.md, 14-20 Nov 2026), kept for the fix sessions the hands-off watch starts. The owner, Martin, is not a coder: catch and fix problems yourself, so he never has to discover them. British English, no em dashes. Read the memory index C:\Users\MORR\.claude\projects\C--Users-MORR-gaming-studio-pulse-gaming\memory\MEMORY.md for the files that bear on your fault before acting.

Where things are

- The factory runs on the Mac mini (ssh host `pulse-mac`, ~/PulseFactory/factory, logs data/logs/factory-<date>.log as JSON lines; the logger writes to the file named after the day it started, so read the newest files by time). Code is on the PC: stage worktree C:\Users\MORR\AppData\Local\Temp\claude\C--Users-MORR-gaming-studio-pulse-gaming\1752ea3a-7250-428c-86c7-997c40c09a52\scratchpad\stage\factory (branch claude/stage), live checkout C:\PulseFactory (branch claude/epic-pasteur-7s143q).
- Admin calls on the Mac, never printing the key: `rtk proxy ssh pulse-mac 'cd ~/PulseFactory/factory && K=$(grep -E "^ADMIN_TOKEN=" .env | head -1 | cut -d= -f2- | tr -d "\"\r"); curl -s -H "x-admin-key: $K" http://127.0.0.1:8080/<path>'`.
- Useful paths: /health, /episodes, /admin/qa-notes?days=2, /admin/export?days=2, /admin/events?kinds=<k>&hours=24, POST /unpause, POST /admin/retry?id=<episode id>.

Fixing

- Story pause: if new stories are paused and the cause is one video's own content (a fact check, QA, clarity or a spoiler) rather than a real YouTube login or quota fault, clear it with POST /unpause.
- Failed episodes: a technical error (render, audio, file missing, timeout) is found in the log, fixed, deployed at a safe time, then each affected Short is retried with /admin/retry (it keeps its script and voice). The same error twice in a row is always worth fixing straight away.
- Long videos: a long slot failing, or due with nothing in progress, is never "OK". Find the cause and fix it; content failures count for long videos.
- PC test jobs: `C:\Claude\orchestrator\orch.cmd status`. A failed Pulse test job: read its log in the session scratchpad, fix it if the cause is obvious, requeue at priority 20 with --est. Don't touch other projects' jobs.
- Code fixes: on a fresh claude/<name> branch from claude/stage, with tests (`node node_modules/typescript/bin/tsc --noEmit -p .` clean and `node --import tsx --test tests/*.test.ts` green), then ship through the self-merge gate: `node --import tsx src/tools/merge-gate.ts claude/<name>` from the stage worktree's factory folder. Put "code-reviewer reviewed" in a commit message only after the code-reviewer agent has reviewed the diff and you fixed what it found. A one-line settings fix on the Mac: back up .env as .env.bak-YYYYMMDDx first, then `bash mac/deploy.sh --restart` from C:\PulseFactory\factory.
- Restarts and deploys: never within 30 minutes of a slot (UK: 12:00, 15:00, 16:30, 17:00, 18:30, 20:00, 21:00, 22:00, 23:30, plus any slot in http://pulse-mac.local:8080/orch/reservations.json), never while /health shows uploads_active > 0, never while the Mac renders. If the window is wrong, leave it merged and ready and say so.
- Mac disk: the watch script thins local Time Machine snapshots itself. If still under 25 GB, find the biggest folders under ~/PulseFactory/factory/data with du and report them; delete nothing.
- YouTube download block: never try to get round it (no cookies, PO-token plugins, client spoofing or proxies). The factory's own guard handles it.
- Bigger fixes that need more than one session: add them, ranked, to C:\Users\MORR\gaming-studio\pulse-gaming\reports\Pulse upgrade queue.md, and log the fault in reports\Pulse fault ledger.md (date, lane, cause, count, fix, status).

Never

- Never print secrets. Never make a private video public or delete videos. Never kill After Effects, aerender or Blender. Never type passwords or pass 2-step prompts. No fake engagement. Never open the live database while the factory runs.
- Never restart the stream relay while the owner is live (an ffmpeg "pipe:0" process on the Mac means he is).

Git safety (20 Nov): C:\PulseFactory has claude/epic-pasteur-7s143q checked out. Move it ONLY with `cd /c/PulseFactory && git merge --ff-only claude/stage` (the merge gate does this). Never `git push . ...`, `git update-ref` or a fetch into it. Before any commit or merge in C:\PulseFactory run `git status`; staged or modified files you didn't make go to `git diff --cached > D:/pulse-data/scratch/pulsefactory-staged-<date>.patch` and `git stash push -m "<why>"`, and you say so.
