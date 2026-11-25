# Hands-off plan: every project runs, improves and fixes itself (25 Nov 2026)

Martin's goal: he never has to chat. Every project reviews, fixes and improves itself towards frontier-quality work, on the Max plan and the ChatGPT plan he already pays for.

## Where the Claude allowance goes today (measured 25 Nov)

- **About 100 scheduled Claude sessions a day across all projects.** Each one loads the full instructions and memory before doing anything. Pulse alone has:
  - the hourly watch (24 a day);
  - the improvement engine (6);
  - the director, sprint and Studio routines (about 8).

  Shared routines on top of that:
  - the bot watch (9);
  - the model tuner (12);
  - the chat archiver (8);
  - loop health (4);
  - Gmail (3);
  - the command centre and overview (4);
  - two other engines (12).

  Most runs find nothing wrong and exit. **That's the biggest waste.**

- **A few never-ending chats carry giant histories.** Every turn re-reads that history.

  | Chat             | Size   |
  | ---------------- | ------ |
  | This Pulse chat  | 574 MB |
  | A C:\Claude chat | 349 MB |
  | Leonida          | 141 MB |
  | TenderStandard   | 106 MB |
  | FORM             | 101 MB |
  | Orchestrator     | 94 MB  |
  | Sleepy           | 84 MB  |

- **Helpers often stop while waiting on their own jobs.** Then they have to be woken and re-read everything.
- **Every finished helper branch waits for a chat to merge and deploy it.** So work piles up behind a person-shaped step.

## The changes, biggest saving first

1. **Script first, Claude only when needed.**
   - The watchers become small scripts: Pulse's hourly watch, the bot watch, chat archiver, loop health, related-video links and premiere steps.
   - They read health, alerts and queues, and start a Claude session only when something needs judgement or a fix.
   - Expected: about 100 sessions a day down to about 25.
2. **Merge overlapping Pulse routines.** The daily director, growth sprint, weekly QA review and the hourly fault sweep become one daily run and one weekly run, sharing one checklist.
3. **Fresh chats daily.** Long-lived chats write a handoff note to their project (status, open work, decisions) and continue in a fresh session, instead of growing for weeks. Memory and reports hold what matters.
4. **A self-merge gate.** A helper branch that passes all of these is merged and deployed by the engine, outside upload slots, with no chat involved:
   - the full test suite;
   - typecheck;
   - a code-reviewer pass;
   - a "nothing changes when off" test;
   - a proof render where visuals change.

   New features start in check or A/B mode. They're switched on fully only when their pass mark is met, and switched back off automatically if a metric drops.

5. **Right model for the job.** Mechanical checks use small models. Building, writing and judging keep the strongest. Factory writing moves to the Max plan with a 60% weekly cap; Codex does bulk work.
6. **One owner inbox.** Everything that only Martin can do is batched into one short weekly list with one link each, instead of arriving across many chats.

## What stays Martin's (cannot be automated, by law or by safety rule)

- Money: spend limits, purchases, subscriptions.
- Passwords, two-step codes and new accounts.
- Irreversible or reputation steps: deleting videos, "Erase song", making private videos public.
- Permissions only he can grant: Mac Full Disk Access, letting one chat stop another.

## Who does what

- **Pulse (this chat):** items 1-4 for Pulse's own routines and factory.
- **The Master orchestrator chat:** items 1, 3 and 5 for the shared routines (bot watch, model tuner, archiver, loop health, Gmail, command centre), plus the owner inbox.
- **Orryy, Sleepy, Leonida, TenderStandard and FORM chats:** item 3 and their own watchers, using the same pattern once Pulse's version is proven.

Measure: Claude week used per day, and scheduled sessions per day, before (25 Nov) and one week after.

## Pulse: what was built for items 1, 2 and 4 (25 Nov)

Code is on branch claude/handsoff (factory/src/handsoff, factory/src/tools, factory/windows/handsoff). The exact switch-over steps are in factory/windows/handsoff/routines/switchover.md.

- **Item 1, the script watch.** The Windows task "Pulse watch" runs src/tools/pulse-watch.ts every 15 minutes with no model. It checks the Mac, the factory, slots, errors, stuck and failed episodes, alerts, ports, holds and the PC orchestrator. It starts `claude -p` only for a fault that is new, or still there 3 hours after its last session. At most 2 sessions per fault and 6 a day, and only critical faults once Claude's week passes 90%. Owner-only items go to the Desktop "Do when home" folder. The gate core (src/handsoff/gate.ts) has nothing Pulse-specific in it, so the Master orchestrator chat can copy it.
- **Item 2, merged reviews.** One daily review and one weekly review share factory/windows/handsoff/routines/review-checklist.md. The Studio routines keep their schedule but start with `src/tools/studio-gate.ts <kind>`, which ends the run in one line when the factory has no work for it.
- **Item 4, the self-merge gate.** src/tools/merge-gate.ts merges, typechecks, runs the full suite, checks for backspace bytes and the reviewer marker, pushes, fast-forwards C:\PulseFactory, deploys outside slot windows and rolls back on bad health.

### Every duty of the old routines and where it lives now

| Old routine | Duty | New home |
| --- | --- | --- |
| hourly watch | Health ok and recent tick | Watch script: factory-health, factory-silent (no log line for 30 min), both critical, two sightings |
| hourly watch | Alerts in discord_posts (paused, Needs you, Gave up, QA failed, failed) | Watch script: alert faults (90-minute window, cleared pairs skipped) -> fix session |
| hourly watch | Unpause when the pause is one video's content | Fix session, rule in src/handsoff/pulse-fix-rules.md (started by the "paused" alert) |
| hourly watch | Failed episodes with a technical error: fix, deploy, /admin/retry | Watch script: failed:<id> faults (content judgements excluded) -> fix session with the retry command |
| hourly watch | Same error twice in a row | Watch script: err:<cause> (same normalised error twice in 3 h) |
| hourly watch | PC test jobs failed: read log, fix, requeue at p20 | Watch script: orchfail:<id> from orchestrator history.jsonl, orch-overrun:<id> from orch status -> fix session |
| hourly watch | No restart or deploy within 30 min of a slot | Merge gate deployWindow (factory slot plan plus the fixed UK list, plus render, upload and hold-restart checks) |
| hourly watch | One-line "Pulse OK" report | decisions.jsonl line per run (no Claude) |
| hourly watch, from alerts-watch | Per new alert: fault, wrong lesson, quality warning or information; fix safe ones; queue bigger ones | Faults: watch script -> fix session. Lessons and reach warnings: daily review, checklist A4. Queueing bigger fixes: fix rules and checklist A5 |
| hourly watch | YouTube download block probe at 02, 06, 10, 14, 18, 22 | Retired: the factory's own guard probes it; the watch reads data/ytguard/state.json (yt-block warning, never worked around) |
| hourly watch | Mac disk: thin snapshots under 40 GB, report under 25 GB | Watch script thins by itself in live mode (owner's standing OK, 18 Nov); a fault under 25 GB -> fix session (du, delete nothing) |
| hourly watch | Long-slot check every run (long failures, refused topics, long slot due with nothing in progress) | Watch script: longfail:<id>, long-topic-refused, longslot:<lane>@<time>, and missed long slots |
| hourly watch | Daily fault sweep: plan against published 7 days per lane | Daily review, checklist A1 |
| hourly watch | Daily fault sweep: step failed 24 h grouped by cause, content included | Daily review, checklist A2 |
| hourly watch | Daily fault sweep: refused pickers, empty slots, crashed renders, built-but-off switches | Daily review, checklist A3 |
| hourly watch | Fix, helper branch, merge and deploy; never only report | Daily review, checklist A5 and E (merge gate) |
| hourly watch | Fault ledger, reopen returning causes | Daily review, checklist A6; weekly review step 2 |
| hourly watch | Git safety for C:\PulseFactory | Merge gate (ff-only, patch and stash of stray changes); fix rules |
| hourly watch | Stream relay restart; live-stream eligibility check | Both marked DONE (20 Nov and 14 Nov): retired |
| daily director | Pull analytics to the PC; Monday "Changes" proposals | Daily review step 2 (pull); weekly review section D (act on Changes) |
| daily director | Alert digest and alerts.jsonl; correct wrong lessons | Daily review, checklist A4 |
| daily director | Story misses against outlets | Daily review, checklist B1 |
| daily director | Watch yesterday's videos by frames, scripts and captions against the craft list | Daily review, checklist B2 |
| daily director | Retention and subscribers per 1,000 views per format | Daily review, checklist B3 |
| daily director | Fix what is safe with tests; no deploy near slots or while busy | Daily review, checklist E (merge gate) |
| daily director | Update status.json | Daily and weekly review, checklist F |
| growth sprint | Stop after 20 Dec | Daily review step 3 ("until Sun 20 Dec") |
| growth sprint | Today's "Me" items from the war plan, plus carried-over items | Daily review step 3 |
| growth sprint | Read the sprint log and fault ledger first | Daily review steps 1 and 3 |
| growth sprint | Build, test, deploy and verify each item; .env backup | Daily review step 3 plus checklist E |
| growth sprint | Visual upgrades as half-and-half tests beside premise fixes | Daily review step 3 |
| growth sprint | Owner steps on their day | Inbox folder file, checklist F (not chat) |
| growth sprint | Append to the sprint log; new faults to the ledger | Daily review step 3, checklist A6 |
| weekly QA review | Pull /admin/qa-notes for 7 days (now from the Mac, not the old PC address) | Weekly review, checklist C1 |
| weekly QA review | Group and count; worth fixing at 2+ Shorts, a failure or a paid retry | Weekly review, checklist C2 |
| weekly QA review | Fix the cause with a comment and a test; render stills for visuals | Weekly review, checklist C3 |
| weekly QA review | Typecheck, tests, commit, push, restart when idle | Merge gate (the old PC restart script is obsolete since the Mac move) |
| weekly QA review | Never weaken fact or rights checks; no .env secrets, tokens or migrations | Checklist C3 and Never |
| weekly QA review | Report with counts | Weekly review report |
| (new) | Is the watch itself right: sessions, exhausted faults, false alarms | Weekly review step 4 |
| improvement engine | Look, pick, build, prove, log, judge | Unchanged |
| improvement engine | Ship (merge, ff, deploy, health) | Merge gate (switchover.md step 5), plus a pending-deploy check at the start of each run |
| related videos, A/B tests, premieres, community | Studio work in Brave | Unchanged, but each run starts with studio-gate.ts and ends in one line when there is no work. Work that never changes is let through once a day after three runs |
| weekly improvement (Thu), frontier check (Wed) | Experiments and creator benchmark | Unchanged: they plan and judge rather than fix, so they don't overlap the reviews |
