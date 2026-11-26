# Pulse improvement log

One entry per improvement-engine run (scheduled task pulse-improvement-engine, every 4 hours). Newest first. Each entry says what changed, the evidence, the setting, and how and when it will be judged. Verdicts are added under the entry when they are made.

## 26 Nov 2026, 10:30 UK: half the news slots skip "nothing known" and shopping stories

**Change:** before the editor picks a news slot's story, a model-free check reads each candidate's headline. On the "gate" side of a 50/50 split by slot time, a story whose whole point is that nothing is known or confirmed, a price, preload, bonus or edition list, patch notes or an outage is dropped, unless the headline also carries a conflict or a surprise (layoffs, a delay, a lawsuit, a price rise or cut, a shutdown, a record). A slot where every candidate would go keeps them all, so no slot is left empty. Breaking news, big stories and the other lanes are untouched. Each gated slot logs a `premise_gate` event (arm, slot, what was dropped). Branch `claude/engine-premisegate` (737278084), merge gate: typecheck clean, 3,526 of 3,526 tests pass, stage 6f41104bb, **deployed 10:52 UK**, factory healthy.

**Evidence:**

- Frontier check 25 Nov (queue item 47): 7 of the 10 lowest-marked Shorts were this kind of story (presets unconfirmed, a New Zealand switch unconfirmed, a bonus cutoff, a preorder price, a track list, patch notes, outage reports). An "unconfirmed" story with a real conflict marked best, so the test is conflict or surprise, not the word.
- Replay over 82 news Shorts published 26 Oct to 23 Nov (`src/tools/premise-replay.ts`, headlines only, as the live gate reads them): the 9 it would drop had median 87 views against 159 for the 73 it keeps. Their average viewed share was higher (70% against 62%), so the pass mark watches both views and how long people stay.
- code-reviewer: wiring correct and share 0 changes nothing. It found real false positives in the first patterns (price hikes, "Switch 2 Edition" reveals, "sales are down", "Update 2.0 overhauls", "no sign of slowing"); all fixed and now tests. Typecheck clean; 8 rule tests and 3 slot tests new; full suite 3,524 of 3,524 before the review fixes.
- No on-screen change, so no frame review was needed.

**Setting:** `STORY_PREMISE_GATE_SHARE=0.5` in the Mac `.env` (backup `.env.bak-20261126a`); default 0 (off); 1 gates every news slot.

**Judged:** on 10 Dec, or at 20 news Shorts a side. The slot is the unit (dropped stories stay eligible and can be made in a later "open" slot; the event's dropped headlines show when that happens). Pass mark: news Shorts from "gate" slots get median views no lower than "open" slots, and an engaged rate (stayed to watch) 5 points higher. If gated slots are worse, set the share to 0; if better, set it to 1.

**Also looked at, not changed:**

- TikTok "failed 22 times in 24 hours": one Short ("ep_20261125_d007d47a") that Buffer could not fetch from its link, retried every 15 minutes for 10 hours, then posted at 09:41. Already cleared; no build.
- Evergreen 0 of 4 and 23 ranking fact-check failures: owned by `LONG_FACT_DISCIPLINE` (live since 25 Nov 19:01, first ranking repaired). The "reading 'primary'" crash on 2 news Shorts: stacks are now logged, waiting for the next one.
- Core numbers: 7-day views about 5,900, half the usual week, caused by the 24-25 Nov writing outage (few videos out), not by an engine change. No revert.

## 26 Nov 2026, 07:00 UK: a due "why" slot gets one production seat, and the GTA File back in order

**Change:** selection stops while 2 Shorts are mid-production (MAX_PRODUCING). A "why" slot whose window is open may now start one Short past that limit, inside the day's Shorts allowance; only the "why" lane takes the seat, and each use is a `why_seat` event. Data fix alongside it: GTA File parts 3 to 7 move from 24-28 Nov to 26-30 Nov. Branch `claude/engine-whyseat` (014f985f9, c741f778d), stage 735120b3a, **deployed 07:05 UK**, factory healthy.

**Evidence:**

- Output audit (25 Nov): "why" 9 to 10 of 21 planned slots went public in 7 days. "Why" Shorts convert about 6 times better than news Shorts.
- Slot by slot since 21 Nov (slots 12:00, 18:30, 22:00): 24 Nov lost 18:30 and 22:00, 25 Nov lost 18:30. Factory log, 25 Nov: every selection tick from 17:16 to 19:01 UK said "waiting: 2 Shorts are already in production", the whole 18:30 window. The status file also records big stories missed on 24 Nov "while 2 Shorts were already in production".
- The 18:30 slot is the GTA File's. Parts 3 (24 Nov) and 4 (25 Nov) never started, and parts are matched by date, so they were lost for good. Tonight's part 5 brief told the writer to open with "GTA File, part 5" and a callback to a part 4 nobody saw. Now part 3 runs tonight, with its recap of part 2 (which aired on 23 Nov).
- Real replay as a test: the 25 Nov situation (two Shorts busy, 17:16, a planned 18:30 topic) now starts the Short for 18:30; it is still one seat (the next tick waits), off with the setting, nothing past 3 busy, nothing when no "why" slot is open, nothing past the allowance. Typecheck clean; merge gate 3,504 of 3,504 pass (6 new, tests/why-seat.test.ts). code-reviewer: no blockers; its first point fixed (fatal errors still announced).
- No on-screen change, so no frame review was needed.

**Setting:** `WHY_SLOT_SEAT` (on by default; `false` restores the old wait). No .env change.

**Judged:** by 3 Dec. Pass mark: at least 19 of 21 "why" slots picked in the week (from about 16), `why_seat` used at least once, and no rise in Shorts failing on media or render time-outs. If Shorts fail or slots run late because of the extra Short in production, set it to false.

**Judged this run:** FACT_REPAIR (due 26 Nov): not passed yet, extended to 28 Nov. In 7 days 22 attempts: 18 not repairable, 2 failed the recheck, 2 repaired. The 25 Nov 23:07 repair ("Ranking EVERY Half-Life and Portal Game") is voiced and due out today at 17:00; if it publishes with no comment saying a fact is wrong, it passes. It stays on (it cannot publish anything that failed its recheck). Core numbers: no drop tied to an engine change (the last one, at 03:00, has under 4 hours of data).

**Also looked at, not changed:** the PC picture checker (Ollama) went down and up 7 times in a day; that is the PC orchestrator chat's area, not changed here.

## 26 Nov 2026, 03:00 UK: the voice check stops mistaking names like "McCoy" for spelled letters

**Change:** after every voicing, the narration check's letter watch lists capitals the voice read letter by letter, logs unknown ones and posts an alert. Any word with two capitals counted, so "McCoy's line" in the Titanfall 2 Short (25 Nov) was logged and alerted as spelled out. Names built from capitalised parts (McCoy, YouTube, GameSpot, LeBron) are now left alone; real mixed-case abbreviations (LoL, WoW, PvP) are still watched. The daily digest also drops names logged before the rule. "GOG" (read G-O-G in the Cyberpunk 2077 documentary, an accepted way to say it) is on the said-as-letters list. Branch `claude/engine-namewatch` (6f54155a1, f9c26d9ed), stage 87091b5f6, **deployed 03:02 UK**, factory healthy.

**Evidence:**

- Unknown-pronunciation list on the Mac: 3 entries, HDMI (already fixed 25 Nov), McCoy (a false alarm), GOG (real, now on the letters list).
- Real take, proof: the Titanfall 2 voice (ep_20261125_d007d47a) transcribed on the Mac, 165 words. Old watch: flags "McCoy's" (held 27.76 to 28.76 s before a pause). New watch: flags nothing.
- Typecheck clean; merge gate 3,492 of 3,492 tests pass, 6 new (tests/letter-watch-names.test.ts). code-reviewer: no blockers; its three points (digest still showing old names, a moved doc comment, test gaps) fixed.

**Honest size:** small. It removes false alerts and keeps the pronunciation list clean so real voice faults stand out; it does not change what viewers see. Every bigger fault in this run's evidence is already built or owned by another session (long-ranking fact checks: LONG_FACT_DISCIPLINE, live since 25 Nov 19:01, and its first ranking under it repaired and voiced at 23:07; documentary fact discipline; why-lane retries exist; the "primary" crash is being watched with stacks).

**Setting:** `LETTER_WATCH_NAMES` (on by default; `false` restores the old watch). No .env change.

**Judged:** by 3 Dec. Pass mark: no name-shaped token added to data/admin/pronunciation_unknown.json or the alerts, and spelled tokens still caught (at least one real flag in the week, or none voiced). If a real fault was missed because of the rule, set it to false.

**Also looked at, not changed:**

- Two GTA 6 gameplay Shorts (the owner's own footage) wait for a manual tap, one since 24 Nov 06:11; two expired unanswered on 17 and 19 Nov. Manual approval is the owner's rule (radio and Content ID), so not changed; queued as item 56 for the weekly owner list.
- Older changes: SHORT_PARALLAX_SHARE (29 Nov), DEMAND_STALE_DAYS and SHORT_CLIP_EDGE_TEXT (27 Nov), LONG_WEEKLY_AFTER_TARGET (28 Nov): not due. Core numbers: no drop tied to an engine change, nothing to revert.

## 25 Nov 2026, 23:00 UK: Friday's long video is still picked once the day's Shorts are made

**Change:** once the day's Shorts allowance (5) was used, the selector only tried the documentary and the long ranking. Friday's long video (the round-up of the week's Shorts, or the explainer on test weeks) sat inside the weekly lane, which also makes Shorts, so it was never tried past the allowance and its 20:00 slot could pass empty. It is now its own picker, tried in its usual place and again after the allowance. Same keys and the same once-a-day marker, so it can't make two and spends no extra model calls. Branch `claude/engine-weeklylong` (f6652ff0a), merged into `claude/stage` (b5123c2a3) and `C:\PulseFactory`. **Deploy waiting** (the 23:30 slot was within 50 minutes; the next run finishes it with `--deploy-only`).

**Evidence:**

- Queue item 54, written by tonight's fix session when it moved the documentary and long ranking past the allowance (969f362f9) and left the Friday long video out. Weekly output audit tonight: weekly 0 of 3 public, longform 1 of 3.
- Shorts made ahead for a slot count on their slot's day from midnight (countToday), and the 20 Nov ledger row shows the long pickers stop after the 5th Short. Honest note: I found no Friday that has lost its long video to this yet (on 20 Nov the explainer was picked at 12:02, inside the launch-week allowance of 8); this closes the gap before it costs one.
- 3 new tests: picked past the allowance on a Friday at 16:00 UK, slot 20:00, only one made; setting off gives none (the old behaviour); still made by the weekly lane in its usual place and never on a Thursday. A fresh-eyes review found no behaviour change on the normal path; its line-ending and test-precondition notes are fixed.
- Typecheck clean; 3,460 of 3,460 tests pass (merge gate run).

**Setting:** `LONG_WEEKLY_AFTER_TARGET` (on by default; `false` restores the old behaviour).

**Judged:** on Sat 28 Nov morning (after Friday 27 Nov). Pass mark: a weekly long video (round-up or explainer) selected on Friday 27 Nov in the factory log ("weekly recap video selected" or "weekly explainer selected"), and none doubled. If none was picked although the window opened, find out why before the next Friday.

**Judged this run:** nothing due (DEMAND_STALE_DAYS and SHORT_CLIP_EDGE_TEXT 27 Nov, SHORT_PARALLAX_SHARE 29 Nov, ENDING_FORMS_SHARE at 20 a side). Core numbers: 3 published in 24 hours, up from 1; no engine change to revert. Also seen: the pending deploy from 21:12 (vision shrink, long videos past the allowance) still waits because the Mac is rendering; voice spelled out "McCoy" and "GOG" (logged to pronunciation_unknown.json).

## 25 Nov 2026, 18:35 UK: documentaries keep their finished chapters when the factory restarts

**Change:** a documentary writes an outline, then each chapter in turn (about 10 to 25 minutes a chapter on Codex). Until now every factory restart, and any timeout, started it again from the outline and threw the written chapters away. The outline and each finished chapter are now saved on disk as they are made (`data/doc_checkpoints/<episode>.json`), and a re-run of the same episode and topic carries on from the next chapter. A finished script removes the file. A failure about the script's content after all chapters are written also removes it, so a failed script is written afresh rather than repeated; a timeout keeps it, so the retry goes straight to the intro and outro. Retrospectives and "every game" videos are left out (their outline step stores extra state that a resume would lack). Branch `claude/engine-doccheckpoint`, commits 7a435d030 and bb9e11320, merged into `claude/stage` and `C:\PulseFactory`, and **deployed 19:01 UK on 25 Nov** (between the 18:30 and 20:00 slots, uploads_active 0; /health fine afterwards). The second commit only restores line endings the first one had flipped across pipeline.ts and .env.example (no code change; net diff 623 lines).

**Evidence:**

- Today's factory log on the Mac for the Wednesday documentary (Cyberpunk 2077, ep_20261125_87abc5a2): chapter 1 was written five times (12:45, 13:47, 16:23, 17:40, 18:33), chapter 2 three times and chapter 3 once. Six of its nine chapter writes, roughly two hours of writing, were thrown away by restarts (16 today) and one Codex failure at 14:39, and it missed its 19:00 slot (fault ledger, 25 Nov).
- With this change the same day would have kept chapters 1 to 3 by 16:56 and carried on from chapter 4 after the 17:40 restart.
- 9 new tests: a run cut off at chapter 4 resumes there with no new outline and chapters 1 to 3 not written again; setting off changes nothing; a content failure after the chapters starts afresh; a timeout in the intro and outro keeps every chapter; a chapter dropped as a note is not written again and the order holds; too-old, other-topic, other-episode and broken files are ignored; re-planned topics get a new key.
- A fresh-eyes review found four real gaps in the first version, all fixed with tests: resumed chapters lost their open-loop links (plans now point back at the outline's own entries), retrospectives would have lost their sections (now excluded), two drop paths weren't saved, and a timeout after the chapters still threw them away (now only content or fatal failures clear the file).
- Typecheck clean; 3,389 of 3,389 tests pass.

**Setting:** `DOC_CHAPTER_CHECKPOINT` (on by default; `false` restores the old behaviour), `DOC_CHECKPOINT_HOURS` (36). Each resume logs "documentary resumed from checkpoint" and a `doc_checkpoint_resumed` event.

**Judged:** after the next two documentaries or by 9 Dec. Pass mark: no chapter written twice for the same documentary in the factory log after a restart (count "documentary chapter written" per episode and chapter), at least one `doc_checkpoint_resumed` event, and no documentary missing its slot for chapter rewrites. If a resumed documentary's script fails a check that an uninterrupted one would pass, switch it off.

**Judged this run:** nothing due. ENDING_FORMS_SHARE was deployed at 15:31 today; no forms-side Short has published yet. FACT_REPAIR verdict stays as logged at 15:00. Core numbers: 1 published in 24 hours (the YouTube fetch pause and the Claude API limit, both logged by other sessions); no engine change to revert.

## 25 Nov 2026, 15:00 UK: half the Pulse Check Shorts stop saying "My verdict:" and end like a person would

**Change:** a 50/50 test, by episode. On the "forms" side a Short that would end on the Pulse Check skips the spoken segment, and its take ends on one of four closing forms instead: a callback to the hook, a consequence for the viewer, a dry punchline or a plain closing fact. No form is handed out more than twice a day, and a retry keeps its form. A draft that still says "My verdict", "My call", "Bottom line:", "Verdict:", "My take:" or "Pulse check" aloud goes back to the writer. The other side is unchanged. Writers' room Shorts already skip the Pulse Check, so they are not in the test. Branch `claude/engine-endings` (81179e241), merged into `claude/stage` (e43329c8f) and `C:\PulseFactory`.

**Evidence:**

- Frontier check this morning: "sounds human" is Pulse's widest gap (2.9 against 6.6 for human breakouts, blind marks) and it tracks average viewed (0.25 on 72 Shorts). The blind judges named "My verdict:" in about half their notes.
- Last 7 days on the Mac: 13 of 30 published Shorts said "My verdict:" aloud, every one of the 13 that ended on the Pulse Check, including "why" Shorts (NEWS_SEGMENT_SERIES is on). The new check catches all 13 and flags none of the other 17 (proof tool `src/tools/ending-forms-proof.ts`).
- At a share of 0.5, 7 of those 13 would have changed; replayed by day, no form came up more than once a day.
- A fresh-eyes review found 6 issues: the lead-in check would have flagged ordinary lines ("On the call, Take-Two said", "Sony made the call."), missed "Here’s my take" with a curly apostrophe, "My take:" and a mid-take "Verdict:", recorded the form as if delivered, and lost the form on a retry after 24 hours. All fixed, each with a test case; the record now says `form_asked`.
- 13 new tests. Typecheck clean. The full suite passed 3,261 of 3,261 before the review fixes; the fixes touch only the new module and its tests, which pass.
- Not yet proven live: no Short has been written on the forms side (no model calls spent on a sample, since Claude's API is at its monthly limit and Codex is timing out on some steps today).

**Deployed:** the code went live with another session's deploy of 9dfd41cb8 (which contains this commit); `ENDING_FORMS_SHARE=0.5` added to the Mac `.env` (backup `.env.bak-20261125p`) and the factory restarted at 15:31 UK, between the 15:00 and 16:30 slots with no uploads running. /health fine afterwards.

**Setting:** `ENDING_FORMS_SHARE` (default 0, no change); 0.5 on the Mac. Each Short in the test carries `script.ending` (`arm`, `form_asked`, `lead_in`) and an `ending_forms` event (count distinct episodes, not events).

**Judged:** at 20 Shorts a side, or at the next frontier sitting (2 Dec), whichever is later. Pass mark: the blind "sounds human" mark at least 1.0 higher on the forms side, and average viewed no more than 2 points lower. If it fails, set the share to 0; if it passes, set it to 1. Also check `lead_in` is false on at least 9 in 10 forms-side Shorts.

**Judged this run (the engine had not run since 20 Nov: Claude's weekly limit stopped all routines from 21 Nov):**

- CODEX_GRAMMAR_FALLBACK (due 21 Nov): **pass, kept on.** No "compiled grammar is too large" failures in the factory log from 20 to 25 Nov, 27 calls routed to Codex with the "too big for Claude" note, and 4 room-written Shorts published in the last 7 days.
- FACT_REPAIR (due 26 Nov): **missed its pass mark, kept on.** 21 attempts since 20 Nov, all on long "Ranking EVERY" scripts: 18 not repairable (too many blockers), 2 failed the re-check, 1 mended (Half-Life, 22 Nov) that still failed later. No video saved. It costs nothing and harmed nothing, so it stays on; the real fix is LONG_FACT_DISCIPLINE, being built today on `claude/longfacts` by another session.
- DEMAND_STALE_DAYS and SHORT_CLIP_EDGE_TEXT (due 27 Nov), ELEVENLABS_BALANCE_STALE_HOURS (4 Dec): not due.
- Core numbers: 0 published in the last 24 hours, but the fault ledger puts that on the YouTube download pause, parked Shorts holding the cap and the Claude API limit, all fixed or being fixed by other sessions today, not on an engine change. Nothing to revert.

## 20 Nov 2026, 18:35 UK: no build this run; why long rankings keep failing their fact-check (queued as item 45)

**Change:** none shipped. Claude's week was at 89% (one point under the engine's report-only line), the 19:00 to 19:30 gap was the only deploy window before the 20:00 and 21:00 slots, and the one small item ready to build (a reworded failed long topic coming back) had already been fixed by another session today (6ecafb48a and 78ff82f0c on `claude/stage`). A careful fix for the fault below needs a writer change, tests and a fresh-eyes review, so it is queued rather than rushed.

**Evidence (factory log and `fact_repair` events, 20 Nov):**

- All four "fact-check still failing after a rewrite" failures today were the same long ranking, "Ranking EVERY Half-Life and Portal Game" (ep_20261120_37fa9031, 595dbd8a, f439862d, ff70a139), about an hour of writing each. No long video has been made from it.
- Fact repair fired on all four and saved none: three "not_repairable" (2, 7 and 5 blockers) and one "recheck_failed".
- The blockers share three shapes. (1) Unsupported absolutes: "No cutscene ever takes the controls away", "It's the only gun where...", "Alyx never leaves your side", "the shooter every other shooter studied". (2) Card figures with no source: "[stat] a few hours, Story length" and "[stat] one evening, Time to finish" (no completion times are in the fact pack, and the second was a rewrite of an already rejected "three hours"). (3) Claims about the viewer: "most of you don't own one", "cheaper than most movie tickets", "you can't start it on a laptop tonight".
- Repair only edits the spoken lines. The checker flags the same claim on the moment's card too ("the card repeats it"), so even a clean cut fails the re-check, as on f439862d.

**Judged this run:**

- CODEX_GRAMMAR_FALLBACK (due 21 Nov 15:30): early pass holds. No "compiled grammar is too large" failures on 20 Nov (3 on 19 Nov before the fix); 6 calls routed to Codex with the "too big for Claude" note. Room scripts publishing (`script.room.wrote`) still 0, so that half stays unproven until the verdict.
- DEMAND_STALE_DAYS: in use, 7 picks today took an older reading (one at 18:30: "Grand Theft Auto IV, 26.3M when last measured 6 days ago"). Verdict 27 Nov.
- SHORT_CLIP_EDGE_TEXT: 6 clips dropped or trimmed today (42 on 19 Nov counting the probe); today's only QA failure was a body crop, not edge text. Verdict 27 Nov.
- ELEVENLABS_BALANCE_STALE_HOURS: no "balance unknown" failures and no stale reading needed yet. Verdict 4 Dec.
- Core numbers: 4 published in 24 h, factory healthy; no sign of a 20% drop to revert.

## 20 Nov 2026, 10:35 UK: a restart during an ElevenLabs hiccup no longer stops the narrator

**Change:** before every narration the factory asks ElevenLabs how many characters are left this month and refuses if it can't tell. It already kept the last answer in memory for 2 hours, but every restart wiped it (the factory restarted 14 times on 20 Nov alone). The balance is now also kept on disk (`data/elevenlabs_balance.json`), and each job's characters come off it. When the check goes unanswered and memory has nothing, a reading kept on disk stands in if it is under 12 hours old, less an assumed 50,000 characters a day of spend the factory can't see. A reading from disk pays for the job only: no re-voiced takes and no hook takes. A rejected key never falls back. Branch `claude/engine-balance`, commit f510350b2, merged into `claude/stage` (485b16f80) and **deployed 10:52 UK on 20 Nov**; /health fine afterwards, uploads_active 0.

**Evidence:**

- 18 Nov, 15:26 to 19:04 UTC: 14 step failures, all "no narrator available (ElevenLabs balance unknown)". Five Shorts were lost (ep_20261118_1a37bafb, 3297d396, cc193e76, b65753e7, b6e1069d), with about 619,000 characters left. In the same window two other Shorts were voiced by ElevenLabs without trouble (18:07 and 18:37). Voicing worked; only the balance check was failing.
- Cause: the factory restarted at 15:12 and 15:34 while the subscription check wasn't answering. That wiped the memory reading from the 14:32 narration, and nothing else was left.
- Replayed against the new rule: the 14:32 reading would have been 1 to 4.5 hours old at each failure, with about 600,000 characters estimated against the 11,080 a Short needs. All 14 attempts would have been voiced.
- Proof on the Mac against the real account: a live read (613,743) was kept on disk. With the API cut off and memory wiped, the same read 4 hours later returned 605,409 from disk, enough for a Short. With the setting at 0 it returned nothing, the old behaviour.
- A fresh-eyes review found four real gaps in the first version, all fixed with tests. (1) "No extra takes" was passed as "no limit" to the long-video voicer. (2) Spend from re-voices, hook takes and failed jobs was never counted; each job's maximum spend is now counted, even when it fails. (3) Jobs finishing together could lose a spend; file writes now take turns. (4) The window was cut from 24 to 12 hours.
- 16 new tests, including two full narrations through a stand-in ElevenLabs: a Short, and a long script that is confirmed to get no re-voices. Typecheck clean; 2,944 of 2,944 tests pass.

**Setting:** `ELEVENLABS_BALANCE_STALE_HOURS` (default 12; `0` restores the old behaviour). Uses show in the log as "ElevenLabs balance: older reading used" and as an `elevenlabs_balance_stale` event.

**Judged:** by 4 Dec. Pass mark: no "no narrator available ... balance unknown" step failures while a disk reading under 12 hours old exists. ElevenLabs must never go into overage: if the monthly bill shows any usage-based charge, switch it to 0 straight away. Note: no real outage may come in two weeks; then the verdict is "kept, unproven live".

**Not changed, noted:** jobs running at the same time are each checked against the full balance (true before this change too); with over 600,000 characters left it can't matter this month. Added to the queue. Also, C:\PulseFactory has another session's staged, uncommitted edits to four files (codex.ts, llm.ts, lanes.ts, pipeline.ts, plus two deleted tests), so it couldn't be fast-forwarded. I deployed commit 485b16f80 straight from the stage worktree instead and left those edits alone.

**Judged this run:** nothing due. CODEX_GRAMMAR_FALLBACK: still no "compiled grammar is too large" failures since 19 Nov 13:26 (full verdict 21 Nov). FACT_REPAIR, SHORT_CLIP_EDGE_TEXT and DEMAND_STALE_DAYS have not fired in today's log yet. Core numbers: too soon after the 07:29 change to compare.

## 20 Nov 2026, 07:00 UK: clips whose subtitles the Short's crop would slice are caught before the render, not after it

**Change:** a Short shows a 16:9 clip zoomed in (1.24 times, a little more during the punch at each cut) so the bottom tenth, where burned-in subtitles live, is hidden. Subtitles set a little higher sit right on that edge and come out sliced in half. The clip text screen only looked for big lettering, read at 960 pixels wide, where subtitle-sized text is unreadable. Now it also reads the top and bottom fifth of each clip at up to 2160 wide and counts any word the zoom would show only in part. A clip with such words is cut to its clean stretch or dropped before the render, as big trailer text already is. The Short library's single-frame check does the same. Long videos show the whole picture, so they are untouched (including the cutscene search, which a fresh-eyes review caught). Branch `claude/engine-edgetext`, commits 107f11151 and 47fba20c1, merged into `claude/stage` and **deployed 07:29 UK on 20 Nov**; /health fine afterwards, uploads_active 0.

**Evidence:**

- 19 Nov: final QA rejected four renders for clipped text. Two were the Short's own cards and ticker (ep_20261119_1ced6ff3, ep_20261119_f82c3330; not addressed here, added to the queue). "GTA 6 Xbox prices start at $79.99" (ep_20261119_3fac5cb6) failed twice on "a source-video subtitle cut off along the bottom edge" (the QA frame shows "on plastic surgery for his dog's droopy..." sliced at the bottom) and was never published. Each failed attempt costs a full render (about 20 minutes) and the Short's slot when it runs out of tries.
- Probe on the Mac's GTA 6 library (Apple's on-device text reader): at 960 wide the reader found almost none of the in-game subtitles and social-feed lines near the bottom; at full width it found them on the crop line ("Someone call the department of", "PlanetLeonidaMan Follow").
- Old against new screen on 74 real 3-second segments from the GTA 6 and GTA V libraries, cut the way the library cuts them: 3 newly dropped, two with in-game social-feed text on the crop line and one on an OCR scrap ("TNI"); nothing else changed. Usable footage 123 to 116 seconds (about 6% less).
- Fresh-eyes review fixes taken: long videos' cutscene search no longer gets the check; the side window matches what the zoomed crop shows (with slack for the smart crop); frames and strips share one OCR run, so the cost is one extra ffmpeg pass per clip. A frame of one dropped segment, cropped as the Short shows it, has "...idaMan Follow" sliced at the bottom edge.
- 9 new tests (crop-line maths, punch, portrait clips, the strip mapping, the setting, the zoom kept equal to the renderer's). Typecheck clean. 2,919 of 2,921 tests pass after the fixes; the two failures ("community posts" and the search-lane test) fail the same way on untouched stage.

**Setting:** `SHORT_CLIP_EDGE_TEXT` (on by default; `false` restores the old screen). Dropped and trimmed clips show in the log as "clip dropped: big text on screen" / "clip trimmed", with the words.

**Judged:** by 27 Nov. Pass mark: no QA failure that names subtitles or text cut off at the frame's edge on source footage (there were 2 on 19 Nov), and no rise in "footage gate: no moving footage" holds (count before and after). If the footage gate starts holding Shorts because too many clips are dropped, switch it off and narrow the check to the bottom edge.

**Judged this run:** nothing due. No topic pick (DEMAND_STALE_DAYS) or ranking fact-check failure (FACT_REPAIR) has happened since this morning's deploys, and there have been no "compiled grammar is too large" failures since 19 Nov 13:26 (CODEX_GRAMMAR_FALLBACK, full verdict 21 Nov). Core numbers: too soon after the 03:31 change to compare.

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
