# Small-channel outliers: what wins strangers (27 Nov 2026)

One-off study on the PC. The set is the 25 Nov small-channel outliers: gaming videos from 11 to 25 Nov, channels with 500 to 100,000 subscribers and views at 10x subscribers or more. English titles only: 52 Shorts and 29 long videos, out of 107. They are compared with the 18 Nov big-channel study (27 breakout Shorts, 25 long videos) and with Pulse's own 86 Shorts from 1 to 17 Nov.

## What failed: no transcripts

The plan was to fetch captions for 10 videos (7 Shorts, 3 long), one at a time, 5 minutes apart. Both guards were clear at 10:35 UTC: the PC orchestrator showed no YouTube pause, the Mac mini's ytguard block had ended on 26 Nov and its log had no "fetching paused" line in the last 6 hours. The first fetch still failed at 11:02 UTC:

> ERROR: [youtube] vw8PY8Rb3KA: Sign in to confirm you're not a bot.

The job stopped there as designed. It used 1 fetch of 10, with no retries, no cookies and no mirrors. **So nothing below comes from transcripts.** First sentences, where the payoff lands, "I" in the narration and the counts of names and numbers could not be measured. Everything here comes from titles, public view and comment counts (all 107 videos) and the 81 English thumbnails, which I looked at and coded by hand.

Picks kept for the next try (D:\pulse-data\scratch\frontier\small-outliers-1127\picks.json): Rocket League "playing it wrong", "How to Crack Lucia", "GTA 6 Is TRASH", "5 Things You NEED To Know", Phantom Blade Zero vs Black Myth, "Why No One Cares About Xbox", "Epic managed to piss off game devs", "15 Ways to Make Money in GTA 6, Ranked", "How Rockstar Built Leonida", "15 Early Game Mistakes".

## Counts (titles and numbers, English only)

"Comments" means comments per 1,000 views (median). "Ratio" means views divided by subscribers (median).

| Pattern in the title                                                                  | Small Shorts (52) | Comments | Ratio | Pulse Shorts (86)                         |
| ------------------------------------------------------------------------------------- | ----------------- | -------- | ----- | ----------------------------------------- |
| Whole set                                                                             | 52                | 0.45     | 82x   | 1.11 comments per 1,000 overall, median 0 |
| Says "you" / "your"                                                                   | 13 (25%)          | 0.24     | 41x   | 7 (8%)                                    |
| About the viewer's own play (you, how to, mistakes, wrong, before playing, miss this) | 15 (29%)          | 0.27     | 77x   | 7 (8%)                                    |
| Stated stance (trash, woke, no one cares, not even close, piss off)                   | 7 (13%)           | **2.91** | 88x   | 1 (1%)                                    |
| Question mark                                                                         | 12 (23%)          | 0.77     | 55x   | 8 (9%)                                    |
| "Why"                                                                                 | 4 (8%)            | 1.93     | 98x   | 14 (16%)                                  |
| Head-to-head ("vs")                                                                   | 3 (6%)            | 0.08     | 218x  | 0                                         |
| Says "I" / "my"                                                                       | 3 (6%)            | 0.29     | 16x   | 0                                         |

| Pattern in the title                                                                                      | Small long (29) | Comments | Ratio         |
| --------------------------------------------------------------------------------------------------------- | --------------- | -------- | ------------- |
| Whole set                                                                                                 | 29              | 1.45     | 38x           |
| Ranking or tier list                                                                                      | 15 (52%)        | 2.45     | 35x           |
| Ranking that says "I" / "my"                                                                              | 6 of those 15   | **2.88** | (others 2.16) |
| A number plus a promise to cover everything (N things, every, all, ranked)                                | 10 (34%)        | 3.00     | 54x           |
| "Don't X" or danger hook in the title                                                                     | 1 (3%)          | 1.20     | 72x           |
| Story of one decision or build ("How Rockstar Built Leonida", "The Last Game Boy", "Why Marathon Failed") | 4 (14%)         | 1.33     | 164x          |

GTA 6 launch week skews the Shorts: 21 of the 52 English Shorts are GTA, with a median ratio of 414x against 35x for the rest. Most of those GTA hits are clips of in-game moments (NPCs, randomness, comparisons), not news.

## Thumbnails (hand-coded, 81)

|                                                | Small Shorts (52) | Small long (29)                                                         |
| ---------------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Designed headline text                         | 24                | 21                                                                      |
| of which 2 or 3 words                          | 10                | 12                                                                      |
| of which 4 or more words                       | 11                | 8                                                                       |
| of which 1 word or a single figure             | 3                 | 1                                                                       |
| A frame with a caption burned in, not designed | 16                | 0                                                                       |
| No text                                        | 12                | 8                                                                       |
| "Don't X" / "Stop X" danger text               | 0                 | 2 ("STOP ROBBING STORES", "DON'T FINISH CHAPTER 1!", both GTA 6 guides) |

Compared with GameSight (number plus completeness, "Don't X", 2 to 3 words of text):

- A number plus completeness in the title: 10 of 29 long outliers (34%), and they have the highest comment rate in the long set (3.0).
- 2 or 3 words of thumbnail text: 12 of 29 long videos (41%), the most common choice. 8 use no text at all.
- "Don't X": rare in titles (1 of 29). The two GTA guide videos use it on the thumbnail instead, with the plain list title underneath. That is the same split GameSight uses.
- Shorts are a different form: most Shorts thumbnails are a frame from the video, and only 10 of 52 use designed text of 2 or 3 words.

## Where small outliers differ

**From the big-channel hits (18 Nov).** The big hits won with a held-back answer paid at 87% of the runtime, and comments followed stated takes (0.81). The title data agrees on the second point: the 7 stance titles get 2.91 comments per 1,000, about six times the set median of 0.45, and the six long rankings that say "I" or "my" ("I Ranked 30 Best Action Games", "My Tier List") get 2.88 against 2.16 for rankings without one. The first point (held-back answer) could not be tested without transcripts. Small Shorts run a little shorter (median 48 s against 62 s), and 20 of 52 pass one minute.

**From Pulse.** Pulse titles are about the industry: sales charts, studios, prices. Pulse uses "you" in 8% of titles against 25%, a stance in 1% against 13%, and never runs a head-to-head. Pulse asks "why" twice as often (16% against 8%). The 18 Nov study had already found that Pulse's "why" Shorts fail on questions nobody is asking.

## What the 25 Nov hypothesis said, and what holds

- **"Shorts that win strangers are about the viewer's own play."** This is common (29% of titles, against Pulse's 8%), but it does not outperform inside the set. Those 15 titles sit below the set median on ratio (77x against 82x) and on comments (0.27 against 0.45). The pattern describes how small channels get found during a launch week (guides and "most people miss this" on a game everyone is playing). It is not a premise that beats the rest. **Weaker than claimed; not confirmed.**
- **"A stated stance draws comments."** This holds across all 7 stance Shorts, not just the two in the notes: 2.91 against 0.45. The 19 Nov retention check found that a stance on its own does not hold viewers. So stance is a comment lever, not a retention lever.
- **"Long winners are personal rankings."** This holds: 15 of 29 are rankings, and the ones that say "I" draw the most comments.
- **"Story docs about one decision."** Only 4 videos, but they have the highest median ratio in the long set (164x).

## Rated for the writers' room

1. Stance where the story supports one: a clear, arguable verdict in the title or first line. Comments roughly x6. Keep the room's rule that the verdict lands after the answer in the script.
2. Long rankings argued in the first person ("I ranked", a verdict for each entry), with a number plus completeness in the title, and a 2 to 3 word or "Don't X" thumbnail for guides.
3. Viewer's-own-play angles are one option among four, mainly for a game that has just launched (GTA 6 now). They are not a default.

Data: D:\pulse-data\scratch\frontier\small-outliers-1127\ (title_counts.json, thumbs\sheet0-6.jpg, picks.json, progress.md).
