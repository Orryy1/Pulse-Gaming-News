# Top creator gap plan

Written 18 November 2026 for Pulse Gaming. Research and planning on Fable 5.2; builds go to Opus helpers on separate branches. Nothing live was changed to write this.

## What this is

Three studies were run today and compared like for like:

- **Top Shorts creators:** 27 breakout gaming Shorts and 7 flops from the same 24 channels, plus 563 titles (`research-2026-11-18/shorts-creators.md`).
- **Top long-form creators:** 25 long videos, with Dark Space's "The Long Road" studied deepest (`research-2026-11-18/long-creators.md`).
- **Pulse's own videos:** all 86 Shorts and 3 long videos from 1 to 17 November, with retention curves for 54 Shorts (`research-2026-11-18/pulse-self-audit.md`).

It builds on the 11 November strategy research and the 4 November forensics. Those covered what to make and how often. This one covers the craft inside each video.

**How far to trust it.** Other channels' retention is private, so "hit" means views against that channel's own usual level. Seven flops is a small group. Cut counts, music changes and picture shares on other channels are the vidIQ watcher's estimates because YouTube blocked downloads. Pulse's own numbers are measured. Expected effects below are my judgement, and each build has a pass mark so it can be kept or reverted on evidence.

## The short version

1. **Polish is not the gap.** Top creators' hits and flops are edited the same: same pace, same cuts, same captions. On Pulse too, faster cuts, more footage and shorter hooks do not separate hits from flops.
2. **The gap is what happens between the hook and the end.** Every one of the 27 hits opens a question and holds the answer until late (typically 87% of the way through). Pulse states the answer on the first frame and in the title, then loses 4 points of audience a second through the facts.
3. **Top creators have a view, and say it early.** Comments follow stated opinions almost one for one (0.81). Pulse's opinion arrives at 65% of the Short, when 38% of viewers are left, and long videos never say "I" at all.
4. **Pulse looks and sounds like one template.** Same sting on 86 of 86 Shorts, same five-sound sequence on 58%, four music beds, same opening layout and closing card every time. Top creators use a quarter of the sound effects and let the game's own sound through. This is also the main risk when YouTube reviews the channel to earn.
5. **The best long videos are carried by many voices, one finish line and music that follows the story.** "The Long Road" changes speaker every 13 seconds. Pulse has one voice, one bed and openings that lose a third of viewers in 36 seconds.

## The gaps, ranked

Ranked by likely effect on views, retention and subscribers, weighed against how sure the evidence is and how cheap the fix is.

| #   | Gap                                              | Format            | Likely effect                         | Status                                           |
| --- | ------------------------------------------------ | ----------------- | ------------------------------------- | ------------------------------------------------ |
| 1   | Hold the answer back, and take a side early      | Shorts            | Retention and comments, high          | New build (helper A)                             |
| 2   | Break the template in sound and layout           | Shorts            | Earning review and swipes, high       | New build (helper B)                             |
| 3   | Long-video openings that earn the first minute   | Long              | Watch time, high                      | New build (helper C)                             |
| 4   | Rankings and commentary as arguments             | Long and Shorts   | Views and comments, high for rankings | New build (helper C)                             |
| 5   | A chorus of voices, and let the game speak       | Long, then Shorts | Watch time and feel, high but costly  | Design now, build after launch                   |
| 6   | A premise test before any "why" Short is written | Shorts            | Views, medium to high                 | Switch on what exists, then build                |
| 7   | Music cast per chapter, silence at the seams     | Long              | Retention, medium                     | After helper B; shares files with the other chat |
| 8   | Pinned comments and replies with a stance        | All               | Subscribers and comments, medium      | Bug report sent today; small build               |
| 9   | Speak faster, and pick one of two lengths        | Shorts            | Retention, medium                     | Settings test                                    |
| 10  | Moving pictures first, and no shot twice         | All               | Retention, medium, unproven on Pulse  | Switch on what exists                            |
| 11  | One promise in the packaging                     | Long              | Clicks, medium                        | Switch on what exists                            |
| 12  | A "Long Road" style series on GTA VI             | Long              | Reach, uncertain; craft benchmark     | Plan after the 21 Nov documentary                |

### 1. Hold the answer back, and take a side early (Shorts)

**Evidence.**

- 27 of 27 hits plant an open question; 2 of 7 flops do. The payoff lands after 60% of the runtime in 22 of 27 hits. Two flops give the answer in the first 3 seconds.
- 17 of 27 hits have a "but" turn in the middle; 2 of 7 flops do.
- 8 of 9 news hits state an opinion, and open on a consequence, a quote or a reaction, not the announcement. Same creators, same week: a "why" Short at 31.8 times the channel's usual views against a news list at 0.11.
- Comments per 1,000 views track the number of stated takes (0.81) and "I" (0.63). AI-voiced hits get 0.16 comments per 1,000 against 1.13 for human-voiced, and none of them says "I".
- Pulse: 4.0 points lost per second in the hook and 3.9 in the facts, falling to 1.7 once the take starts. The take is not driving people off; the middle never gives them a reason to wait. The first frame carries a headline that states the answer ("Ocarina Remake Added Fast Travel, Then Cut It").

**What to change.**

- Every Short names its question and its answer when it is planned. The answer sentence may not start before 60% of the words. The title and the first-frame text may state the premise but not the answer.
- One "but" turn in the middle third.
- News is re-angled before writing: why it happened, what it changes for the player, what the player can do before a date, or the narrator's verdict. A side is stated in the first two sentences (the friend voice already asks for this; it is not being enforced) and the verdict lands last.
- This does not undo "clarity first". The hook still says plainly what the Short is about. Clear about the question is not the same as giving the answer away.
- Stock take openers ("I'd", "My verdict", "My Pulse check") are rotated out the same way repeated hooks already are.
- End on the punchline or verdict and stop. 22 of 27 hits end with no ask.

**How it is automated.** A planning step and a check in the Shorts writer (factory, `src/editorial`), behind a new setting `SHORT_PAYOFF_GATE=off|check|fix` with a share so half of Shorts get it. The existing clarity judge reads the script cold after the hook and must not be able to state the answer. It reuses the two-hook-takes step and the structure rotation, which are live.

**Proof before live.** Ten real published scripts rewritten under the gate, before and after side by side, each passing the clarity judge and fact check. No new voice or render spend for the proof.

**Pass mark.** On 20 Shorts per arm: loss per second through the facts down from 3.9 to 3.0 or better, average viewed up 3 points, comments per 1,000 views up. Otherwise off.

### 2. Break the template in sound and layout (Shorts)

**Evidence.**

- Pulse: sting at the first and last frame of 86 of 86 Shorts; identical five-sound sequence on 58%; six effect files; four beds for 89 videos; loudness range about 1 LU; no silence in any Short; 9 of 9 inspected Shorts open on one layout and close on the same headline card. About 4 words on screen per second from three competing text layers.
- Hits: 0.36 effects per 10 seconds against Pulse's 1.5, and none at all in 10 of 27. Effects density runs against comments (minus 0.44). One quiet bed. No extra text on the first frame in 17 of 27. Captions of 1 to 3 words. Overlays are evidence only: the headline, the post, the source's name, a score, a date.
- YouTube's stated test before a channel can earn is whether videos look made with a template, and reviewers sample the newest uploads.

**What to change.**

- No fixed sting. Effects only where something arrives on screen, 0 to 4 a Short, and none is allowed.
- More beds (the `claude/morebeds` branch is built and unmerged) and no bed used twice in a row.
- Three or four opening layouts, including full-frame footage with captions only. The closing frame holds on the payoff, not the headline card.
- One text layer besides captions at any moment.
- A sameness score for the newest 30 Shorts, reported weekly, so this cannot drift back.

**How it is automated.** Sound plan and Short layout in the factory render code, behind `SHORT_SOUND_PLAN=v3|sparse` and `SHORT_LAYOUTS=on|off`, split by episode.

**Proof before live.** Three real Shorts re-rendered both ways through the PC orchestrator at test priority, checked for loudness, black frames and reading time. Sameness score before and after on a simulated run of 30.

**Pass mark.** Identical sound sequence on under 15% of the newest 30 (now 58%), no opening layout on more than 40%, and average viewed not worse than the old arm.

**Caution for the other chat.** The signature music stings being finished in the Pulse Gaming News chat would put a branded sound on every video again. The evidence says to keep a signature for long videos and series openers, and leave Shorts without one. That chat owns the decision; I have told it.

### 3. Long-video openings that earn the first minute

**Evidence.**

- "Why San Andreas Never Got a Sequel" kept 63% at 36 seconds and 32% at 3 minutes. YouTube rates both public long videos below about three quarters of similar videos.
- Pulse openings run 122 to 129 words, begin on a buyer's line that does not match the title ("can mislead your next purchase" on a history documentary) and reach the real question at 11 to 18 seconds.
- Hits state the question inside 90 seconds and often half-answer it at once. The one Dark Space video that opened on three abstract questions and definitions got 34,000 views against 204,000 and 666,000.
- "The Long Road" opens on a 1990s news report with no music for 28 seconds, drops to silence, then hits the title. Intros cut 1.5 to 2.5 times faster than bodies (about 20 cuts a minute against 10).
- Every hit sets one finish line early and reaches it late. The underperformers set none.

**What to change.**

- The first sentence serves the title's promise. No buyer framing unless the video is a buyer's guide.
- One finish line per video: a single question or goal, planted before 1:30 and paid in the last 15%, written into the outline with both timestamps.
- Open on a real dated voice or source where one exists, with no music under it.
- The opening has no long holds (no still over 3 seconds, no clip over 4). **Correction after the build, 18 Nov:** the original idea, an intro cut at twice the body's pace, cannot work, because Pulse's body already changes picture 15 to 19 times a minute, about the pace top documentaries use only for their intros (their bodies run at 8 to 14). The real fix is a calmer body with longer moving shots. That is now part of gap 10 and depends on moving footage.
- Chapters hand over by contrast (praise then cost, joy then threat), and a series part ends on the next threat.

**How it is automated.** Outline and opening checks in the documentary and long-form writers, and a two-speed rule in the long edit plan, behind `LONG_OPENING_CONTRACT=off|check|fix`. It extends the open-loops and cold-open steps that already exist.

**Proof before live.** The three November long videos' outlines and openings re-run under the contract, before and after, plus the plan's cut rate for the first two minutes.

**Pass mark.** On the next two long videos: 70% or more left at 36 seconds and 45% or more at 3 minutes (now 63% and 32%).

### 4. Rankings and commentary as arguments

**Evidence.**

- Ranking hits say "I" 19 to 40 times per 1,000 words, against 1.8 in an encyclopaedic history. One channel ends all 23 entries with a spoken verdict. A fan-vote version of the same ranking with no host verdict got 10,000 views against 1.9 million.
- They invite the fight inside 30 seconds; 27% of comment likes go to placement arguments. The thumbnail is the hot take: best and worst.
- Time follows interest: filler entries get 10 to 46 seconds, the top ones 154 to 189.
- Commentary that holds states its verdict by 2:15, then tests three to six numbered claims and closes each one as true, half true or wrong. The same creator's video with no stance got 0.45 times his usual views.
- Pulse: "Every Mainline GTA Game, Ranked" got 2 views. Long videos say "I" 0.0 times per 100 words. Ranking Shorts show 6 to 8 identical rank cards in a row and sit at a median of 104 views.

**What to change.**

- Rankings: a one-line "I" verdict per entry, the most contested placement named in the first 30 seconds, unequal time, and a thumbnail that shows the verdict.
- Commentary gets a fixed shape: verdict early, numbered claims, a ruling on each. The natural first use is "GTA VI claims, tested" on Martin's own launch footage, which no other channel can copy.
- Documentaries: at least two honest takes a chapter, as the friend voice already says.
- No franchise histories unless the brief names a thesis, something exclusive and a finish line.

**How it is automated.** Writer rules and counts in the long-form and ranking writers, behind `LONG_ARGUES=off|check|fix`. Built with gap 3 by the same helper because they touch the same files.

**Pass mark.** First ranking under the rules: comments per 1,000 views above 1.0 (long videos now 0) and average viewed above 25%.

### 5. A chorus of voices, and let the game speak

**Evidence.**

- "The Long Road": 15 named voices, 230 speaker changes in 50 minutes, the narrator silent for the first 3 minutes 22 seconds. 46% of likes on its top comments celebrate the cast. A second Dark Space hit has 33 speaker changes in 27 minutes.
- Shorts: game audio is audible in 19 of 27 hits. Three stop narrating for 10 to 25 seconds and let the game talk; one ends on a character's line.
- Pulse: one voice throughout. Game audio was heard in 2 of the 28 Shorts that log it, although the setting is on for half.

**What transfers to a faceless channel.** Not 15 recorded interviews. The honest substitute is short credited archive clips with their own sound, named primary-source quotes shown on screen, game characters' own lines, and Martin's own recorded reactions from his daily streams.

**What to do.**

- First, find out why the game-audio bed reaches about 7% of Shorts when it is set to 50%. That is a diagnosis for the Pulse Gaming News chat, which is already checking the trailer voice lines branch.
- Then a "voices plan" for documentaries: a target of one voice other than the narrator every 90 seconds, each credited on screen, drawn from the scene index, the stream archive and source quotes.

**Status.** Design only for now. It depends on footage fetching, which YouTube's bot check has limited since 14 November, and on Martin's GTA VI streams from 19 November.

### 6. A premise test before any "why" Short is written

**Evidence.**

- Pulse's "why" Shorts sit at a median of 71 views against 233 for the rest. The flops answer questions nobody was asking that day: narrow roads, radio on foot, a failed score.
- Title wording is not the cause. Across 563 titles, question marks, capitals and numbers move results by a few per cent. Titles of 1 to 5 words break out 28% of the time against 14% for 9 to 11 words.
- 17 of 27 hits ride the release of the month through an evergreen shape. The contradiction ("they said X, the truth is Y") is the strongest hook shape per use.

**What to change.** A "why" Short is only written if the question shows up in the wild (search suggestions, Reddit threads, viewer comments, the stream asks list) or carries a real contradiction. Otherwise the slot goes to news with a take.

**How it is automated.** The search-demand engine already exists and is off (`SEARCH_SHORTS`). Switch it to feed the "why" picker, then add the contradiction test. Second wave.

### 7. Music cast per chapter, silence at the seams (long videos)

**Evidence.** "The Long Road" changes bed about 12 times in 50 minutes, matched to each era, with a full drop-out at every chapter card. Documentaries change bed 2.4 to 4.3 times per 10 minutes. Pulse's measured long render has a loudness range of 1.8 LU and 3.4 seconds of silence in 26 minutes.

**What to change.** A bed per chapter chosen for its mood or era, a 0.5 to 1.5 second drop-out before the title card, each chapter card and the single most important line, and no music under an opening archive clip.

**Status.** Second wave. It shares files with the signature music work in the Pulse Gaming News chat, so it waits for that to land.

### 8. Pinned comments and replies with a stance

**Evidence.**

- Pulse: 70% of pinned comments use one of two stock openers. Two live long videos have a broken one ("Which Grand Theft Auto VI game was the one for you?"). None of the Shorts checked since 14 November has a pinned comment.
- Top creators: the top comment is the creator's take as a claim to argue with, or a link to the long video. One creator replied in 9 of the top 25 threads. Viewers' top comments are their own answers and corrections.
- Pulse already answers well: 14 of 19 threads.

**What to change.** Fix the two faults, then pin the narrator's take as a claim, or ask for the viewer's own ranking, in varied wording.

**Status.** The two faults were reported to the Pulse Gaming News chat today because they are live. The rest is a small build after the first three.

### 9. Speak faster, and pick one of two lengths (Shorts)

**Evidence.** Hits run at 212 words a minute (168 to 301); Pulse at 166. On Pulse's own Shorts, speed tracks views (+0.37) and length runs against them (minus 0.34). Hits are either short or full: only 5 of 27 sit between 46 and 60 seconds, 15 are over a minute.

**What to change.** Test 185 to 195 words a minute on half of Shorts by tightening gaps before any speed-up, so the voice Martin likes is not distorted. Two lengths only: news takes at 35 seconds or under, story Shorts with a held answer at 60 to 75 seconds. Nothing in between.

**Status.** A settings test for the Pulse Gaming News chat to run after launch week; the voice experiment judged on 3 December must not be muddied.

### 10. Moving pictures first, and no shot twice

**Evidence.** 26 of 27 hits open on moving footage; 19 never reuse a shot; one new picture every 2.8 seconds. Pulse Shorts are 74% stills, 30% open on a 0.4 second first shot, and long videos are 76 to 78% stills. But on Pulse's own data the share of stills does not separate hits from flops, so this is ranked below the script gaps.

**What to change.** Fix the 0.4 second first shot. Move the retention director from "advise" to "fix" on half of Shorts once its predictions have been checked against real curves. Long videos need at least half their runtime moving before release, which Martin's own GTA VI capture makes possible from 19 November.

**Status.** Switch on what exists, in the Pulse Gaming News chat's hands.

### 11. One promise in the packaging (long videos)

**Evidence.** Hit thumbnails carry 0 to 4 words that add to the title and sell one thing to find out. A copied thumbnail template on a list topic got 0.53 times usual views against 3.5 for the original idea. Pulse's "GTA 6 Before You Buy" has a thumbnail that says "PAY" over a nine-tile collage and got 612 impressions.

**What to change.** Move the packaging lab from "score" to "pick" for long videos, with the rule that thumbnail words are not in the title and name one thing.

### 12. A "Long Road" style series on GTA VI

"The Long Road" is the craft benchmark, not the reach benchmark: the same channel's 26-minute explainer did three times better, and Episode 2 kept 36% of Episode 1. So the lesson to take is its method (voices, finish line, era music, contrast cuts, ending on a threat), applied first to single stories. A multi-part series on GTA VI's first month, built from Martin's streams and credited voices, is worth planning once the 21 November documentary has been judged on 5 December.

## What is being built now

Three Opus helpers on the PC, each on its own branch cut from `claude/stage`, each behind a setting that is off by default. Nothing reaches the Mac mini until the Pulse Gaming News chat deploys it in a safe window.

| Helper | Branch                  | Gaps    | Setting                                |
| ------ | ----------------------- | ------- | -------------------------------------- |
| A      | `claude/gap-payoff`     | 1       | `SHORT_PAYOFF_GATE`                    |
| B      | `claude/gap-untemplate` | 2       | `SHORT_SOUND_PLAN`, `SHORT_LAYOUTS`    |
| C      | `claude/gap-longform`   | 3 and 4 | `LONG_OPENING_CONTRACT`, `LONG_ARGUES` |

Each helper must prove its change on real past videos before it is offered for deploy, and report what is on and what is off.

### Build status, 18 Nov evening

All three branches are pushed and not merged. Every setting below is **off** until the Pulse Gaming News chat deploys and switches it on.

| Branch                  | Commit    | Settings (all off)                                                                                               | New tests                | What the free checks found                                                                                                                                                                   |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude/gap-payoff`     | 7ac04d8d8 | `SHORT_PAYOFF_GATE`, `SHORT_PAYOFF_SHARE`                                                                        | 22 pass, plus 68 related | Of 77 news Shorts: the opinion starts before 60% in 30, the verdict is missing from the last third in 26, a stock opinion opener repeats within three Shorts in 32, and 15 end on a question |
| `claude/gap-untemplate` | a4c5efa82 | `SHORT_SOUND_PLAN`, `SHORT_SOUND_SPARSE_SHARE`, `SHORT_LAYOUTS`, `SHORT_LAYOUTS_SHARE`, `SHORT_FIRST_SHOT_MIN_S` | 17 pass, plus 83 related | Newest 30 Shorts: 93% share an effect sequence. Simulated with the settings on every Short: 0%, 0.37 effects per 10 seconds, no opening layout over 37%                                      |
| `claude/gap-longform`   | 270bc7f68 | `LONG_OPENING_CONTRACT`, `LONG_ARGUES`                                                                           | 28 pass, plus 68 related | All four long videos open over the 90-word cap with no first-person opinion in any chapter; the ranking has 0 of 11 verdicts and equal time per entry                                        |

**Still to do before any of it is offered for deploy:**

- The whole-code check and the full test suite on each branch. They are queued on the PC as short jobs and are held behind the kept-free windows of GTA launch week.
- Four proof renders for the sound and layout change (same queue).
- Real-writer before and after for the Shorts gate and the long-video rules. This costs about 1.50 to 3.50 US dollars in total and waits for Martin's OK.
- One existing test (`shortrun`, the launch run file) fails on the long-form branch; to be confirmed as failing without the change too.

**Suggested switch-on order, once checked:** `SHORT_FIRST_SHOT_MIN_S=1.5` for every Short; then the sound and layout settings on half of Shorts; `SHORT_PAYOFF_GATE=check`, `LONG_OPENING_CONTRACT=check` and `LONG_ARGUES=check`, which only record results; then `fix` on half once the records look right.

## What I am not recommending

- **Chasing title formulas.** The evidence says wording barely matters.
- **More sound effects, more cards or faster cuts.** None separates hits from flops, here or on Pulse.
- **Copying the fabricated "just confirmed" Short.** One 765,000-view hit states a rumour as fact. It is in the data as a hit and is exactly what Pulse's rules forbid.
- **Franchise histories.** The most crowded form in gaming, and the one that got 2 views.

## Where the evidence is thin

- Other channels' retention, loudness and exact cut counts could not be measured.
- Whether a voice is human or AI was partly judgement; only one channel discloses it.
- Pulse's renders survive for only 9 of the 18 chosen Shorts and 1 of 3 long videos, so sound and picture measures rest on those.
- Pulse has 10 new subscribers in the window. Any per-format subscriber rate is noise; comments per 1,000 views and retention are the measures to judge by.

## Writer check, 18 Nov evening: who has been writing, and how good is it

Found while trying to run the paid proofs: the Claude API key refuses every call ("You have reached your specified API usage limits. You will regain access on 2026-12-01"). The Mac mini's usage records show Claude last answered on 11 Nov at 21:35. From 12 Nov every text step has been written by Codex through the automatic fallback, and Codex also wrote most of 8 to 11 Nov during the trial.

**What happened to views (news Shorts, public views on 18 Nov).**

| Period | Writer | Shorts | Median views | Over 500 views | Median watched |
| --- | --- | --- | --- | --- | --- |
| 1 to 7 Nov | Claude | 28 | 178 | 6 | 56% |
| 8 to 11 Nov | Mostly Codex, old voice rules | 22 | 876 | 14 | 64% |
| 12 to 17 Nov | Codex, friend voice, new narrator | 27 | 122 | 3 | 59% |

**What blind judges said about the writing.** 24 published scripts, 8 picked at random from each period, shuffled and unlabelled, scored 1 to 10 by two judges who did not know the writers (Sonnet 5.5 and Opus 5.5; they agreed closely, rank correlation 0.81).

| Period | Overall | Hook | Payoff | Clarity | Voice | Human | Scripts at 5 or more |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 to 7 Nov, Claude | 5.25 | 6.8 | 5.1 | 5.8 | 5.1 | 4.6 | 6 of 8 |
| 8 to 11 Nov, mostly Codex | 4.12 | 5.4 | 3.8 | 5.3 | 4.1 | 3.7 | 2 of 8 |
| 12 to 17 Nov, Codex with friend voice | 3.56 | 4.5 | 3.2 | 5.3 | 4.0 | 3.4 | 1 of 8 |

**Reading.**

- The Codex-written scripts are judged weaker, by about 1.1 to 1.7 points out of 10, mostly on the hook and on holding something back. Clarity is about level.
- Judged script quality did not predict views in this sample (rank correlation minus 0.03). The best run of views came in a Codex period, on the Ocarina and GTA news wave. Topic and timing decided the views; the writing decides whether viewers stay, comment and subscribe.
- Even the Claude-written scripts average 5.25, which the judges were told is "average for a competent channel". The lowest scores for every writer are on payoff, which is exactly what gap 1 is built to fix.
- The judges' notes name the same template lines again and again: "Pulse check: steady", "Tomorrow brings another Why", documentary plugs at the end, forced quips.

**Limits.** Eight scripts per period; different stories in each period; both judges are Claude models and may favour Claude's style; newer Shorts have had less time to collect views. Raw files: `D:\pulse-data\scratch\creator-gap-1118\blind\`.

**What it means for the builds.** Until 1 December, or until the cap is raised, any new rule that is switched on will be tested on Codex's writing. The experiment log's rows 1 and 2 (friend voice and narrator, judged 3 December) have been Codex tests all along and should be relabelled.

## Editor's loop test, 18 Nov night: how close to 10 can the scripts get

Martin asked whether the blind scores could be brought closer to 10. Tested at no cost: an Opus helper ran an editor's loop on the same 24 published scripts (state the angle, draft, judge harshly, rewrite the single biggest weakness, two rounds, drop stories that cannot carry a Short), using only the facts already in each script. The 24 rewrites, 12 transcripts of breakout Shorts from top human creators and 8 of the originals were shuffled and scored blind by two fresh judges (agreement 0.86).

| Scripts | Overall | Clarity | Hook | Payoff | Voice | Human | At 7 or more |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pulse originals (8, control) | 3.9 | 4.6 | 5.1 | 3.2 | 3.9 | 3.3 | 0 of 8 |
| Pulse after the editor's loop (24) | 6.9 | 7.4 | 7.3 | 6.4 | 6.8 | 6.4 | 14 of 24 |
| Top human creators' breakout Shorts (12) | 5.25 | 5.5 | 6.2 | 5.1 | 6.6 | 7.4 | 3 of 12 |

**Reading.**

- 23 of 24 scripts improved, by 2.5 points on average. All three writer periods end at about 7 (7.0, 6.6, 7.0), so the loop closes most of the gap between Claude-written and Codex-written drafts.
- None reached 8 with both judges. What holds them at 7 is not wording: the stories' research has no "why" and no first-hand quote, four of the 24 stories should not have run at all, and the endings still read as tidy formula lines. The judges' lowest marks for the rewrites are payoff and "human".
- The breakout human scripts score 5.25 on paper, from 3 to 7.5. Their only clear lead is sounding human (7.4 against 6.4). So a script that reads as a 10 is not what makes a Short break out; in the first test judged quality did not predict views either. The script is one input beside the story, the voice, the footage and the first seconds.
- Honest ceiling: about 7 from editing alone, about 8 with better research and story choice. Ten is not a real target on this scale, since the best human hits do not reach it.

**Limits.** Claude-family writer and judges, so some shared taste is likely; human scripts are transcripts of longer, looser videos; self-contained rewrites could not use sources. Only live retention and comments can prove the gain. Raw files: `D:\pulse-data\scratch\creator-gap-1118\blind2\`.

**What is being built from it.** Branch `claude/gap-desk` (on top of `claude/gap-payoff`), setting `SCRIPT_DESK=off|check|fix`, off by default: the angle sentence before writing, an independent editor's read on the six measures, one targeted rewrite per round, the kill rule through the existing thin-story route, a cost cap, and a weekly table that sets the editor's score against real retention so the judge can be calibrated.

**What editing cannot fix, added to the second wave.**

- Research per story must carry the reason behind the news and one quote from a person involved (links to gap 5, voices, and the `no_primary_sources` note in the long-form build).
- The newsroom should refuse search-help, obvious-answer and promotion stories before they reach a writer (links to gap 6, the premise test).
- A spoken pass for endings and rhythm, since "human" is where real creators still lead.

## Status at 22:45 on 18 Nov

This replaces the "Build status" table further up.

| Build | Branch and head | Checks (typecheck, full suite) | State |
| --- | --- | --- | --- |
| Hold the answer back, stance early | `claude/gap-payoff` 01a8e8b40 | pass, 2,512 of 2,513 | **Live on the Mac mini since 22:06**, `SHORT_PAYOFF_GATE=check` (records only) |
| Script editor's desk | `claude/gap-desk` f7ace78e9 | pass, 2,540 of 2,541 | **Live on the Mac mini since 22:06**, `SCRIPT_DESK=check` (records only) |
| Long openings, rankings as arguments | `claude/gap-longform` 3a9e69320 | pass, 2,514 of 2,515 | Ready. Held by the Pulse Gaming News chat until the 21 Nov documentary is rendered and scheduled, then both settings on `check` |
| Sound and layout | `claude/gap-untemplate` e256f768b | pass, 2,575 of 2,576 | Code ready and merged up to the live code. Held until a like-for-like render (same stored Short on the live code and on this branch with every setting off) matches; that render and four proof renders are queued on the PC |

The one failing test in every suite is the same known failure in existing code (`engage.test.ts`, community posts).

**Off, and why:** `SHORT_PAYOFF_GATE=fix` and `SCRIPT_DESK=fix` (wait for the record-only numbers); `LONG_OPENING_CONTRACT`, `LONG_ARGUES` (wait for the 21 Nov documentary); `SHORT_SOUND_PLAN=sparse`, `SHORT_LAYOUTS`, `SHORT_FIRST_SHOT_MIN_S` (wait for the renders).

**Open decisions.**

- Martin: whether to raise the Claude spending cap so Claude writes Shorts scripts and the 21 Nov documentary again (about 40 US dollars to 1 December). Until then every script, and every pass of the new rules, runs on Codex.
- Pulse Gaming News chat: whether the "Pulse check" and "My verdict:" segment stays on for Shorts that go through the editor's desk.

**How each will be judged.** Payoff gate and desk: once 20 Shorts per arm have retention data, compare loss per second through the facts, average viewed and comments per 1,000 views, and read the desk score against average viewed. If the desk score does not track retention, its rubric gets re-weighted before `fix` is ever switched on.

## Writers' room, 19 Nov

Martin asked on 19 Nov to get the scripts as close to 10 as possible. Full write-up with the scores, six before-and-after examples and all data: `reports/research-2026-11-18/writers-room-test.md`.

**What was tested.** The same 24 published stories, on the PC with Opus helpers: a fact pack per story, four angles and three drafts, two blind critics (an editor and an audience stand-in), an edit, a voice pass and a pick between the two versions. No API spend.

**Result, two blind judges, one sitting.**

| Version | Overall, out of 10 |
|---|---|
| Published originals | 3.4 |
| Top human creators' breakout Shorts | 4.7 |
| Editor's loop rewrites (18 Nov) | 5.9 |
| Writers' room, best version per story | 7.3 |
| Writers' room, weakest quarter of stories dropped | 7.5 |

- These sittings marked about 0.8 lower than the 18 Nov one, so the room's 7.5 is roughly 8.3 on the scale where the editor's loop scored 6.9.
- 12 of the 19 kept stories scored 7.5 or more and 5 scored 8 or more. None got 9 from both judges. The scores have levelled off: a third round of edits moved the average by 0.1.
- The audience stand-in expected viewers to finish 23 of 24 final scripts, against 2 of 8 earlier rewrites.

**What did the work, in order.** Better material (the fact pack, about one point); at most two spoken names and two numbers; the answer late by cutting, never by padding; plain endings; a different form per story; dropping the fifth of stories that cannot carry a Short.

**Check against real retention.** On the 54 Pulse Shorts with 100 or more views, two blind readers' feature scores link to real numbers as follows: one point all the way through 0.45 with average viewed, a conflict 0.35, sounding human 0.32, clarity 0.30; the editor's overall mark 0.36 with viewers staying. A stated opinion on its own shows no link. Modest links, right direction; no Pulse Short has yet scored above 7, so the value of an 8 in views is still unmeasured.

**Side finding.** Seven of the 24 published Shorts carried a detail the sources do not support. Sent to the Pulse Gaming News chat, which is checking each and will post corrections.

**Build.** `claude/gap-room` (setting `SCRIPT_ROOM`, default off), cut from stage e0a70f5e0, following `reports/research-2026-11-18/writers-room-data/room_spec.md`. Status is in the table below once its checks have run.

**Limits to be straight about.**

- The room adds about six model calls a Short. Codex has no room for that until its weekly reset on Sun 22 Nov 16:43, so nothing switches on before then unless script writing moves back to Claude.
- The test writers were Opus. Codex wrote the 3.4 originals, so the room on Codex will score lower than these figures until that is measured.
- The factory cannot search the web. Its fact packs come from the articles it already fetches, links inside them and the Fact Vault, so they will be thinner than the test packs, which used open web research.
- A high mark on paper is not a view count. Human hits score 4.7 on this sheet and still get millions, on topic, footage and delivery.
## Frontier programme, 19 Nov

Martin, 19 Nov, after the writers' room result: make this permanent across writing, production, editing, visuals, footage and branding, so Pulse stays at the front. "Yes set it all up."

**The loop, the same for every craft.** Better raw material; several versions; blind critics, one of them standing in for the audience; fix the biggest fault; keep the best; drop what is weak; check the marks against real retention. Two warnings from the test: rules harden into a template within one round, and marks only compare inside one sitting.

**What is set up.**

| Piece                                 | Where                                                                                     | State on 19 Nov                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weekly frontier check                 | Scheduled task `pulse-frontier-check` on the PC, Wednesdays about 11:50, first run 25 Nov | Created. Marks Pulse's week blind beside that week's breakout videos from top creators, checks the marks against retention, and puts the three biggest gaps into `reports/Pulse upgrade queue.md` |
| Fixed marking kit                     | `C:\Claude\analytics\pulse\frontier\kit\` on the PC                                       | Made: the three marker briefs, 30 anchor scripts with known marks, the first retention check                                                                                                      |
| Five no-cost writing rules            | `SHORT_CRAFT_RULES`, live on the Mac mini since 10:32                                     | On (deployed by the Pulse Gaming News chat, bc7075293)                                                                                                                                            |
| Script: writers' room | `SCRIPT_ROOM`, branch `claude/gap-room`, live in stage e7fb02ae8 | On for half of news, breaking and Why Shorts since 10:40 on 19 Nov (Martin: "go for it"). Checks: typecheck clean, 2,605 of 2,606 tests |
| First second and long-video packaging | `FIRST_SECOND_PANEL`, `PACKAGING_PANEL`, branch `claude/gap-panel`                        | Being built, off                                                                                                                                                                                  |
| Pictures for each line                | `SHOT_PLAN_PANEL`, branch `claude/gap-shotpanel`                                          | Being built, off                                                                                                                                                                                  |

**What the factory already has for each craft, and what is missing.** From a read of the code on 19 Nov, with the live settings on the Mac mini as the Pulse Gaming News chat reported them that day (the code's own defaults are mostly off; the Mac has most of these on).

| Craft | Already there | Live setting on the Mac mini, 19 Nov | Missing for the loop |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Script | Editor's desk, payoff gate, clarity check | Desk and payoff record-only; writers' room on for half since 10:40 | Several drafts and an audience critic: the writers' room |
| Story choice | Thin-source gate, story size score | Thin-source gate on | A "can this carry a Short" drop before writing: in the room |
| First second | Up to 6 opening clips tried in order, up to 5 hook voice takes, 5 hook texts | `SHORT_OPEN_FOOTAGE` on, `HOOK_TAKES=2`, `LEARN_HOOKS=shadow` (records, does not choose) | Candidates compared with each other by an audience critic |
| Pictures per line | One vision call picks a moment per line; plan rubric; vision check after render | `SCENE_MATCH` on | Two or three plans compared before the render |
| Edit and pace | Retention director with a model that predicts the curve | `RETENTION_DIRECTOR=advise` (advises, does not change the cut) | Comparing alternative edits |
| Sound | Bed rotation, loudness check | Sparse sound plan held on `claude/gap-untemplate` | Any judge of sound sameness: on that held branch |
| Titles and thumbnails | Packaging Lab: 24 titles scored by a model | `PACKAGING_LAB=score` (scores, does not pick) | An audience pick among the top five |
| Branding and repeats | Recent shapes memory, bed and look memory | `SHORT_SKELETONS` on (the writers' room arm skips it and uses its own variety memory) | A sameness score fed to the critics |
| Long videos | Release gate after render, clarity and friend passes | Opening contract and argued rankings held on `claude/gap-longform` | Two drafts per chapter and a critic before the render |
| Checking the judges | `learn/judges.ts` links each judge to real outcomes | `LEARN_JUDGES` on | The new critics' marks added to it |

**Order of work.**

1. Writers' room: live for half since 19 Nov 10:40 on Claude (estimated 25 to 35 US cents for each Short it writes on an Opus-class model, about 1.50 US dollars a day at half of ten Shorts). Read the first room-written Shorts, their real cost and how often it falls back; judge at 20 Shorts a side.
2. First-second and picture-plan panels: finish, test, hand over; both start in `check` so their marks can be set against stayed-versus-swiped before they change anything.
3. Decisions that are the Pulse Gaming News chat's call once the data is in: moving `LEARN_HOOKS` from shadow to choosing, `RETENTION_DIRECTOR` from advise to fix and `PACKAGING_LAB` from score to pick.
4. After the 21 Nov documentary: `claude/gap-longform`, then two drafts per chapter with the critics.
5. After the like-for-like render: `claude/gap-untemplate` (sound and layout variety).
6. Every Wednesday the frontier check re-ranks the gaps, so this order changes with the evidence.

**Pass marks.** Each panel is kept only if, on 20 Shorts a side, its arm beats the control on average viewed and on stayed-versus-swiped, and its critic's mark links to those at 0.2 or more. A panel whose mark does not track real viewers is re-weighted or removed, not tuned by adding rules.

**Limits.**

- Marks on paper are not views. Human hits score 4.7 on the script sheet and get millions on topic, footage and delivery.
- Every panel costs model calls. Claude is writing again within a budget of about 6 US dollars a day for the whole factory, so panels go on one at a time.
- The picture and first-second panels are built from the same method but have not had a hand test like the script. Their `check` mode is that test.
