# Pulse self-audit: our own videos, 1 to 17 November 2026

Written 18 Nov 2026 so we can compare like for like with top human creators. Read-only. Labels: **(M)** measured, **(I)** inferred or estimated. Raw data, including the per-video yardstick rows for all 89 videos, is in `pulse-self-audit-data/` (`pulse_videos_1-17nov.csv`, `hits_vs_flops.json`, `sameness.json`, `segments.json`, `cards.json`, `render_measures.jsonl`, contact sheets).

## Summary in plain English

1. **Output and results (M).** In the window Pulse published 86 Shorts and 3 long videos (one later made private). Together they got 36,359 views, 10 subscribers (0.28 per 1,000 views) and 19 viewer comment threads (0.52 per 1,000).
2. **Shorts hold well but leak steadily (M, 54 Shorts with curves).** News Shorts are watched 71% through and breaking Shorts 67% (views-weighted). But they lose about 4 points of audience a second all the way through the facts. Only 38% of the starting audience is still there when the opinion ("take") arrives, at 65% of the runtime.
3. **The first tenth decides (M).** The best predictor of a Short's views is how much of the audience it keeps in its first tenth (rank correlation 0.58). Shorter and faster Shorts also do better (length -0.34, words a minute +0.37).
4. **The story matters more than the edit (M).** Cutting faster, using more moving footage, using fewer stills or writing a shorter hook does not separate hits from flops in this window. What does: breaking news beats explainers, and question titles ("Why...", "Is...") and the new "GTA 6: Why its..." Shorts about small details flop.
5. **Everything sounds and looks the same.** (M) All 86 Shorts open and close on the same "sting" sound. 58% use the identical five-sound sequence. Four music beds serve all 89 videos. Every render sits at -16 LUFS with almost no dynamic range. All 9 Shorts inspected open on the same layout and end on the same headline card. (I) That "made from a template" look is a monetisation risk.
6. **The words are not the problem (M).** Script wording is varied: only one four-word phrase repeats in 5 or more Shorts. The sameness is in sound, layout, structure and comments.
7. **Long videos lose viewers fast (M).** San Andreas kept 63% of viewers at 36 s and 32% at 3 minutes. YouTube rates both public long videos as holding viewers worse than about three quarters of similar videos (relative retention 0.24 to 0.30). Their openings run 122 to 129 words, start on a buyer's-guide line and wait 11 to 18 s for the real question.
8. **Long-video pictures are mostly stills (M).** The public long videos are 76 to 78% stills and only 9 to 12% moving footage. The pulled Final Fantasy XIV documentary spent 66% of its runtime on one title plate.
9. **Community and subscribers are the weakest results (M).** 70% of pinned comments use one of two stock openers. Two pinned comments have broken template slots. None of the Shorts checked from 14 Nov on has a pinned comment at all. Replies are good: 14 of 19 viewer threads in the window were answered.
10. **Gaps.** Renders exist for only 9 of the 18 chosen Shorts and 1 of the 3 long videos. YouTube Analytics has no rows yet for 16 and 17 Nov Shorts. There is no curve for the pulled documentary.

## Method

- **Set (M).** All 91 uploads from 1 to 17 Nov (89 made by the factory, plus a relay test). Deep dive on the 8 best Shorts (top 4 by views plus San Andreas CJ, the $99.99 edition, Star Wars racer, AC ranked), the 10 worst (8 lowest plus the GTA 6 "Why its..." radio and police Shorts) and all 3 long videos.
- **Analytics (M).** From the Mac factory's `/routine/channel-report?days=20` and `/routine/export?days=20` (loopback, read-only). Views are the public counter on 18 Nov. Average viewed, engaged views and subscribers come from YouTube Analytics, which lags about 2 days. Curves are YouTube's audience watch ratio at each 1% of the video; Shorts curves start above 1.0 because of rewatches.
- **Scripts and plans (M).** Read from a copy of the Mac database for all 89 episodes: script, word timings, shot plan, sound plan and music bed.
- **Renders (M).** ffmpeg on the 9 Shorts and 1 long video still on disk: scene cuts, per-second picture hashes, motion, EBU R128 loudness and silences under -35 dB. Pulse dissolves between shots, so hard cuts understate the pace; the plan's shot changes are the better figure.
- **Comments (M).** vidIQ: the newest 100 channel threads, back to 29 Oct.
- **Cards (I).** Screen time estimated from the beat's narration; reading need taken as 0.5 s + 4 words a second.

## Channel totals in the window (M)

| Format                                     | Videos | Views  | Avg viewed (views-weighted) | Engaged / views | Subs | Subs per 1,000 |
| ------------------------------------------ | ------ | ------ | --------------------------- | --------------- | ---- | -------------- |
| News Shorts                                | 51     | 19,447 | 70.8%                       | 37%             | 6    | 0.31           |
| Breaking Shorts                            | 26     | 13,300 | 66.6%                       | 40%             | 2    | 0.15           |
| Evergreen Shorts (rankings, deals, charts) | 9      | 1,702  | 47.6%                       | 30%             | 0    | 0              |
| Long videos                                | 3      | 1,910  | 17.7%                       | 32%             | 2    | 1.05           |
| All                                        | 89     | 36,359 |                             |                 | 10   | 0.28           |

**The median Short (M):** 35 s long, 166 words a minute, 10 words a sentence; 3.6 "you" per 100 words; 36 of 86 use "I" at all; 3.3 shot changes per 10 s; longest shot 4.2 s; 74% of screen time on stills; 7.1 cards a minute; about 4 words on screen per second; 8 of 366 cards under reading time (I); 26 of 86 open with a 0.4 s first shot. Hooks: 39 questions, 30 number claims, 15 plain statements, 2 contrasts.

**Structure, voice and sound for every Short (M):**

- **Beat map.** Hook (median 3.1 s, about 10 words), then 2 to 4 fact beats each with a card (55 of 86 have exactly 3), then the take, then the loop line. The take starts at a median of 65% of the runtime. 71% carry a verdict stamp.
- **Endings.** Every inspected render ends by returning to the opening headline card. Loop lines contain "you" in 69% and are questions in 22%. Takes use "I'd" in 27, "My verdict" in 11 and "My Pulse check" in 6.
- **Sound.** About 1.5 sound effects per 10 s from a library of 6 files. Game audio under narration in 2 of the 28 Shorts that log it. 0 silences of 0.4 s or more in all 9 Shorts renders. Loudness -15.9 to -16.2 LUFS; loudness range 0.9 to 1.8 LU.
- **Retention by segment (n=54).** Median loss per second: 4.0 points in the hook, 3.9 in the fact beats, 1.7 in the take and 1.7 in the loop line. The take loses faster than the facts in only 3 of 54. It is not the take that drives viewers off; the body never earns the drop slowing.

**Best 8 and worst 10 Shorts (M), short form.** Full yardstick columns are in the CSV.

| Video                                                      | Views | Avg viewed | Title pattern | Length (s) | WPM | Stills | Hold at 10% |
| ---------------------------------------------------------- | ----- | ---------- | ------------- | ---------- | --- | ------ | ----------- |
| Why Sony Lost Crash Bandicoot After 6 Million Sales        | 1323  | 74.6%      | why           | 34         | 186 | 92%    | 1.23        |
| Zelda Ocarina of Time Remake Cut Its Own Fast Travel       | 1258  | 60.3%      | statement     | 33         | 193 | 100%   | 1.12        |
| Zelda Ocarina of Time Tops 5.2 Million in Four Days        | 1252  | 83.7%      | statement     | 31         | 166 | 100%   | 1.32        |
| GTA 6 Reportedly Needs Newest PS5 Firmware                 | 1189  | 60.4%      | statement     | 43         | 143 | 93%    | n/a         |
| Why GTA San Andreas Trusted an Unknown Rapper With CJ      | 967   | 57.7%      | why           | 52         | 161 | 31%    | 1.08        |
| Star Wars Galactic Racer Adds 4-player Split-screen        | 795   | n/a        | statement     | 34         | 167 | 44%    | n/a         |
| GTA 6's $99.99 Edition Still Launches Solo                 | 782   | 62.9%      | statement     | 33         | 161 | 100%   | 1.12        |
| Assassin's Creed Stealth Assassinations Ranked             | 776   | n/a        | ranking       | 60         | 146 | 67%    | n/a         |
| GTA 6 Gets Pocketpair Staff a 5-day Holiday                | 10    | 59.4%      | statement     | 29         | 181 | 0%     | n/a         |
| Is GTA 6 Pre-Order Worth It?                               | 16    | 83.5%      | is-question   | 35         | 166 | 34%    | n/a         |
| Steam's Biggest Climbers This Week (November 1)            | 25    | 53.4%      | chart         | 56         | 146 | 84%    | n/a         |
| Why Did Rockstar Narrow GTA 6's Roads?                     | 28    | 77%        | why           | 28         | 167 | 100%   | 1.08        |
| GTA 6: Why Its Failed Score Doesn't Prove You'll Lose Cash | 33    | n/a        | why           | 39         | 160 | 42%    | n/a         |
| Why God of War Laufey Just Slipped to May 2027             | 34    | 45.6%      | why           | 36         | 157 | 72%    | n/a         |
| Every 3D Super Mario Games Game Ranked Worst to Best       | 41    | 53.1%      | ranking       | 61         | 148 | 100%   | n/a         |
| Why Blizzard Brought Back WoW Classic After Saying No      | 41    | 49.8%      | why           | 41         | 154 | 100%   | n/a         |
| GTA 6: Why Its Radio Keeps Playing Outside the Car         | 42    | n/a        | why           | 36         | 171 | 24%    | n/a         |
| GTA 6: Why Its Police Reportedly Remember Your Clothes     | 68    | n/a        | why           | 40         | 148 | 34%    | n/a         |

## Long videos: yardstick table

| Measure                                                        | Why San Andreas Never Got a Sequel                                            | GTA 6 Before You Buy                                                                | How Final Fantasy XIV Survived (private)                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Views, avg viewed (M)                                          | 1,843, 17.8%                                                                  | 65, 16.2%                                                                           | 2, 7.3%                                                               |
| Relative retention vs similar videos (M)                       | 0.24 to 0.30 most of the way                                                  | 0.27 to 0.37 early, under 0.15 at 50 to 80%                                         | no curve                                                              |
| Impressions, click-through (M)                                 | 13,223, 2.9% (1,334 views from Browse)                                        | 612, 1.5%                                                                           | n/a                                                                   |
| Audience left at 36 s / 3 min / end (M)                        | 63% / 32% / 8%                                                                | 70% / 40% / 10% (coarse)                                                            | n/a                                                                   |
| Subs, viewer comments (M)                                      | 2, 0                                                                          | 0, 0                                                                                | 0, 0                                                                  |
| Title, thumbnail words                                         | why-question, 7 words; "THE CITY CAME BACK" with character art                | statement, 12 words; "BEFORE YOU PAY" over a busy 9-tile collage (title says "Buy") | how-question, 7 words                                                 |
| Hook length; words and seconds before the central question (M) | 128 words; 27 words, about 11 s                                               | 122 words; 47 words, about 18 s                                                     | 129 words; 47 words, about 18 s                                       |
| How the hook opens (M)                                         | buyer framing ("can mislead your next purchase") on a history doc             | "Your console's storage screen could decide..."                                     | date and fact                                                         |
| First chapter starts; chapters and lengths (M)                 | 46 s; 8 chapters of 172 to 295 s                                              | 48 s; 9 chapters of 143 to 216 s                                                    | 54 s; 9 chapters of 140 to 199 s                                      |
| Open loops planted / paid (M)                                  | 3 / 3                                                                         | 8 / 8                                                                               | 4 / 4                                                                 |
| Question sentences (re-hooks) (M)                              | 13                                                                            | 29                                                                                  | 16                                                                    |
| WPM, words a sentence (M)                                      | 152, 10.1                                                                     | 154, 9.1                                                                            | 154, 10.8                                                             |
| I / you per 100 words (M)                                      | 0.0 / 3.0                                                                     | 0.0 / 5.7                                                                           | 0.0 / 0.9                                                             |
| Shot changes a minute, longest shot (M, plan)                  | 15.5, 10.2 s                                                                  | 16.2, 10.8 s                                                                        | 14.9, 14.6 s                                                          |
| Stills / moving / graphic fillers (M, plan)                    | 76% / 12% / 12%                                                               | 78% / 9% / 13%                                                                      | 6% stills + 66% one title plate / 19% / 9%                            |
| Shots reusing an earlier picture (M)                           | 64% of time                                                                   | 60%                                                                                 | 73%: one plate fills 66%                                              |
| Music bed, loudness (M)                                        | bed_3, n/a                                                                    | bed_4, n/a                                                                          | bed_1, -16.0 LUFS, range 1.8 LU, 6 silences totalling 3.4 s in 26 min |
| Pinned comment (M)                                             | "Which Grand Theft Auto: San Andreas game was the one for you?" (broken slot) | "Which Grand Theft Auto VI game was the one for you?" (broken slot)                 | none                                                                  |

## What separates hits from flops

The 18 most-viewed against the 18 least-viewed of the 75 Shorts published 1 to 15 Nov, and the chosen 8 best against the 10 worst. Medians unless counted.

| Measure                           | Top quarter (18) | Bottom quarter (18) | Best 8 | Worst 10 | Separates?                                                |
| --------------------------------- | ---------------- | ------------------- | ------ | -------- | --------------------------------------------------------- |
| Median views                      | 1,100            | 52                  | 1,078  | 34       |                                                           |
| Breaking-news lane                | 7/18             | 3/18                | 4/8    | 0/10     | **yes**                                                   |
| Evergreen (ranking, deals, chart) | 0/18             | 3/18                | 1/8    | 2/10     | **yes** (median 104 views against 209 news, 427 breaking) |
| Question title                    | 3/18             | 7/18                | 2/8    | 7/10     | **yes** (median 195 against 278 for statements)           |
| "Why" series                      | 1/18             | 3/18                | 1/8    | 4/10     | **yes** (median 71 against 233)                           |
| Hold at 10% of runtime            | 1.14             | 1.06                | 1.12   | 1.08     | **yes** (rank correlation with views 0.58)                |
| Average viewed                    | 65.4%            | 52.7%               | 61.6%  | 53.4%    | **yes** (0.43)                                            |
| Engaged / views                   | 43%              | 39%                 | 45%    | 33%      | weak (0.14)                                               |
| Length                            | 31.5 s           | 37 s                | 34 s   | 37.5 s   | **yes** (-0.34)                                           |
| Words a minute                    | 176              | 159                 | 163    | 159      | **yes** (+0.37)                                           |
| "You" per 100 words               | 4.0              | 2.7                 | 4.0    | 3.0      | some (+0.19)                                              |
| Sound effects per 10 s            | 1.7              | 1.5                 | 1.5    | 1.4      | some (+0.29)                                              |
| Opens on moving footage           | 14/18            | 9/18                | 3/8    | 6/10     | mixed                                                     |
| Share of stills                   | 74%              | 84%                 | 93%    | 57%      | **no** (-0.02)                                            |
| Shot changes per 10 s             | 3.27             | 3.24                | 3.45   | 3.24     | **no** (0.05)                                             |
| Hook words                        | 9.5              | 10                  | 10     | 9        | **no**                                                    |
| Repeated-image share              | 22%              | 32%                 | 17%    | 21%      | **no** (-0.09)                                            |
| GTA 6 in title                    | 8/18             | 8/18                | 2/8    | 6/10     | no on its own; GTA 6 news wins, GTA 6 detail Q&As lose    |

**Reading (I).** The hits are real news with a number or a surprise: Ocarina 5.2 million, PS5 firmware, Series S storage, Crash Bandicoot sales. The flops are answers to questions nobody was asking that day: narrow roads, radio on foot, failed score, a pre-order question whose first frame answers a different question. Craft matters at the margin, through speed and length, but the topic and the title promise decide most of the views. The first-tenth hold is where craft and topic meet.

## How alike the videos are (template sameness)

| Signal                        | Finding                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening and closing sound (M) | 86/86 Shorts start on "sting" at frame 0 and end on "sting"                                                                                                                                                          |
| Identical sound sequence (M)  | 50/86 (58%) are exactly sting > air-1 > air-2 > swell > sting; the top 5 sequences cover 75/86                                                                                                                       |
| Sound library (M)             | 6 files (sting 172 uses, air-1 96, swell 85, air-2 83, tick 19, land 5)                                                                                                                                              |
| Music (M)                     | 4 beds for all 89 videos (bed_1 26 Shorts, bed_3 25, bed_4 19, bed_2 16)                                                                                                                                             |
| Loudness (M)                  | 10/10 renders between -15.9 and -16.2 LUFS, range 0.9 to 1.8 LU; no silence in any Short                                                                                                                             |
| Screen layout (M, 9 renders)  | 9/9 open on the same layout: PULSE tag and lane chip top left, a 2 to 4-line condensed headline top left, word captions lower centre. 9/9 end on the same headline card                                              |
| Structure (M)                 | 64% have exactly 3 cards; 71% have a stamp; the take always comes after the facts; 19% share an identical full skeleton with another Short; 28% share their card order                                               |
| Opening shot (M)              | 26/86 (30%) open with a 0.4 s first shot                                                                                                                                                                             |
| Titles (M)                    | 31/86 mention GTA 6; 3 "GTA 6: Why its..." in 2 days; one template slot error ("Every 3D Super Mario Games Game Ranked Worst to Best")                                                                               |
| Pinned comments (M, 70 seen)  | 32 open "What do you make of it?" and 17 "Do you buy that answer, or is there a better one?" (70%); 57/70 include "Sources are in the description"; 2 broken slots on the long videos; none on Shorts from 14 Nov on |
| Script wording (M)            | varied: only "grand theft auto 6" repeats in 5+ Shorts                                                                                                                                                               |
| Caption styles (M)            | 16 styles in rotation (good), but the layout around them never changes                                                                                                                                               |

**Risk (I).** A reviewer or classifier watching 5 Pulse Shorts in a row hears the same sting, the same four beds and the same flat loudness, and sees the same frame and the same closing card. The cheapest fixes are in sound and layout, not in the writers.

## The 10 weakest craft points, ranked by likely effect on retention and subscribers

1. **The body of each Short leaks as fast as the hook (M).** About 4 points a second through the facts, so only 38% of starters are left at the take (n=54). Nothing in the middle escalates: no reveal, no reversal, no number saved for later. _Retention, high._
2. **Template sameness in sound and layout (M).** 100% sting open and close, 58% identical sound sequence, 4 beds for 89 videos, -16 LUFS everywhere, 9/9 identical opening and closing frames. _Monetisation risk plus "seen it" swipes, high (I)._
3. **Topic and title choice for explainers (M).** Question titles median 195 views against 278 for statements. The "Why" series 71 against 233. GTA 6 detail Q&As 16 to 68. _Views, high._
4. **The long-video opening (M).** 122 to 129 words, a purchase frame that does not match the title, the real question at 11 to 18 s, first chapter at 46 to 54 s. San Andreas lost 37% by 36 s and 68% by 3 min. _Long-video watch time, high._
5. **Long-video pictures (M).** 76 to 78% stills, 9 to 12% moving footage, holds of 10 to 15 s. _Long-video retention, high._
6. **Shorts run too long and too slow for their news (M).** Top quarter 31.5 s at 176 wpm; bottom quarter 37 s at 159. Rankings run 50 to 61 s. _Retention, medium to high._
7. **Evergreen Shorts drag (M).** 9 videos, median 104 views, 47.6% viewed, 0 subscribers. Rankings show 6 to 8 identical "rank" cards in a row. _Views and subscribers, medium._
8. **Flat sound design (M).** Game audio in 2 of 28 logged Shorts, no silences, no bed change within a video, loudness range near 1 LU. Nothing in the sound marks a payoff. _Retention, medium (I)._
9. **Voice is thin and uneven (M).** "I" in 36 of 86 Shorts and never in a long video. Takes lean on stock openers and arrive after most viewers have gone. _Subscribers, medium._
10. **Community and subscriber calls (M).** 0.52 comment threads and 0.28 subscribers per 1,000 views; 70% of pinned comments use two stock openers, two have broken slots, Shorts since 14 Nov have none; no reason given to follow. Replies are a strength (14 of 19 answered). _Subscribers, medium._

**Also noted:** about 4 words on screen per second; first frame and title state different ideas in 5 of 18 chosen Shorts; Before You Buy's thumbnail word ("PAY") differs from its title ("Buy").

## Where data is missing

- **Renders.** Only 9 of the 18 chosen Shorts and 1 long video (the pulled FFXIV one) are still on disk. The rest were cleaned off the Mac and were not downloaded from YouTube (the bot check shares the factory's IP). For those, pace and pictures come from the edit plan; loudness, hard cuts and silences are measured only on the 10 renders.
- **Analytics lag.** No rows yet for 16 and 17 Nov Shorts. Curves exist for 56 of the 75 Shorts up to 15 Nov.
- **Comments.** Newest 100 channel threads only.
- **Inferred measures.** Long-video thumbnails are the site images; card reading time is estimated; humour beats were not counted; the monetisation-risk judgement is inference.
