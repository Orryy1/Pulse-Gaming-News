# Writers' room: reference spec (19 Nov 2026)

This is the process that was tested by hand on 24 published stories. The build should reproduce it step for step. Wording of the prompts may be tightened, but the content of each step must stay.

## Why it exists

- Blind judges scored 24 published Shorts at about 3.9 out of 10. An editor's loop using only the facts already in each script reached 6.9. What still held those back was the material: no real reason, no quote, no surprising detail, a weak premise.
- On the channel's own 54 Shorts with 100+ views, the script features linked to retention and views (two blind readers, agreement 0.82): one point all the way through (strongest), a conflict or party at fault, sounding human, clarity on one listen, a concrete payoff, and specific names, numbers and quotes that carry the point. A stated opinion on its own showed no link. A late answer only helps when the hook is strong and the answer is real.
- The live writer brief stacks a great many rules (hook shapes, take shapes, skeletons, desk question, Pulse check, loop question). The room is a clean, separate path with a short brief; it does not add to that stack.

## Step 1: the fact pack (one model call, plus optional link following)

Built from the cluster's fetched articles, the Fact Vault note and, where available, primary sources linked from those articles. Fields:

- `what_happened`: two plain sentences with the date.
- `the_why`: the actual reason, as stated by someone with standing, with the source URL; or "no stated reason" plus the best-evidenced explanation and who offers it.
- `quotes`: up to 3, verbatim, 15 words or fewer, with speaker, role, outlet, URL. A quote that is not found word for word in a fetched source text is dropped by code, not by the model.
- `numbers`: up to 4 hard numbers with source URL, each with a spoken form rounded the way a person says it.
- `surprise`: the least-known, most counterintuitive true detail (an earlier promise this contradicts, a detail in the fine print, a number that reframes it), with source. The most valuable field.
- `stakes_for_player`: what changes for someone who plays or buys this.
- `fan_argument`: what players are arguing about, both sides in a line each (from the cluster's Reddit items and comments when present).
- `callback`: one earlier event that makes this story mean more (date and one line).
- `best_questions`: two questions a fan would most want answered, each with its true answer and how solid it is (confirmed / reported / speculation).
- `thin`: true when there is nothing surprising and no real reason here, with the reason.
- `unverified`: anything the sources disagree on or do not support.

In the hand test the best angles came from `surprise` and `callback`, the payoffs from `quotes` and `numbers`, and `unverified` stopped errors that had been published before.

## Step 2: the writer (one model call)

Input: the pack and nothing else about earlier drafts. Output: four angles, a kill decision, the point in one plain sentence, and three drafts.

1. Find the question. Four candidate angles. Each = the question in a fan's own words, the true held-back answer (from the pack, with how solid it is), why someone who does not play this game would still stop, and a first line. Prefer an angle with someone at fault, a broken promise, or two facts that should not both be true.
2. Kill rule. If the pack is thin and no angle has a concrete, true, held-back answer, kill the story (the slot goes back to the normal path or to another story).
3. Three drafts: A and B on the best angle with two different structures, C on the second-best angle. Structures: (i) contradiction, rule out the obvious answer, reveal, verdict; (ii) a cold fact, the odd part, escalate, reveal; (iii) open on the real quote, who said it and why it is strange, reveal; (iv) a tiny story: someone wanted something, the obstacle, the turn, the outcome; (v) the news in the hook, then hold back the catch, the reason or the consequence.

Craft rules for every draft:

- Length follows the Short's length lane (hand test: 85 to 120 spoken words).
- First sentence: 12 words or fewer, names the game or company, states a contradiction, an oddity or a claim that cannot be left alone. The viewer knows the topic at once. It does not contain the answer. No riddles, no hype words.
- Second sentence sharpens the gap. It is never background.
- Every sentence does one of five jobs: sharpen the question, rule out the obvious answer, add a concrete detail that makes the answer land harder, deliver the answer, deliver the verdict. No stall lines.
- One turn at 40 to 55% that renews curiosity with new information.
- The answer lands between 70 and 90% and is concrete. Use the real quote or the real number when the pack has one.
- After the answer: one verdict in the narrator's own voice ("I") that a viewer could disagree with, with its reason. Then stop on a last line that lands. Never end on a question, an ask, a plug or a pointer to another video.
- One point. If the point cannot be said in one plain sentence, re-angle.
- Facts only from the pack; nothing from `unverified`. Reported or speculative things are flagged in a few natural words. Second-hand quotes are attributed to the outlet that carried them. Never imply the answer is bigger than it is.
- Human: contractions, short and long sentences mixed, the game's full name once then the short form, no lists of three, no "it isn't just X, it's Y", no stiff connectives, no stock phrases, no forced "you", at most one joke and only if it follows from the line before.
- US spellings, numbers rounded as spoken, no em dashes, nothing advertiser-unfriendly.
- Title: 8 words or fewer, names the game, gives the premise and not the answer.

## Step 3: the critics (one or two model calls; they see only title and narration, never the pack or the plan)

Editor critic, per draft, 1 to 10: clarity (one plain point, easy on ONE listen, not too many names or numbers to hold), hook, payoff (held back, paid late, worth the wait), voice, human, overall; plus `swipe` (the sentence where a scrolling viewer leaves, 0 if they finish), `weakness` (the single biggest, pointing at the exact line) and `fix` (one concrete instruction). It picks the winner per story and may say even the winner should be dropped.

Viewer critic, per draft, 1 to 10: stop, stay, got_it, worth_it, comment, share, overall; plus `swipe`, `lost_me` (the exact phrase where attention drops) and `fix`.

## Step 4: the edit (edits only, up to two rounds)

The winner is revised against the critics' `fix` lines, biggest weakness first, edits only, then read again by a fresh critic call. Stop when overall is 8 or more with nothing under 7, or when a round does not improve it. Keep the best version that passed the fact check.

## Step 5: layout

The chosen narration is laid out into the normal Short script shape (hook, beats with cards and footage, take, last line, claims with source URLs) WITHOUT changing its words, so everything downstream (cards, footage, fact check, voice) works as now.

## What the room replaces and what it keeps

Replaces for its arm: the stacked writer brief's hook shapes, take shapes, skeletons, desk question, Pulse check line and loop question. Keeps: the fact check, rumour labelling, monetisation and house safety checks, attribution, cards, footage, stamps, titles' search rules.
