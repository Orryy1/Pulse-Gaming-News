# Pulse improvement log

One entry per improvement-engine run (scheduled task pulse-improvement-engine, every 4 hours). Newest first. Each entry says what changed, the evidence, the setting, and how and when it will be judged. Verdicts are added under the entry when they are made.

## 20 Nov 2026, 03:00 UK: topic picks use the last known demand when YouTube search is paused

**Change:** before a ranking Short, a "why" Short or a long ranking is picked, each candidate topic is checked against what people are watching on YouTube this week, and the editor sees the figures. When that search can't run, the factory now uses the topic's most recent stored reading, up to 10 days old, instead of picking blind. An older reading counts half against a fresh one, never drops a topic on its own and is never saved back as fresh. The editor's note and the Discord line say how old it is ("when last measured 3 days ago"). Branch `claude/engine-staledemand`, commit ce8a40813.

**Evidence:**

- From 12 to 19 Nov, 20 of the 26 topic picks went out with "demand not checked". Every GTA "why" Short from 15 to 18 Nov was picked blind, and so were all three ranking picks on 19 Nov.
- Cause: YouTube's bot check has paused the factory's anonymous YouTube fetches since 14 Nov. The current pause is the fifth strike, running 48 hours until 21 Nov about 22:19 UTC. The log shows 180 failed demand searches on 15, 16, 18 and 19 Nov, all "fetching is paused". No demand search has succeeded since 14 Nov 21:24.
- The factory still holds 96 stored readings from 14 Nov (GTA V 69.9M, GTA IV 26.3M, GTA III 13.2M, Zelda 5.7M). They were simply ignored once they were a day old.
- Dry run of the new code on those real readings (`src/tools/staledemand-proof.ts`): 6 of the 7 blind "why" picks from 15 to 18 Nov would have had a figure; only Bully, never measured, stays unknown. The 19 Nov 20:19 ranking list goes from 7 topics with no figure to a clear order: Grand Theft Auto 32.9M, Zelda 5.7M, Resident Evil 3.2M, Call of Duty 2.5M, Steam Controller 590K. The 0-view "remakes that beat the originals" sinks to the bottom.
- The default window is 10 days so the 14 Nov readings last until the pause lifts (7 days would have run out about an hour before it does).
- A fresh-eyes review found no bugs. Three of its suggestions were taken: a test that older readings are never saved back, half weight for older readings, and the old cache rule kept for timestamps. 7 new tests. Typecheck clean. 2,908 of 2,910 tests pass; the two failures ("community posts" and the search-lane test) fail the same way on untouched stage and are unrelated.
- **Deployed** 03:31 UK on 20 Nov (ce8a40813, with 13 helper commits already in stage, all off by default). /health fine afterwards, uploads_active 0.
- Tried and dropped this run: an "opening line must echo the title" check. Over 130 Shorts, openings that share no word with the title held viewers as well as the rest (median 55% viewed against 53%) and got as many views at 72 hours (median 195 against 152). So there is no case for it.

**Setting:** `DEMAND_STALE_DAYS` (default 10; `0` restores the old behaviour). The log line "demand: older readings used" counts uses.

**Judged:** by 27 Nov. Pass mark: no more than 1 in 5 picks says "demand not checked" while YouTube is paused (it was 20 in 26), and the picked topics' 72-hour views are no lower than the blind picks of 15 to 19 Nov. If a pick based on an old reading clearly misfires (a topic whose interest had already faded), cut the window to 5 days.

## 19 Nov 2026, 23:10 UK: a ranking that fails its fact-check on one or two small lines gets them mended instead of being thrown away

**Change:** when a ranking, "every game" or long ranking script still fails the fact-check after the writer's one rewrite, and only one or two lines are at fault, the factory now mends those lines itself, without a model. A rounded figure the source doesn't round gets "about" in front ("now costs about $30"). An unsupported side line ("Most lists rank GTA 5 higher") is cut: the whole sentence, or the clause before "but". It never cuts the hook, a rank line ("In third place..."), a whole beat or more than 15% of the words. The mended script is then fact-checked again, and only a clean pass saves the Short; otherwise it fails as before. Branch `claude/engine-factrepair` (5fdcaff4c, 328cfaaec), merged into `claude/stage` (328cfaaec) and `C:\PulseFactory`. **Not deployed yet:** at 23:10 the 23:30 slot, then the 01:00 and 03:00 GTA launch slots, left no safe 30-minute gap. The next run deploys it.

**Evidence:**

- Tonight three ranking Shorts in a row were thrown away over one line each, leaving the 20:00 ranking slot empty. "Ranking every 3D GTA map" at 18:13 failed on "now costs thirty dollars" (Steam says $29.99). Both GTA protagonist rankings, at 20:14 and 20:27, failed on "Most lists rank Grand Theft Auto 5 higher" and "one pick goes against the usual order" (unsupported consensus). On 14 Nov a Buy, Wait or Skip failed the same way on "two dollars" for $1.99.
- Over 7 days, 9 episodes failed the fact-check after a rewrite. 4 failed on a single line of this kind. The other 5 (the Fallout rankings) had 4 to 12 problems each and stay failed, because the repair only handles one or two.
- Last run's fix is working: no "compiled grammar is too large" failures since 15:30. The factory log shows 3 calls handed to Codex (editorial twice, room.layout once).
- A fresh-eyes code review found 11 issues in the first version (wrong figure hedged, ordinal rank lines cut, "Most critics and fans" leaving "Fans agree", comma fragments, ambiguous quotes, a vault-fix gap, and an evergreen rewrite that could skip the check). All were fixed, each with a test.
- 22 new tests, built on the real blocker texts. Typecheck clean. 2,785 of 2,786 tests pass; the one failure ("community posts") also fails on untouched stage and is unrelated.
- Not yet proven live: the second fact-check on a mended script. The next ranking that hits this will show it.

**Setting:** `FACT_REPAIR` (on by default; `false` restores the old behaviour). Each attempt is recorded as a `fact_repair` event (outcomes: repaired, recheck_failed, not_repairable, not_applied, draft_mismatch) and a log line "fact-check blockers repaired".

**Judged:** by 26 Nov. Pass mark: at least one ranking Short saved (`fact_repair` outcome "repaired", then published). Watch the comments on saved Shorts: any comment saying a saved Short got a fact wrong switches it off. Also count Shorts lost to "fact-check still failing after a rewrite"; it should drop from about 4 a week.

**Judged this run:** CODEX_GRAMMAR_FALLBACK (15:30): early pass. There have been no grammar failures since, and the router is handing those calls to Codex. Room Shorts publishing with the room's script (`script.room.wrote` count 0 in today's log) is still unproven. Full verdict on 21 Nov as planned.

## 19 Nov 2026, 15:30 UK: a script format too big for Claude goes to Codex instead of failing the Short

**Change:** when Claude rejects a call because its answer format is too big ("The compiled grammar is too large"), the factory now hands that call to Codex, the same way it already did when Claude hit its usage limit. It never loops back to Claude if Codex also fails, and it posts one note per step saying that step's format wants slimming. Branch `claude/engine-roomschema`, commit 9993b13bd, merged into `claude/stage` (ce1870f85).

**Evidence:**

- The GameStop/GTA 6 launch Short (ep_20261119_aeff0c03) failed three times (12:57, 13:06, 13:26 UK). The factory log shows the writers' room finished its edits, then the layout call was rejected with that 400. The room fell back to the normal writer, which was rejected the same way, so the whole Short failed. The hourly watch then set `SCRIPT_ROOM=check`, switching the writers' room off.
- Probe on the Mac (rejected requests are not billed): Claude now rejects every version of the Short script format: plain, with the payoff plan, with the desk plan and with both. So any Short script that reaches Claude rather than Codex fails, not only the room's. Until now the router moved only usage-limit errors to Codex, and this error is not one of them.
- 7 new tests use the real error text: Codex answers when the setting is on, the error stands when it is off, there is no loop when Codex fails too, other errors are untouched and picture calls follow CODEX_VISION. Typecheck clean; 2,692 of 2,693 tests pass. The one failure ("community posts", engage.test.ts) fails the same way on untouched stage and is unrelated.

**Setting:** `CODEX_GRAMMAR_FALLBACK` (on by default; `false` restores the old behaviour). `SCRIPT_ROOM` is set back to `on` (backup `.env.bak-20261119e`), so the writers' room test resumes.

**Judged:** by 21 Nov 15:30 UK. Pass mark: no "compiled grammar is too large" step failures in the factory log; the "too big for Claude" notes show which steps were routed; room-arm Shorts publish with the room's script (`script.room.wrote`). If Codex can't keep up (layouts timing out or slots missed), set `SCRIPT_ROOM=check` and slim the layout schema (queue item below).

## 15 Nov 2026, 15:30 UK: depth layers on half of Shorts' still pictures

**Change:** a Short's wide still pictures (up to 8) are cut into three depth layers by the depth model the long videos already use, and drift at different speeds, nearer layers faster, so a still moves like a camera shot instead of a flat zoom. Half of new Shorts get it, chosen by episode id; each Short records its arm (`assets.shortDepthArm`: "depth" or "flat"). Branch `claude/engine-shortdepth`, commit 11f36a805, merged into `claude/stage` and deployed.

**Evidence:**

- Sunday growth report (15 Nov) retention curves on 101 Shorts: viewers left 1.3 times as fast while a still picture was up, faster in 56 of 81 Shorts, about 24.5 seconds of stills a Short. It was the largest single cause of drop-off listed (28.1 points a Short).
- YouTube's bot check has paused footage fetching until about 18:21 UTC today, so Shorts lean on stills even more for now.
- Proof on a real published Short ("Why GTA 6 Ultimate costs $20 more", 11 of 13 shots are stills): depth layers made for 7 of its 9 pictures in 10 seconds on the Mac; the layered and flat renders took 122 and 121 seconds. No black frames. A full-resolution crop shows the building moving against the skyline with no torn edges. The layered frames differ clearly from the flat ones on every layered shot (PSNR about 25 dB), but the average frame-to-frame motion rose only 2% (1.09 to 1.11), so the effect is a felt depth rather than more movement.
- Typecheck clean; 2,366 of 2,366 tests pass, 8 new.

**Setting:** `SHORT_PARALLAX_SHARE=0.5` in the Mac `.env` (backup `.env.bak-20261115a`). `0` switches it off, `1` gives it to every Short.

**Judged:** on 29 Nov, or once each arm has 20 Shorts with retention data. Pass mark: the "depth" arm's average viewed share at least 3 points above the "flat" arm on the same formats, with the still-picture exit ratio in the retention curves lower for the depth arm. If depth is not better, set the share to 0. If it is, set it to 1.

**Also looked at and not changed:**

- Shorts thumbnail test: the report's 1.8% against 2.9% is on 8 and 23 Shorts. Re-split by episode over 118 Shorts and 112,000 impressions it is 1.95% (designed) against 2.11% (first frame), and it flips within formats. No change; the test keeps running.
- Instagram and Facebook comment replies (`META_COMMENT_REPLIES`, built and off): the "37 Facebook comments, 0 answered" in the Sunday report are the channel's own "Full story and sources" link comments. Instagram had 2 real viewer comments in its last 40 posts. Switching replies on would change almost nothing, so it stays off. The social scoreboard counting the channel's own comments is added to the queue.
- "Why" Shorts length (45 to 60 seconds): in 15 "why" Shorts with data the longer ones did not convert worse, so the queue's length idea is not backed for "why" yet.
