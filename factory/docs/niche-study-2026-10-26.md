# Niche study, 26 October 2026: what breaks out in gaming Shorts and long videos

Built to answer one question: what do the videos that outperform in Pulse's niche do differently, and what should the writers learn from it? Only patterns were taken from the transcripts. Nothing from them is quoted in any script, and nothing was republished.

## Corpus

- **Shorts:** 1,574 found, 1,345 with transcripts (YouTube captions, plus Whisper on this PC for the 691 that had none).
  - They came from 87 channels that make gaming Shorts. The channels were found through 56 topic searches; each channel's Shorts tab gave every Short with its views.
  - From each channel: its 10 biggest Shorts, 4 from the middle and 4 from the bottom.
- **Long videos:** 1,615 found, 1,573 with transcripts. That is the 601 documentaries from the 25 Oct scan plus rankings, news round-ups and essays from 27 more searches.
- **Narrated subset:** 700 of the Shorts (67 channels) are narrated like ours, meaning steady speech for most of the Short. The rest are music edits, clips and skits.

## Method

- **Shorts:** each channel's hits were compared with its own middle and bottom Shorts, then the differences were summed across channels. A big channel's house style cannot pose as a winning pattern this way.
- **Long videos:** the top quarter was compared with the bottom quarter of views per subscriber, within each search topic.
- **Close reads:** three readers each compared the strongest against the weakest:
  - 160 against 160 Shorts;
  - 50 against 50 long videos (first two minutes, chapter list, last 75 seconds), read once for openings and once for structure.
- **Caveat:** the long bottom quarter leans towards giant brand channels (IGN, WatchMojo, GameSpot) and brand-new channels. So the craft findings are correlations, and several AI-written videos with good openings still failed. Angle and packaging matter as much as craft.

## Shorts: what held up

| Finding                                                     | Evidence                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Leaks and credible reports                                  | 4.2x as common in hits as in the same channels' other Shorts (narrated, 10 channels); 3.6x across all                                 |
| Openers posing an answerable question or a surprising claim | 37% of narrated hits against 15% of weak                                                                                              |
| Plain announcements, "I" setups and greetings as openers    | 20% of hits against 49% of weak                                                                                                       |
| Hype words in the hook                                      | rarer in hits (narrated: hits higher in 33% of channels, lower in 49%)                                                                |
| A number in the title                                       | hits higher in 54% of channels, lower in 28%                                                                                          |
| "you" in the script                                         | hits higher in 54% of channels, lower in 38%                                                                                          |
| More words in the first five seconds                        | hits higher in 59% of channels, lower in 28%                                                                                          |
| A turn signposted early                                     | 8 hits, 0 weak                                                                                                                        |
| Ending on a payoff or a callback to the hook                | 43% of hits, 21% of weak                                                                                                              |
| "subscribe" said aloud                                      | 1 hit, 11 weak                                                                                                                        |
| Topics over-indexing in hits                                | conflict (lawsuits, bans, players against a company), PlayStation, GTA, Red Dead, FromSoftware                                        |
| Topics under-indexing in hits                               | plain price changes (0.7x), history pieces (0.7x), "secret" teases (0.75x), EA/Ubisoft business news, roundups                        |
| Length                                                      | no difference among narrated channels; in our own channel, Shorts of 38-44 s held 57% against 39% for those over a minute (19 Shorts) |

Price stories worked in the close read when framed as a conflict (who pays, who gains), not as a figure.

## Long videos: what held up

- **Greetings and brand lines first:** 1 of the top 50 against 15 of the bottom 50. Time-wasters in the first minute: 8 against 21.
- **Openings:**
  - the first words come sooner (0.10 s against 0.19 s);
  - more words in the first five seconds (18 against 15);
  - a number in the opening line (38% against 26%);
  - the most surprising fact spent in the first sentence.
- **Angles:** the top videos pick one engine: a person, a hunt (unreleased, hidden, lost), one failure moment, a rivalry or an underdog. The bottom videos are surveys of well-covered subjects told as even timelines.
- **Titles:**
  - top titles name one subject and its downfall or hidden side (about 11 against 4);
  - "hidden, never released, lost" titles: 7 against 0;
  - calendar titles ("2026", "so far"): 0 against 11;
  - "Top N" titles: 2 against 12;
  - "History of" and "Evolution": 3 against 11;
  - numbers in titles: 36% against 45%.
- **Chapters:**
  - top videos have chapters more often (43 against 36);
  - they are named as turning points with a verb or a conflict, not topic labels;
  - one chapter every 2-4 minutes.
- **Structure:**
  - say how it ends and hold back how it happened;
  - foreshadowing lines in the opening (1.3 against 0.8 per video);
  - numbers used as contrasts, not lists.
- **Rankings:**
  - two or three named criteria;
  - number one withheld on purpose, with contested calls promised;
  - each placement argued against its neighbour;
  - no hedging;
  - one defended surprise.
- **Endings:**
  - a verdict, then a callback to the opening;
  - mostly calls to action: 10 top endings against 24 bottom.
- **Voice:** top rankers speak with a single opinionated voice. Pulse cannot honestly claim to have played anything, so it earns trust through stated criteria and evidence instead.

## What changed in the factory (commit 5144e86ed and after)

- **News writer (src/editorial/editorial.ts):**
  - the hook opens a gap, in one of three shapes, with no hype (now checked);
  - numbers come as a before and after;
  - one turn line;
  - framing by the stake to the viewer, or as a fight;
  - the take answers the hook's question;
  - a number in the title when the story has one;
  - 100 words at most.
- **Story editor:** told what over- and under-indexes among hits. The daily rumour allowance went from 1 to 2 (labelled; single-source stories still wait for the owner's tap).
- **Ranking writer (src/editorial/longform.ts):**
  - intro of 120 words at most, opening on the most surprising fact;
  - two or three criteria, a withheld number one and a promised argument;
  - placements argued against their neighbours, with no hedging and one defended surprise;
  - an outro that returns to the opening;
  - titles without years or counts.
- **Documentary planner and intro (src/editorial/documentary.ts):**
  - one engine per story;
  - headline chapter names;
  - subject-plus-downfall titles;
  - the outcome given away in the intro, the how held back, and one line that leans forward.

Working files (transcripts, scripts, reports) are in the session scratchpad under `corpus2/`: `discover.py`, `fetch.py`, `whisper_fill.py`, `analyse.py` and `analyse_narrated.py`. Rerun them to refresh the study.
