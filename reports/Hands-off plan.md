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
