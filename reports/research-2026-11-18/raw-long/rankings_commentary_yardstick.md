# Long rankings, news-commentary and one franchise history: the yardstick

Research date: 18 November 2026. Research only: no code or settings were changed.

Why: Pulse's long ranking "Every Mainline GTA Game, Ranked" got 2 views, and Pulse long videos are watched for about 21% of their length.

**Labels**

- **M (Measured):** computed from the transcripts, metadata or comments saved on disk.
- **S (Snippet):** as reported by a vidIQ watch or a video description. Not verified frame by frame.
- **I (Inferred):** my judgement or estimate.

**Raw files** (all in raw-long):

- `transcript_<id>.txt`
- `watch_<id>.md` (for A, F and I)
- `comments_<id>.json` (for A, D, F, I and K)
- `rankings_commentary_metadata.json`

**Metrics and labelling notes**

- The metrics come from `analyse_transcript_txt.py`.
- Videos B, D, J and K were measured by a helper agent using the same scripts. Its report labelled B and D the other way round; that is corrected here.
- **Sentence metrics are invalid for D and I.** Their transcripts are auto-captions with no punctuation.
- **Words per minute (wpm) in I includes game dialogue clips.**
- **Evaluative-sentence shares come from two methods:**
  - manual reads of a 1,000-word sample that starts at the 25% mark (A, B, D, H, J, K);
  - a keyword heuristic on that same sample (C, F, G, I). The heuristic undercounts, so treat it as a floor (I).

**vidIQ credits used: 160 of 165**

| Call type                               | Count | Credits |
| --------------------------------------- | ----- | ------- |
| get_videos_by_ids                       | 1     | 5       |
| channel_videos                          | 2     | 10      |
| transcripts (A, B, C, D, E, G, H, J, K) | 9     | 45      |
| watches (A, F, I)                       | 3     | 75      |
| comments (A, D, F, I, K)                | 5     | 25      |
| get_images, job_poll                    | -     | free    |

---

## A. DIBZ: "Every Mortal Kombat Game Ranked WORST to BEST" (eHafVx7zJxk)

1.91M views; 28:53; 38x the channel's breakout score (DIBZ median for its last 50 long videos: 12.5K, M).

**Packaging**

- Title pattern: "Every X Ranked WORST to BEST". 8 words, with capitals on the contrast words (M).
- Thumbnail: 2 words, "BEST" over a green bar and "WORST" over a red bar. The cover art is split: Mortal Kombat 11 under BEST and Mortal Kombat 1 (2023) under WORST.
- Promise: a verdict that picks a fight. The thumbnail itself shows a hot take, the newest game ranked worst.
- Timing: the description ties the video to the newly announced Legacy Kollection.

**Opening (M from the transcript, S from the watch)**

- 0-10 s: "I played every single game so you don't have to". A tier list from S down to F. The host is keyed into an arcade cabinet, then into a tier board (S).
- 10-30 s: even the Game Boy Advance versions are included, with a joke aimed at "MK Advance". At 0:23 he says there are "hot takes" and "you're not going to agree", and asks for comments.
- 30-60 s: the first entry starts at **0:33** (Mortal Kombat 1992): roster, digitised sprites, janky gameplay.
- 60-120 s: the first verdict comes at 1:12 (A tier) with a lock-in sting (S). Mortal Kombat II follows and is sent "straight to S tier" at 2:22.
- Ranking criteria: never formally stated. They are implied at 0:00-0:30 (gameplay, impact, nostalgia, per the description).
- Promises made in the first minute:
  - "every single game": paid by 24:52 (23 entries).
  - "hot takes": paid at 3:27 (MK3 in C tier), 4:14 (a new "god tier" is invented), 9:04 (a "By the Elder Gods" tier below F) and 21:36 (MK11 in A tier).

**Structure**

- Story engine: one fan replays the whole series in release order and drops each game onto a tier board. It is not a countdown, so every placement is its own small payoff.
- Entries: 23 (S). Seconds per entry (S, from the watch timings):
  - min 10 (MK Gold), median 63, max 189 (MK1 2023)
  - first-half mean 59, second-half mean 84
  - time grows towards the newest games (MK11 154 s, MK1 189 s), not towards a number 1
- Is the order argued? Yes:
  - hot takes are signposted at 0:23
  - "a little bit of a controversial take" at 8:00
  - two new tiers are invented as escalation (4:14 and 9:04)
- Through-line: personal history. At 5:05 he shows the Trilogy disc he has played since childhood, plus "I used to rank this at A tier" re-evaluations at 10:07 and 14:30.
- Stakes for a top spot: none (a tier list). The stakes are each individual placement.
- Re-hooks: escalating tiers and running asides. No classic open loops. At 27:21 there is a VHS-glitch insert, a post-production update about MK1 DLC being cancelled (S).
- Ending:
  - 28:01: the full board is shown and he asks "do you agree?"
  - 28:13-28:52: thanks as the channel nears 100K subscribers, membership perks, gratitude.

**Pace (M)**

- 201.5 wpm; 185-212 per 5 minutes.
- 113 words in the first 30 s; 113/130/120/130 per 30 s across the first 2 minutes.
- Sentences: mean 13.3 words, median 11; 35% are 8 words or fewer.

**Sound (S)**

- About 23 music beds, one per game, matched to that game's era: roughly 8 cue changes per 10 minutes.
- A lock-in hit or swoosh on every placement.
- A bass-drop sting with the vocal "Oh shit!" at 4:24.
- A comedic beat drop when the bottom tier is created (9:11).
- No dead air.

**Narrator**

- Per 1,000 words (M): I 38.8, you 15.1, we 4.3.
- Evaluative sentences in the 1,000-word sample: about 38 of 79, roughly 48% (manual read, I). That includes 6 tier placements in 1,000 words.
- Humour: yes and frequent. Examples: "Trilogy is UMK3 on bath salts"; making a "whole new tier".
- Sources named on air: almost none. 1.4 source words per 1,000 (M); 12.1 numbers per 1,000 (M), mostly game numbers.
- Personal stakes: high (childhood disc, past rankings he now disowns, playing everything for the video).

**Visuals (S)**

- About 84% full-screen game footage with the host keyed in.
- About 8% the tier-board graphic.
- About 5% menus and select screens.
- About 3% motion graphics.
- Cuts: 12.7 per minute in the intro, 7-8 per minute in the body. Average shot 2.5-4 s in the intro, 7.5-8.5 s in the body.
- Every entry uses the same loop: title, select screen, clips, board.

**Community (M)**

- Per 1,000 views: 1.38 comments and 11.54 likes.
- Like-weighted themes in the top 100 threads:

| Theme                                          | Like share |
| ---------------------------------------------- | ---------- |
| Arguing with placements or posting own ranking | 27%        |
| Jokes                                          | 18%        |
| Corrections                                    | 6%         |
| Nostalgia                                      | 3%         |

- Top comment: an MK11 placement argument (3,467 likes, 301 replies).
- The creator's pinned comment asks for viewers' S-tier and F-tier picks (311 likes, 69 replies). He made 11 creator replies in the returned threads.

---

## B. TheGamersJoint: "Every Kingdom Hearts Game From WORST to BEST" (5EJVAUQCda0)

327K views; 1:05:30; 15x breakout. Measured by the helper agent.

**Packaging**

- Title pattern: "Every X Game From WORST to BEST". 8 words (M).
- Thumbnail: 2 words, "WORST → BEST" with an arrow, over 5 box arts on a burst background.
- Promise: the complete list, from a known superfan (decade-long channel). No placement is visible.

**Opening (M)**

- 0-10 s: a decade covering the series but never a full ranking.
- 10-30 s: the long-requested video; even the low entries are fun.
- 30-60 s: superfan self-mockery, then "my opinion, sorry fans".
- 60-120 s: the criterion "total package" at 1:04. A sponsor read runs 1:13-2:40 (about 87 s).
- First entry: 2:40.

**Structure (M)**

- 13 entries. Minutes per entry: min 2.3, median 3.95, max 11.3.
- Time grows towards the top:
  - #13-#10 average 3.3 min
  - #9-#6 average 4.3 min
  - #5-#2 average 7.5 min
  - except #1 (Kingdom Hearts 2), which gets about 2.3 min as a comic hype rant
- Controversy is signposted at 8:34, 19:13, 32:56 and 51:34 ("most controversial").
- Through-line: lore, and his hopes for Kingdom Hearts 4. No stakes for #1 ("to no one's surprise").
- Ending: about 40 s; asks viewers to post their own order.

**Pace (M)**

- 192.5 wpm; 168-211 per 5 minutes.
- 118 words in the first 30 s.
- Sentences: mean 17.4 words, median 15; 22% are 8 words or fewer.

**Narrator**

- Per 1,000 words (M): I 19.0, you 10.2, we 9.3.
- Evaluative sentences: about 22 of 55, roughly 40% (manual, I).
- Humour: constant.
- About 10 named entities or numbers per 1,000 (I).
- Personal stakes: very high.

**Community (M):** 3.04 comments and 21.97 likes per 1,000 views. Comments were not fetched.

---

## C. TheStickz6: "I Ranked Every Assassin's Creed Game From Worst to Best" (jJoEAAHAGGw)

467K views; 42:01; 22x breakout.

**Packaging**

- Title pattern: "I Ranked Every X Game From Worst to Best". 10 words (M), and first person.
- Thumbnail: 3 words, "RANKING EVERY GAME", plus the tier letters S, A, B and C. A tier grid of 14 covers is visible (Origins and Mirage in S; Odyssey and Valhalla in C), with Basim cut out on the right.
- Promise: the full list, with some placements visible.

**Opening (M)**

- 0-10 s: "that time again where you all yell at me in the comments". He is inviting disagreement at 0:03.
- 10-30 s: 14 mainline games; how good are they really; worst to best.
- 30-60 s: his opinions have changed since his last list; spoilers warning; "the answers might surprise you" (0:47).
- First entry: 0:52 (Rogue).
- Criterion: "ranking these as Creed games", with story weighted higher. Stated at 3:33 and again at 6:53, inside entries.

**Structure**

- 14 entries; one chapter per rank (S, from the description).
- Seconds per entry (M, from chapters): min 147, median 177, max 244.
- Bottom seven average 184 s, top seven 169 s, so the time is **flat**.
- Controversy is signposted at 9:36 (Shadows "polarizing") and 16:50 (Black Flag at #9: "this is where the comments really start to roast me").
- A subscribe gag at 16:28 is tied to the next entry ("before I make you angry with my next entry").
- Through-line: personal history. AC2 was his first game. Brotherhood inspired him to move to the other side of the world (about 32:00). Origins brought him back to the series.
- Ending: asks for viewers' top 5 and promises to read every comment.

**Pace (M)**

- 198.9 wpm; 191-211 per 5 minutes.
- 115 words in the first 30 s.
- Sentences: mean 13.6 words, median 12; 27% are 8 words or fewer.
- 8 [music] stings at entry boundaries.

**Narrator**

- Per 1,000 words (M): I 30.6, you 10.3, we 5.0.
- Evaluative sentences: 28% of the sample by keyword heuristic (I; a floor).
- Humour: dry ("friend-zoning you" for Shadows; "Marvel anti-hero number 463").
- Sources on air: almost none (0.4 per 1,000, M).
- Personal stakes: high.

**Community (M):** 2.63 comments and 9.64 likes per 1,000 views.

---

## D. Scott's Stash: "Ranking the Worst Nintendo Games" (b8hul-CG3Us)

1.16M views; 1:40:37; 3.6x breakout. Second channel of a big creator. Measured by the helper agent. Auto-captions, so sentence metrics are invalid.

**Packaging**

- Title pattern: "Ranking the Worst X". 5 words (M).
- Thumbnail: "RANKING THE WORST Nintendo GAMES" (5 words with the logo). The host's face looks sceptical at the camera, surrounded by box arts.
- Promise: a contrarian look at a beloved brand.
- Timing: released on Switch 2 Direct day. 47.8% of like-weighted comments are about that timing.

**Opening (M)**

- 0-10 s: a joke rebutting "you're so negative".
- 30-60 s: the stance at about 0:34. Nintendo is not above digital-only releases, microtransactions or rushed games.
- First entry: 1:36.
- A loose criterion arrives only at 44:23.

**Structure (M)**

- About 24 placements covering about 30 games.
- Minutes between placements: min 0.6, median 3.8, max 11.1.
- Time **shrinks** across the video: first-half average 5.7 min, second half 2.5 min.
- Controversy is signposted at 3:31.
- Through-line: personal grudges (DS browser, Chibi-Robo), which pay off as an end gag.
- Ending: abrupt, about 30 s, no call to action.

**Pace (M)**

- 195.9 wpm; 176-225 per 5 minutes.
- 103 words in the first 30 s.

**Narrator**

- Per 1,000 words (M): I 40.0, you 28.2, we 2.6.
- About 18 verdict clauses in the 1,000-word sample (I).
- About 12 named entities or numbers per 1,000 (I). Examples: IGN "3 out of 10", "$30", Wikipedia.
- Childhood stories (spending allowance money on the DS browser).

**Community (M)**

- Per 1,000 views: 1.65 comments and 17.49 likes.
- Like-weighted themes in the top 100:

| Theme                            | Like share |
| -------------------------------- | ---------- |
| Topical (Direct day, $80 prices) | 47.8%      |
| Nostalgia                        | 21.3%      |
| Jokes                            | 16.9%      |
| Arguing with placements          | 13.4%      |
| Praise for the creator           | 2.3%       |

- No creator comment.

---

## E. DIBZ underperformer: "Fans Rank EVERY Mortal Kombat Game From WORST to BEST!" (H0PyUASjFoM)

10,267 views; 31:08; published 9 August 2025, two months after A.

**How far below?** It got 1/186 of A's views on the same subject and at the same length. It is 0.8x the channel's last-50 median (12.5K).

**Caveat:** no DIBZ long video in the list is far below the median. A is the outlier, and E is a typical DIBZ result (M).

**Packaging**

- Title pattern: "Fans Rank EVERY X Game From WORST to BEST!". 10 words (M).
- Thumbnail: no words, only the numbers 1-5 on a coloured board with 5 box arts. The host holds a microphone next to a Goro cosplayer at a convention.
- Promise: a street-interview game. Unclear what the viewer gets.

**Opening (M)**

- 0-13 s: a soundbite cold open from several fans.
- 0:15: the rule (blind draw: place each game without knowing what comes next).
- 0:25: the first placement.

**Structure (M)**

- About 16 interview rounds of 5 random games each, about 2 min per round.
- The order is decided by luck: one fan ends with Mythologies at #1 "because of how it drew".
- There is no host verdict, no thesis and no through-line.

**Pace (M)**

- 207.8 wpm across many speakers.
- 85 words in the first 30 s.
- 499 speaker turns, so the sentence metrics reflect dialogue.

**Narrator (M)**

- I 67.1 per 1,000 (many speakers).
- Evaluative sentences in the sample: 18% (heuristic, I). The opinions belong to strangers.

**Community (M):** 9.93 comments and 34.67 likes per 1,000 views. That is high per view but tiny in total: core subscribers only (I).

---

## F. Luke Stephens: "A Skeptical Look at 'Grand Theft Auto VI'..." (GKfom_Qa5Hs)

784K views in about one day; 37:24; 3.3x breakout. Published the day before the review embargo.

**Packaging**

- Title pattern: "A Skeptical Look at 'X'...". 8 words (M), with a trailing ellipsis.
- Thumbnail: 3 words, "A skeptical look...", in plain white over GTA VI key art (Jason and Lucia).
- Promise: a contrarian take on the biggest hype of the year.

**Opening (M, with visuals S)**

- 0-10 s: "GTA 6 hype has reached a fever pitch".
- 10-30 s: "about 15 million pre-orders", called "absolutely mental", shown on a Sensor Tower dashboard (S).
- 30-60 s: "these are just estimates". Rockstar is among the most respected developers and regularly scores 95+.
- 60-120 s: at 1:21 the reason for the video: re-evaluate so a 9.5 does not feel like a let-down. He will look at the "sceptical takes" and "evaluate them fairly" (1:52).
- Stance (verdict first, "TLDDW"): **2:15**. Rockstar is exceptional and deserves the hype.
- 3:11: promises "some things some of you guys will not like" about the game. Paid at 23:16 (realism) and 29:03 (30 fps).
- 3:43-4:20: a subscribe ask, framed as bonuses for his named editors.
- First claim: 4:21.

**Structure**

- Story engine: five sceptic claims, each stated, tested against evidence, then a verdict. It works as a fair trial of the hype.
- Sections (S, from chapters and the watch):

| Section                             | Start | Length |
| ----------------------------------- | ----- | ------ |
| Hidden-game claim                   | 4:21  | 3:21   |
| Dan Houser departure                | 7:42  | 7:13   |
| Rockstar "changed"                  | 14:55 | 8:27   |
| Realism                             | 23:22 | 5:41   |
| 30 fps                              | 29:03 | 2:57   |
| Conclusion on post-hype "what now?" | 32:00 | 4:24   |

- Every section opens on a verbal signpost ("The first claim I want to look at...").
- Ending:
  - 36:24: practical news (New Zealand launch timing)
  - 36:58: a comment question ("are you doing the New Zealand trick?")
  - then the subscribe ask and sign-off; no end slate (S)

**Pace (M)**

- 214.2 wpm; 197-224 per 5 minutes.
- 97 words in the first 30 s.
- Sentences: mean 15.8 words, median 12; 33% are 8 words or fewer.
- 3.7 questions per 1,000.

**Sound (S)**

- About 5 low ambient music beds in 37 minutes (about 1.3 per 10 minutes).
- No SFX, no stingers, no external voice clips. All quotes are read aloud.
- Natural laughter pauses.

**Narrator**

- Per 1,000 words (M): I 20.7, you 23.7, we 5.5.
- Evaluative sentences: 27% (heuristic floor, I).
- Sources and numbers (M): 19.1 numbers per 1,000 and 2.4 source words per 1,000.
- Examples of sources named on air:
  - a Lex Fridman podcast, shown as a still (7:42)
  - a Polygon lawsuit article (10:50)
  - a Wikipedia page on Rockstar India
  - a live Google Street View comparison (19:34-21:05) (S)
- Personal stakes: his own stream chat, travel to Miami, Red Dead 2 history.

**Visuals (S)**

- About 58% desk face-cam.
- About 18% full-screen trailer or game footage.
- About 12% picture-in-picture over game footage.
- About 12% articles, websites or maps.
- Cuts: 7.4 per minute in the intro, 4-7 per minute in the body (shots of 8-15 s).

**Community (M)**

- Per 1,000 views: 3.6 comments and 19.08 likes.
- Like-weighted themes:

| Theme                        | Like share |
| ---------------------------- | ---------- |
| Agreeing with the stance     | 28%        |
| Nostalgia or own GTA history | 28%        |
| Praise for Luke              | 16%        |
| Jokes                        | 14%        |

- Top comment (2,160 likes): agrees there is too much hype, then recalls Red Dead 2.
- A minority note the gap between title and content. Examples: "37 minute glaze session" (59 likes); "skeptical about this video being skeptical" (156 likes).
- The creator's pinned comment is a subscribe or bonus ask (168 likes).

---

## G. Luke Stephens: "Star Citizen officially went too far... After making $800M..." (RjVgI2CfZHI)

1.31M views; 23:31; 4x breakout.

**Packaging**

- Title pattern: "X officially went too far... After making $[number]...". 9 words (M), including a number.
- Thumbnail: 2 words, "Pure Greed...", over game art.
- Promise: an outrage verdict backed by a striking number.

**Opening (M)**

- 0-10 s: the stance, **in the first sentence**: "officially overstepped". The community is revolting after spending $800M.
- 10-30 s: it sounds like a fake headline, but it is true, and he will "show all of it".
- 24 s: his credentials. He has played the game on his live channel (a funeral in space).
- 30-120 s: steel-man. The tech is "insane", with seamless planets, and is compared to Starfield.
- Then the money: $800M from 5.6M people, $20M in a month.
- 5:40: an open loop ("just you wait"), then a newsletter read (5:50-6:27, about 37 s), then the payoff at 6:27 (the paywalled ship modules).

**Structure**

- Story engine: what they did, why it is wrong, why now.
- Acts (S, from chapters): 0:00 money pit, 6:31 the mistake, 15:10 the motive.
- 15:59: "that's all going to tie into this in just a minute" (a re-hook).
- 16:47: a clip from another YouTuber (SaltEMike), credited on air and in the description.
- 17:52: company financials shown on screen.
- Ending: a forecast, "I don't see this ending well". A conditional: if they walk it back he will pin a comment. A comment question aimed "as gamers".

**Pace (M)**

- 206.3 wpm; 202-214 per 5 minutes.
- 94 words in the first 30 s.
- Sentences: mean 15.9 words, median 12.5; 35% are 8 words or fewer.

**Narrator (M)**

- Per 1,000 words: I 17.3, you 24.5, we 4.9.
- Evaluative sentences: 17% (heuristic floor, I).
- 13.0 numbers and 3.1 source words per 1,000.
- Uncertainty is flagged on air: "some people are saying 3 months, others 6... no confirmation" (10:17).
- Direct audience framing: "if you're watching this channel, chances are you're just a gamer" (3:48).

**Community (M):** 7.74 comments and 26.11 likes per 1,000 views. Comments were not fetched.

---

## H. Luke Stephens underperformer: "The most unhinged GTA 6 theories..." (xIeMojqlz1E)

122K views; 23:29; published 11 May 2026.

**How far below?** It is 0.45x his last-50 median (271K, M). His other GTA videos in the same list got 276K to 859K.

**Packaging**

- Title pattern: "The most unhinged X theories...". 6 words (M).
- Thumbnail: 2 words, "Pure insanity...", over art of the GTA VI leads in tinfoil hats.
- Promise: other people's wild theories, entertainment. The viewer has nothing at stake.

**Opening (M)**

- 0-10 s: "kind of a big deal". People map stars and count bullet holes. This is a generic first line with no claim.
- 15 s: "some stuff that will blow your mind".
- 30-60 s: rules out the map-mapping project as "just mathematics".
- 1:04: the first theory (Braille in bullet holes), which ends with its date already proven wrong.
- There is no stance on the game. The only verdict is about the theories (pareidolia, at 11:14).

**Structure**

- Story engine: a round-up of Reddit and Discord posts.
- The 27 conspiracy builds to an anticlimax on purpose (Rockstar posts a hoodie sale, 10:08). Then an astrology prediction for 14 May, then real signals for a May reveal.
- Recorded on 10 May about a 14 May prediction: "by the time you're seeing this, maybe trailer 3 already dropped". It has a shelf life of days (I).

**Pace (M)**

- 191.3 wpm; 182-199 per 5 minutes.
- 101 words in the first 30 s.
- Sentences: mean 14.2 words, median 10; 43% are 8 words or fewer.

**Narrator**

- Per 1,000 words (M): I 21.6, you 18.7, we 7.8.
- Evaluative sentences: about 4% by heuristic. A manual read gives about 8 of 78 (about 10%, I), all about the theorists, none about the game.
- 7.2 source words per 1,000 (M): the highest of the set. It is other people's posts read aloud rather than his own case (I).

**Community (M):** 3.31 comments and 36.75 likes per 1,000 views.

---

## I. The Act Man: "How To Destroy A Franchise - Dragon Age Veilguard" (9HK6tBt8SqQ)

2.12M views; 29:58; 2.8x breakout. Auto-captions: sentence metrics are invalid and wpm includes game dialogue.

**Packaging**

- Title pattern: "How To Destroy A Franchise - X". 8 words (M). An ironic how-to frame.
- Thumbnail: 4 words, "HOW TO DESTROY DRAGON AGE". A distorted, screaming character face sits beside the host facepalming in prop horns.
- Promise: a comedic takedown.

**Opening (M, S)**

- 0-10 s: a greeting, a record scratch, a "foul stench" sniff gag.
- 10-30 s: an Elden Ring Dung Eater clip. The smell comes from his PC after 3 hours of Veilguard. Then a Chappelle clip.
- 30-60 s: the verdict at **0:31** ("the only thing Dragon Age is going to return to is the dirt"). Then a pronoun-dialogue clip, a Mass Effect meme, and a reminder that Inquisition won Game of the Year a decade ago.
- 60-120 s: the dialogue mocked with a film clip. BioWare's 2003-2011 peak montage (1:42) and a quote card from BioWare (1:56).
- 2:28: a concession: "if you're having fun with the game don't let me... stop you".
- 3:01: "Origins is BioWare's best game, fight me in the comments".
- 3:18: the thesis frame: an "instructional training video" in steps.

**Structure (S)**

- Story engine: six "steps to destroy a franchise", each one a failing set against the old BioWare.
- Steps start at 3:28, 7:23, 10:29, 16:49, 18:42 and 23:59, lasting 1:53 to 5:54.
- Each step has a red title card, a ding and a comparison close.
- Conclusion at 28:25: the verdict, he will not keep playing, and "Larian are the new BioWare". Patreon credits, then the sign-off.

**Pace (M):** 175.4 wpm including clips; 159-190 per 5 minutes; 79 words in the first 30 s.

**Sound (S)**

- Six music changes in the first 3.5 minutes, then a bed per step.
- Dead-air drops before punchlines (0:29, 1:09, 8:04, 13:15, 18:59).
- Vine booms, cash-register and slide-whistle SFX.
- Game dialogue used as punchlines.

**Narrator**

- Per 1,000 words (M): I 35.4, you 32.5, we 3.6.
- Evaluative units: 16% of 15-word chunks (heuristic floor, I).
- Humour: a meme or film insert every 45-90 s (S).
- Sources: quote cards with year and developer (S); 3.2 numbers per 1,000 (M).

**Visuals (S)**

- 38% Veilguard footage.
- 22% archival footage (Origins, Mass Effect, KOTOR).
- 18% face-cam.
- 12% cutscenes with their own audio.
- 5% memes.
- 3% title cards.
- Cuts: 21.8 per minute in the intro, 11-14 per minute in the body.

**Community (M)**

- Per 1,000 views: 5.49 comments and 37.02 likes.
- Like-weighted themes:

| Theme                       | Like share |
| --------------------------- | ---------- |
| Studio or writing criticism | 37%        |
| Quoting or riffing jokes    | 30%        |
| Arguing over "worst"        | 10%        |

- Top comment (8,936 likes): about being banned from a subreddit for criticising a character.
- The creator's pinned comment is the description and Patreon (781 likes); 6 creator replies.

---

## J. Moon Channel: "Why Do So Many Gacha Games Pretend to Be Japanese?" (WSMl4c59I9Y)

132K views; 2:15:08; 0.89x breakout, so not a hit. This is the lawyerly-essay contrast. Measured by the helper agent.

**Packaging**

- Title pattern: a question plus a subtitle. 18 words (M).
- Thumbnail: no words. A cartoon gacha machine with Japan, China and South Korea flags and a pondering lawyer.
- Promise: a puzzle investigation.

**Opening (M)**

- 0-2 min: defines gacha and points out the oddity (Chinese and Korean games dressed as Japanese).
- "But why?" at 2:11. Thesis at 2:57.
- A four-part roadmap at 3:29-4:03. Branded sign-on at 4:03.
- A promise at 0:18 (why miHoYo has a Japanese name) is paid about 110-120 minutes later.

**Structure (I)**

- 21 chapters, averaging about 6 minutes.
- The games mostly vanish until about 70 minutes in.
- Re-hooks: "as we'll soon see" (35:10, 1:46:57); callbacks at 1:07:48 and 1:14:06.
- No sponsor. Ends with a personal moral address.

**Pace (M)**

- 162.1 wpm, drifting down from about 180 to about 150.
- 101 words in the first 30 s.
- Sentences: median 14 words; 24% are 8 words or fewer.

**Narrator (M)**

- Per 1,000 words: I 5.9, you 10.0, we 3.7.
- About 25% of narrator sentences are evaluative (manual, I).
- About 17 named people or entities per 1,000 (I). Examples: Tezuka, Hanna-Barbera, "1983".

**Community (M):** 9.10 comments and 60.71 likes per 1,000 views. That is a very engaged niche, but small reach.

---

## K. Nick930: "History of ARMY MEN Games (1998 - 2026) | Documentary" (6WUqYrlSmxE)

280K views; 3:10:58; 4x breakout. Measured by the helper agent.

**Packaging**

- Title pattern: "History of X Games (years) | Documentary". 8 words (M).
- Thumbnail: 4 words, "HISTORY OF ARMY MEN". One iconic green soldier and barbed wire.
- Promise: a nostalgic, complete history.
- The description promises "never-before-seen" concept art and design documents.

**Opening (M)**

- 0-10 s: welcome, with a hook to the new Toy Story film.
- 10-30 s: "used to be inescapable", then the title clip (so only 59 words in the first 30 s).
- 60-120 s: "this is not one of those stories". The thesis at 1:10: a cautionary tale about what went wrong.
- Thanks to the Video Game History Foundation, plus subscribe and Patreon, at 1:59-2:32.

**Structure**

- Story engine: a chronological rise and collapse (Trip Hawkins, 3DO, a flood of releases, bankruptcy, fan projects).
- 27 chapters: an 8.9-minute 3DO origin, then about 24 game chapters averaging about 6.9 minutes, shrinking to 4-6 minutes late on (I).
- Re-hooks: "would soon change the face of 3DO forever" (11:08); "more on that later" (18:28, 1:08:10).
- No sponsor.
- Ending: "worth giving another chance"; asks for favourites; credits.
- The promise that it "could foreshadow" today's industry is not explicitly paid (I).

**Pace (M)**

- 155.2 wpm; 145-167 per 5 minutes.
- Sentences: mean 26.1 words, median 25; 9% are 8 words or fewer.

**Narrator (M)**

- Per 1,000 words: I 1.8, you 1.8, we 1.0.
- About 28% of narrator sentences are evaluative (manual, I).
- About 12 named entities per 1,000 (I). Examples: IGN, DreamWorks Interactive, "10 releases in 2000".
- Low personal stakes.

**Community (M)**

- Per 1,000 views: 1.84 comments and 15.85 likes.
- Like-weighted themes:

| Theme                            | Like share |
| -------------------------------- | ---------- |
| Praise for the creator           | 44%        |
| Nostalgia                        | 26%        |
| Fan-game developers thanking him | 22%        |
| Jokes                            | 20%        |
| Arguing with placements          | 0.5%       |

- No pinned comment; 3 creator replies.

---

## Comparison table

|                         | Views / breakout    | Length  | Title words | Thumb words | Stance or first verdict at   | First entry or claim | wpm   | Words, first 30 s | Median sentence (≤8 words) | I / you per 1k | Evaluative share     | Comments, likes per 1k views |
| ----------------------- | ------------------- | ------- | ----------- | ----------- | ---------------------------- | -------------------- | ----- | ----------------- | -------------------------- | -------------- | -------------------- | ---------------------------- |
| A DIBZ MK               | 1.91M / 38x         | 28:53   | 8           | 2           | 0:23 hot takes; 1:12 verdict | 0:33                 | 201   | 113               | 11 (35%)                   | 38.8 / 15.1    | ~48% man             | 1.38, 11.5                   |
| B KH                    | 327K / 15x          | 1:05:30 | 8           | 2           | 0:50 opinion; 1:04 criterion | 2:40                 | 193   | 118               | 15 (22%)                   | 19.0 / 10.2    | ~40% man             | 3.04, 22.0                   |
| C AC                    | 467K / 22x          | 42:01   | 10          | 3 + tiers   | 0:03 "yell at me"            | 0:52                 | 199   | 115               | 12 (27%)                   | 30.6 / 10.3    | ≥28% heur            | 2.63, 9.6                    |
| D Nintendo              | 1.16M / 3.6x        | 1:40:37 | 5           | 5           | 0:34                         | 1:36                 | 196   | 103               | invalid                    | 40.0 / 28.2    | ~18 clauses/1k       | 1.65, 17.5                   |
| E Fans rank (under)     | 10K / ~0.8x median  | 31:08   | 10          | 0           | none (random draw)           | 0:25                 | 208   | 85                | dialogue                   | 67.1 / 23.0    | 18% heur (strangers) | 9.93, 34.7                   |
| F Luke GTA              | 784K / 3.3x         | 37:24   | 8           | 3           | 2:15                         | 4:21                 | 214   | 97                | 12 (33%)                   | 20.7 / 23.7    | ≥27% heur            | 3.60, 19.1                   |
| G Luke Star Citizen     | 1.31M / 4x          | 23:31   | 9           | 2           | 0:00                         | 6:27                 | 206   | 94                | 12.5 (35%)                 | 17.3 / 24.5    | ≥17% heur            | 7.74, 26.1                   |
| H Luke theories (under) | 122K / 0.45x median | 23:29   | 6           | 2           | none on the game             | 1:04                 | 191   | 101               | 10 (43%)                   | 21.6 / 18.7    | ~10% man             | 3.31, 36.8                   |
| I Act Man               | 2.12M / 2.8x        | 29:58   | 8           | 4           | 0:31                         | 3:28                 | 175\* | 79                | invalid                    | 35.4 / 32.5    | ≥16% heur            | 5.49, 37.0                   |
| J Moon essay            | 132K / 0.89x        | 2:15:08 | 18          | 0           | 2:57 thesis                  | 4:15                 | 162   | 101               | 14 (24%)                   | 5.9 / 10.0     | ~25% man             | 9.10, 60.7                   |
| K Army Men history      | 280K / 4x           | 3:10:58 | 8           | 4           | 1:10 thesis                  | 2:30                 | 155   | 59                | 25 (9%)                    | 1.8 / 1.8      | ~28% man             | 1.84, 15.9                   |

**Notes on the table**

- \* I's wpm includes game dialogue clips.
- "man" means a manual count; "heur" means the keyword heuristic, which undercounts.
- Every wpm, words-in-first-30-s, sentence and pronoun figure is M.

---

## (i) What separates the ranking hits from a neutral, encyclopaedic "every X ranked" read by an AI voice

1. **A person with a verdict on every entry.**
   - The hits run at I 19-40 per 1,000 words (A 38.8, C 30.6, D 40.0, B 19.0) (M).
   - Roughly 40-48% of sentences carry a judgement (A, B manual, I).
   - A closes all 23 entries with a spoken verdict line plus a lock-in sting (S).
   - The encyclopaedic voice in this set is K: I 1.8 per 1,000 and sentences of median 25 words. K works as a documentary, not as a ranking.

2. **Disagreement is invited in the first 30 seconds and harvested in the comments.**
   - When it is invited: C at 0:03 ("yell at me in the comments"); A at 0:23 ("hot takes... you're not going to agree"); B at 0:50.
   - A's pinned comment asks for viewers' S-tier and F-tier picks (311 likes, 69 replies) (M).
   - 27% of A's like-weighted comments argue placements. Its top comment is a placement argument with 3,467 likes and 301 replies (M).
   - K, with no placements, gets 0.5% (M).

3. **The thumbnail shows a verdict, not a catalogue.**
   - A shows 2 words, BEST over MK11 and WORST over MK1 (2023): a hot take you can read in one second.
   - C shows covers already sitting in S and C tiers.
   - The underperformer E shows a numbered board with no verdict.
   - B's thumbnail is a plain catalogue; it was carried instead by a decade-old superfan audience (I).

4. **Personal history is the through-line that justifies the order.**
   - A: his childhood Trilogy disc at 5:05, and re-rankings of his own past views.
   - C: AC2 was his first game, and Brotherhood made him move abroad (about 32:00).
   - B: a decade of fandom.
   - D: allowance money spent on the DS browser.
   - None of this is available to a neutral AI narrator. The closest substitute is a declared, consistent persona with stated tastes (I).

5. **The first entry starts fast; formal criteria are optional.**
   - First entries: A at 0:33, C at 0:52, D at 1:36. B only reaches #13 at 2:40 because of an 87-second sponsor read (M).
   - Formal criteria: A never states any. C states them inside entries (3:33, 6:53). D gives a loose rule at 44:23.
   - Verdicts matter more than methodology (I).

6. **Conversational speed.**
   - The hits run at 192-201 wpm with 103-118 words in the first 30 s.
   - Median sentence 11-15 words, with 22-35% of sentences at 8 words or fewer (M).
   - The documentaries are 155-162 wpm.

7. **Time follows interest, not equal slots.**
   - A gives the newest games the most time (MK11 154 s, MK1 189 s). Filler gets 10-46 s (MK Gold 10 s, MK Advance 44 s). Median 63 s (S).
   - B grows towards the top: 3.3 minutes per entry at #13-#10, 7.5 at #5-#2 (M).
   - C is flat (147-244 s, median 177 s) and still broke out 22x. Even pacing is fine if every entry ends on a verdict.
   - D shrinks from 5.7 to 2.5 minutes. In short, do not pad weak entries (I).

8. **Escalation and signposted controversy act as the re-hooks.** Rankings in this set barely use classic open loops. Instead they use:
   - A inventing new tiers ("god tier" at 4:14, "By the Elder Gods" at 9:04)
   - C's "this is where the comments roast me" at 16:50, plus a subscribe gag at 16:28 tied to the next entry
   - B flagging "most controversial" at 51:34
   - Sound does the rest: A changes the music bed for every entry, matched to the era (about 8 cue changes per 10 minutes, S).

9. **A topical peg.**
   - A launched alongside the Legacy Kollection announcement.
   - D was released on Switch 2 Direct day, and 47.8% of its like-weighted comments are about that timing (M).

---

## (ii) Why long news-commentary holds

1. **The stance comes early and matches the packaging.**
   - G gives its verdict in the first sentence (0:00), with "Pure Greed..." on the thumbnail.
   - I gives its verdict at 0:31.
   - F gives a TLDDW verdict at 2:15.
   - When title and stance disagree, viewers notice. F's title promises scepticism but delivers reassurance, and comments say so ("glaze session" 59 likes; "skeptical about this video being skeptical" 156 likes). That is only a small share of likes for F, which still won on timing and trust (M).

2. **Structure by claims or steps, with verbal signposts.**
   - F tests 5 sceptic claims (4:21, 7:42, 14:55, 23:22, 29:03; 3 to 8.5 minutes each). Each opens with "The first claim I want to look at...".
   - I uses 6 numbered "steps" (2 to 6 minutes each) with title cards.
   - G uses three acts (what, why it is wrong, why now: 0:00, 6:31, 15:10). Its motive act comes last as the payoff (S, M).

3. **Steel-manning and stated limits.**
   - G spends 0:24-1:51 on his own playtime and praise for the tech before the attack.
   - I concedes "if you're having fun, don't let me stop you" twice (2:28, 28:40).
   - F's whole frame is "evaluate them fairly".
   - Rumours are flagged as uncertain on air:
     - G: "some say 3 months, others 6... no confirmation" (10:17)
     - F: "these are just estimates" (0:33)

4. **Direct address.**
   - you per 1,000 words: 23.7 (F), 24.5 (G), 32.5 (I), against 10.0 (J) and 1.8 (K) (M).
   - G tells the viewer they are "just a gamer like me" (3:48).
   - F ends on a practical question to the audience (36:58).

5. **Evidence on screen, named, read aloud.**
   - F: 19.1 numbers per 1,000. It shows a sales dashboard, a podcast still, a Polygon article, Wikipedia and a live Street View comparison (S, M).
   - G: credits another creator on air and plays his clip (16:47), and shows company financials (17:52).
   - Open loops are paid inside minutes:
     - G: "just you wait" (5:40), paid at 6:27 after a 37-second ad
     - F: the promise at 3:11, paid at 23:16 and 29:03

6. **Two production paths, both built on a clear stance.**
   - F is about 58% face-cam with 1.3 music cues per 10 minutes, no SFX and 4-7 cuts per minute (S).
   - I is a comic edit: 21.8 cuts per minute in the intro, a meme every 45-90 s, dead-air drops before punchlines (S). 30% of its like-weighted comments quote the jokes (M).
   - For Pulse (I): the stance and claim structure transfer to a faceless AI narrator. Trust in a face does not, so the evidence on screen and the jokes have to work harder.

---

## (iii) What the underperformers did differently

**E (DIBZ "Fans Rank", 10K against A's 1.9M on the same subject and at the same length, two months later)**

- It removed the host's verdict. The order was set by a random blind draw, so there was nothing to argue with: one list ends with Mythologies at #1 "because of how it drew".
- Its thumbnail carries no verdict and no words, just a busy convention board.
- Its opening is a soundbite collage of strangers.
- It followed a fresh definitive list, so the audience already had DIBZ's answer.
- Per-view engagement is high (9.93 comments per 1,000) but reach is tiny. It only reached core subscribers (I).
- Caveat: E is close to the DIBZ median (12.5K). A was the outlier, so "the definitive personal ranking" is the thing that broke out (I).

**H (Luke "unhinged GTA 6 theories", 0.45x his median; his other GTA videos got 276K-859K)**

- It has no stance on the game.
- About 10% of the sample is evaluative, and all of it is about the theorists (manual, I).
- Its first line, "kind of a big deal", makes no claim. The promise "blow your mind" is paid with a deliberate anticlimax (a hoodie sale, 10:08).
- It has the highest source-word density of the set (7.2 per 1,000): a read-out of others' posts rather than his own case (M, I).
- It is dated: recorded on 10 May about a 14 May prediction.
- F and G instead help the viewer decide something ("should I be hyped?", "is this acceptable?"). H gives the viewer nothing to decide.

---

## (iv) What K shows about when a franchise history can work

- **The audience is loyal, underserved and nostalgic.** Comments are like-weighted 44% to praise for the creator, 26% to nostalgia and 22% to fan-game developers. Viewers celebrate the runtime itself ("if it's more than 2 hours I'm watching every minute") (M).
- **It promises exclusive material.** The description offers never-before-seen concept art and design documents.
- **It has a thesis, not just a timeline.** "A cautionary tale" about what went wrong, stated at 1:10, carried by a chronological rise and collapse with "would soon" foreshadowing as re-hooks (M).
- **Chapters make a 3-hour video navigable.** There are 27, one per game.
- **The creator brand does the rest.** It is one entry in a long series of franchise histories, with a topical peg (the new Toy Story film).
- **The delivery is the opposite of the ranking hits:** 155 wpm, median 25-word sentences, I 1.8 per 1,000. That works only because the audience self-selected (I).
- **Even so, it reached 280K, with modest per-view engagement** (1.84 comments and 15.85 likes per 1,000) (M).
- **Read-across to Pulse (I):** a franchise history works for a small, neglected series with exclusive material and an established history creator. A faceless AI history of a crowded franchise such as GTA has none of those advantages.

---

## Not measured

- **Audience retention curves:** no access for other channels.
- **Sound and visual data for B, C, D, E, G, H, J and K:** these were not watched.
- **Sentence metrics for D and I:** invalid (auto-captions without punctuation).
- **Evaluative shares for C, F, G and I:** keyword-heuristic floors, not manual counts.
- **Comments for B, C, E, G, H and J:** not fetched (credit cap).
- **Description chapter lists for E and H:** not fetched (they came from channel_videos only).
