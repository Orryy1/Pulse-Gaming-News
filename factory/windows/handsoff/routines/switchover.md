# Hands-off switch-over for Pulse (prepared 25 Nov 2026)

Everything below is ready; nothing in it has been switched yet except the shadow-mode Windows task. Do the steps in
order. Each says what to check before going on.

## 0. Before: merge claude/handsoff

It carries src/handsoff/_, src/tools/{pulse-watch,studio-gate,merge-gate,slotplan}.ts, windows/handsoff/_ and tests.
It changes no factory behaviour (nothing in the factory imports these files), so the deploy is a no-op for the Mac.
Ship it through the gate itself: `node --import tsx src/tools/merge-gate.ts claude/handsoff` (from the handsoff
worktree, D:\pulse-data\scratch\wt-handsoff\factory, until C:\PulseFactory has the gate).

## 1. Shadow (running since 25 Nov ~16:00)

The Windows task "Pulse watch" runs `windows/handsoff/pulse-watch-run.cmd shadow` every 15 minutes from the handsoff
worktree. It logs to D:\pulse-data\handsoff\pulse-watch\decisions.jsonl and keeps every prompt it would have sent in
sessions\. Count the would-be launches:

    node -e "const l=require('fs').readFileSync('D:/pulse-data/handsoff/pulse-watch/decisions.jsonl','utf8').trim().split('\n').map(JSON.parse);console.log(l.length,'runs',l.filter(x=>x.wouldLaunch).length,'would-launch')"

Check each would-launch against what the old hourly watch reported for the same hour (list_task_runs
pulse-hourly-watch): every real problem the old watch found should be a would-launch; a would-launch the old watch
called fine is a false alarm to fix in src/handsoff/pulsewatch.ts first.

## 2. Go live with the watch

1. Point the task at the live checkout and live mode:
   `C:\PulseFactory\factory\windows\handsoff\register-pulse-watch.cmd live`
2. Disable the old hourly watch: scheduled task `pulse-hourly-watch`, enabled false. Edit its description to
   "RETIRED <date>: replaced by the Windows task Pulse watch (src/tools/pulse-watch.ts)". Leave its SKILL.md: the
   fix rules now live in src/handsoff/pulse-fix-rules.md.
3. Next run: decisions.jsonl shows mode "live"; `schtasks /Query /TN "Pulse watch"` shows the live command.
   Roll back: `register-pulse-watch.cmd shadow` and re-enable pulse-hourly-watch.

## 3. Merge the reviews

1. Create scheduled task `pulse-daily-review`, cron `30 9 * * *`, prompt = windows/handsoff/routines/pulse-daily-review.md
   (without the front matter), description from its front matter.
2. Create scheduled task `pulse-weekly-review`, cron `45 10 * * 1` (Mondays 10:45: after the Mac's
   09:00 analytics job and after the 09:30 daily review, so the two never overlap). Prompt = pulse-weekly-review.md.
3. Disable `pulse-daily-director`, `pulse-growth-sprint` and `pulse-weekly-qa-review`, each with description
   "MERGED <date> into pulse-daily-review / pulse-weekly-review (see reports\Hands-off plan.md)".
4. In the old hourly watch (already off), nothing to do: its daily fault sweep is section A of the checklist.

## 4. Gate the Studio routines

Add this paragraph at the top of each prompt (after the launch-week line), with <kind> = related
(pulse-related-video-links), abtest (pulse-studio-abtest), premieres (pulse-premiere-steps), community
(pulse-youtube-community):

> **Work check first (25 Nov 2026):** before loading any browser tools, run this one Bash command:
> `cd /c/PulseFactory/factory && node --import tsx src/tools/studio-gate.ts <kind>`. If it prints a line starting
> NONE, finish with that line and call no other tool. If it prints ERROR, stop and report that line (the factory is
> down). If it prints WORK, or the command cannot run at all, carry on with the steps below as before. This one
> command is the only exception to "browser tools only".

Check: the next run of each ends in one line when there is nothing to do (D:\pulse-data\handsoff\studio-gate\decisions.jsonl
gets a line per run).

## 5. The improvement engine ships through the gate

In `pulse-improvement-engine`, replace step 5 (SHIP) with:

> 5. SHIP. Ask the code-reviewer agent to review the branch's diff and fix what it finds; then add a commit (or amend
>    your last one) whose message contains "code-reviewer reviewed". Then run
>    `cd /c/PulseFactory/factory && node --import tsx src/tools/merge-gate.ts claude/engine-<short-name>`.
>    It merges into claude/stage, typechecks, runs the full suite, checks for backspace bytes, pushes, fast-forwards
>    C:\PulseFactory, deploys only outside the 30 minutes before a slot and never while the Mac renders or uploads,
>    checks health and rolls back by itself. Exit 0: shipped. Exit 3: merged, deploy waiting (the next run starts with
>    `node --import tsx src/tools/merge-gate.ts --deploy-only`). Any other exit: read its last line, fix, run it again;
>    the same refusal twice means stop and log it. Before an .env change on the Mac, back up .env as .env.bak-YYYYMMDDx.

And add at the start of EACH RUN: "0. If D:\pulse-data\handsoff\merge-gate\pending-deploy.json exists, run
`cd /c/PulseFactory/factory && node --import tsx src/tools/merge-gate.ts --deploy-only` first."

## Measure

Scheduled Claude sessions per day for Pulse, before (25 Nov) and a week after: hourly watch 24 -> fix sessions (shadow
estimate in the report; cap 6), director + sprint 2 -> 1, QA review 1/week -> folded into the weekly review, Studio
routines 7/day -> about 7 short NONE runs plus the ones with work.
