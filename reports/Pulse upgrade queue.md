# Pulse upgrade queue

Ranked list the weekly improvement task (Thursdays 11:00) works from. Top item first. Each entry says why, what to build and how we'll know it worked.

## 1. "Every [series] game EVER" format (long form plus a 60-second Short)

**Why:** the owner rates @zenkaigoose's editing highly, and his numbers back it up. His biggest videos are all franchise marathons in release order: Every Rockstar Game 8.2M views, Every Spider-Man Game 3M, Every Need for Speed Game 1.7M, Every Game of the Year 1.6M. The 60-second companions also land: Every GTA Game 1.5M, Every Doom Game 1.7M, Every Abandoned Rockstar Game 1.7M. The format works without his face; the face is his garnish, not the engine.

**What we saw (studied 7 Nov, Every GTA Game EVER Short):**

- One game per beat in strict release order, a year stamp at each era change ("1997", "2004", "2008", "2025").
- Every beat shows that game's own era-true footage (top-down GTA 1, PS2-era San Andreas), never modern store art.
- Handheld games are shown on the real handheld (PSP, DS), so the hardware itself tells the era.
- About 33 cuts in 60 seconds, a cut every 1.8 s; one or two words of caption at a time, centre screen.
- Ends on the newest game (GTA VI) as the payoff, so the chronology doubles as a countdown.
- Long version: about 50 minutes, one chapter per game, named chapters that are each searchable ("The controversial Manhunt", "Table Tennis and Rage").

**Build:**

- A new evergreen format in the rankings/docs lane: input a series, list every entry from IGDB with year and platform, one chapter per game for the long version and one beat per game for the Short.
- Era-true footage per entry: IGDB screenshots and videos, Steam where the game is on Steam, archive.org trailers for old titles, the owner's own captures where he has them. Gate: an entry with no era-true picture is shown as its box art on its console from the Pulse universe kit, never a later game's footage.
- Platform hardware frames from the Pulse universe kit (era-true consoles and handhelds) for each entry's platform.
- First run: "Every GTA Game EVER" Short during the GTA VI launch run, then the long version as a GTA documentary follow-up. Then Need for Speed, Mario Kart, Call of Duty, Resident Evil.
- Honest framing: Pulse does not claim to have played them all; titles like "Every GTA Game, Explained" or "The Story of Every GTA Game".

**Measure:** views and subs per video against our rankings and docs average; Short retention against the 83% the "why" stories get.

## 2. True curiosity gaps on giant-franchise small news

**Why:** the Elden Ring Short reached 18,000 TikTok viewers because people hoped it meant Elden Ring 2. The pull was a giant name plus an open question; the framing was wrong. Keep the pull, never the false claim.

**Build:** when a top-tier franchise has small news (an event, a patch, a quest), the writer leads with the real open question the news raises ("Here's what the community quest unlocks", "Is FromSoftware teasing something? Here's what we actually know") and the fact check confirms the question is genuine.

**Measure:** views on small-news Shorts from top franchises against other news Shorts; no "misinformation" comments.

## 3. The channel's first comments are hidden from viewers

**Why:** the factory's first comment under each Short is posted fine, but a signed-out visitor sees it on 0 of 33 videos (alert, 7 Nov). Pinned comments did show on 4 Nov. Links are not the cause: first comments carry none. The token in the Mac .env only has the youtube and youtube.upload scopes, so moderation status can't be read with it; the factory's own stored login has to be used for that.

**Build:** read moderationStatus for a sample through the factory's stored login; if YouTube is holding them as likely spam, stop posting identical-shaped comments (vary the wording, post later after the first viewer comments) or pin through Studio once the Brave cookie fault is fixed.

**Measure:** visible share in the weekly first-comment check.

## 4. Cutscenes from clean YouTube uploads, so the owner only captures gameplay

**Why:** owner, 8 Nov: cutscenes are identical for every player, so hand-capturing them on the Switch 2 is wasted effort. He keeps capturing gameplay moments (30-second clips, Xbox streams to Twitch).

**Build:** for a named game, search YouTube for "no commentary" cutscene or "full movie" uploads, download with yt-dlp, and accept only clean frames: no face cam, no channel logo or watermark, no subtitles burned in by the uploader, no commentary audio (game audio is muted under narration anyway). Short excerpts only, matched to the line like any footage, credited as the game's footage. Keep BROLL_YOUTUBE_FALLBACK's spirit: Content ID claims from the publisher land the same whether the footage was captured or downloaded, so a claim is a signal to cut that clip, not a reason to stop.

**Measure:** share of Ocarina (and later GTA VI) Shorts and docs with real cutscene footage instead of trailers; claims per 100 videos.

## 5. Scene-precise cutscenes and character quotes (built 8 Nov, held for review)

**Status:** Codex built it on branch codex/scenes (pushed, not merged into claude/stage, not deployed). All 1,414 tests pass. It finds a line's moment through the movie's chapters and captions, then scene uploads ("All Ganondorf Scenes"), and a vision check must confirm the moment before it's used; otherwise the spread pick stays. Character quotes: lines are extracted from captions and the writers can use them, but playback with game audio is not built (plan in factory/docs/cutscene-quotes-plan.md). Note: Zelda's characters mostly don't speak, so quotes suit voiced games (GTA, God of War, Final Fantasy).

**Before merging:** the 8 Nov Ocarina trial found the right scene upload, but the vision check accepted no frames, so it fell back. Check why (the check's frames, or the PC run's model access), then do a full Short render with it on and look at the frames on the word. Codex also changed src/render/plan.ts and longplan.ts: render-check a Short and a long video.

**Measure:** share of named-moment lines whose clip shows that moment, from a contact sheet per video.

## 6. A scene index for every game: every shot and every line, searchable (owner, 11 Nov)

**Why:** owner, 11 Nov: investigate every scene of a downloaded playthrough so the factory knows exactly what each moment is and what every line of dialogue says, and can match moments to exact scenes in every Short, long video and documentary. This replaces searching per line with looking up a ready index.

**Build:**
- Per game, once: download the best clean cutscene movie or no-commentary playthrough (the cutscene source's picker), split it into shots by scene cuts, and keep a low-resolution proxy plus the index (full-resolution sections are fetched on demand, so disk stays small).
- Every shot: keyframes described by the free local vision model on the PC (who is on screen, where, what happens, mood), characters and places named against the game's wiki cast list.
- Every line: spoken dialogue transcribed with timestamps (Whisper on the Mac); text-box dialogue (Zelda and other unvoiced games) read with Apple's free on-device text recognition on the Mac; the speaker named where the box or the scene shows it.
- Search: each script line is matched against the index (names, places, actions, quoted words) and gets the exact shot, and a quote gets its exact start and end. Feeds the existing footage matcher and the character-quote feature.
- Index stored per game and reused by every video about it; refreshed when a new upload is better.

**Order:** Fable designs it once the current helpers finish (no more than 3 workers at once), then Opus builds. First game: Ocarina of Time 2026, then GTA VI from launch.

**Measure:** share of named-moment lines whose clip shows that moment (contact sheet per video), quote accuracy against the index text.

## 7. Translated titles and the Spanish channel: switched off (owner, 11 Nov)

The owner switched off the translated titles (LOCALIZE_LANGUAGES=, on the Mac) and keeps the Spanish twin channel off. Nothing to build. Earlier videos keep the translations they already have.
## 8. One named GTA VI Shorts strand, daily at a fixed hour, on the owner's own footage

From "Niche deep research November 2026", changes 1 and 5. Needs the owner: his captures (already in the launch plan). Any build work after 22 Nov.

**Why:** Pulse earns 0.39 subscribers per 1,000 Shorts views (16 from 41,042 in 28 days), which is the going rate for a faceless multi-game channel: seven such channels measured on 11 Nov sit at 0.22 to 0.33. Single-franchise channels that fill the frame with their own gameplay sit at 1.24 (L-LAB) and 1.60 (lukogta, 4,350 subscribers in 34 days from 16 Shorts). On lukogta the top four Shorts are how-tos, a verdict and a list (68K to 2.15M) and the five weakest are plain news recaps (2,705 to 10,348). At 0.3 per 1,000, 1,000 subscribers needs about 3.3 million Shorts views, so more of the same will not reach the Partner Programme.

**Build:** a strand setting (name, daily hour, franchise) inside the plan's verdict slot, so no slots are added. Every strand Short is one test, how-to or "is it true" check in GTA VI, opens on the owner's footage, and is framed as what the player can do or why Rockstar did it, never as an announcement. Sales, forecast and revenue stories rank below player-facing ones. Behind a setting, off by default.

**Measure:** subscribers per 1,000 views for the strand against all other Shorts, judged at 20 Shorts; target 1.0 or more.

## 9. A weekly long video in a fixed frame, 25 to 60 minutes, starting with practical guides from real play

From the report, changes 2, 4 and 14. After 22 Nov.

**Why:** across 43 long-form channels, 25 to 60 minute videos beat 8 to 25 minute ones inside 31 of 36 channels (median ratio 1.77); reach is best at 30 to 60 minutes (1.40 times) and collapses past 2 hours (0.25 times, OverseerOS). Weekly is the usual cadence of steady small channels. Preparation videos ("what to do, buy or know first") hit on 36% of 47 small-channel GTA videos against 12% for trailer breakdowns; one 36-minute guide reached 3.1M views in 11 days on a 12,200-subscriber channel. A buyer question did 306K as an 8-minute video on a 712-subscriber channel whose Shorts on similar questions had a 1.8K median. Pulse's seven long videos drew 1,770 views in 28 days, and the bar becomes 8,000 watch hours on 1 Feb 2027.

**Build:** move the long slot from fortnightly to weekly after Part 2: alternate one 40 to 60 minute film with one 20 to 30 minute piece (or an 8 to 10 minute buyer-question video in the plan's week 2). First films after launch are guides from the owner's play, with the game named and a title that stays true for weeks. Nothing over 2 hours. Lengthen a frame only after it has proved itself.

**Measure:** long-video watch hours a week; views per long video against the 1,770 in 28 days baseline; share of views from YouTube search on guide videos.

## 10. Break the fixed Short skeleton, and add an "argues, does not describe" check

From the report, changes 3 and 6. After 22 Nov.

**Why:** YouTube's stated test for earning is whether content "looks like it's made with a template", and reviewers sample the newest and most-viewed uploads; at four Shorts a day that sample is almost all Shorts, which the World class audit described as one skeleton (hook, three facts, card, question). In January 2026, 16 channels with 35 million subscribers were removed for mass-produced content. Since 1 Oct 2026, a voice-over that only describes what is on screen, and template-based changes, do not count as original and the channel gets less Shorts reach. A rejection could push Pulse past 1 Feb 2027, when the bar doubles.

**Build:** several distinct Short structures the writer rotates between (different openings, order, length and endings), with a rule that no two of the newest 30 uploads share one. A pre-publish check that each Short carries a point not in the picture (a reason, a verdict, a comparison) and some of Pulse's own material (owner capture, graphic, chart, on-screen source). A counter for how often the same trailer shot is reused across Shorts in a week. Behind settings.

**Measure:** monthly "swap test" on the newest 30 uploads (pairs whose scripts could be exchanged, target zero); share of Shorts passing the check; the most-reused trailer shot's weekly count.

## 11. Shorts length lanes: about 35 seconds for news and "why", no 45 to 59 second Shorts, a shorter Instagram cut

From the report, changes 7 and 19. After 22 Nov.

**Why:** of 100 top-five Shorts on 20 channels, 60 are under 30 seconds, 24 are 30 to 45 and none is 52 to 60. In a 16,537-Short study, 46 to 60 seconds was second lowest once balanced by channel. Pulse's own data: 45 to 59 second Shorts broke out 3 of 24 times on YouTube against 15 of 71 for the rest, and 0 of 22 on Instagram, where average watch time correlates with views at 0.62. The 13 top Shorts over a minute come from voiced single-franchise channels (61 to 85 seconds), which is a different form.

**Build:** a target-length setting per format: 22 to 35 seconds for news and "why" Shorts; a separate, small test lane of 60 to 75 seconds for strand pieces on own footage. Where a Short runs over 35 seconds, Instagram gets a 20 to 35 second cut or is skipped.

**Measure:** breakout rate by length band on each platform with 20 or more Shorts per band; the "fit Shorts" test already running, judged 25 Nov.

## 12. Enforce the daily caps and pick per platform; Facebook to one a day until its status is read

From the report, changes 8, 18 and 21. Needs the owner: one step each for Facebook (Page status, PC browser) and TikTok (Account Check, phone). Lowering volume can ship before 17 Nov; anything else after 22 Nov.

**Why:** in the last week TikTok, Instagram and Facebook all ran at up to 7 posts a day against caps of 4, 6 and 1. The same Shorts rank almost independently across platforms (rank correlation with YouTube 0.25 on Instagram, 0.13 on TikTok), so posting everything everywhere spends each small test audience on videos its viewers skip. TikTok had two dead runs (3 and 6 posts at 1 to 44 views against a usual 725), the first after 3 posts in 101 minutes; Buffer's 11.4 million-post study shows the typical post does not gain from higher cadence (median 506 falling to 459). Facebook drew 12 views from 112 Reels, which looks like a Page-level state; Meta cuts distribution on everything an account shares once it is classed as unoriginal and shows the reason in "Support home".

**Build:** make the caps hard limits. A per-platform pick: TikTok at most 4 a day, 3 to 4 hours apart; Instagram the best 2 or 3 a day, favouring strong-fandom and "why" stories; Facebook one a day (the day's best) or paused. A clean master with no other platform's mark. Record the owner's Facebook status and TikTok Account Check results in the weekly report.

**Measure:** middle-post views per platform over 4 weeks; TikTok dead runs per fortnight; days over cap (target zero); Facebook Page media views in 28 days.

## 13. A "why it died" documentary strand on recent failures

From the report, change 9. After 22 Nov, from week 3 of the GTA plan. Check against the film slate first.

**Why:** nelvox has made 57 films in one "how or why it died" frame for a 174K median on 55K subscribers; Selwen's studio-downfall films have a 370K median on 64.4K; a search limited to this year shows fresh failures (1.33M and 486K) above older histories. Games that failed in the last 18 months lead these channels' top lists, and Pulse's news desk already knows which launches are failing. Caution: nelvox's newest films sit at 39K to 217K, so the frame may be tiring.

**Build:** a documentary format with one subject, a fall and a concrete loss in the title (a share of players, a number of days, a sum of money), topics proposed by the news desk from recent failed launches, starting at 25 to 35 minutes.

**Measure:** views and watch hours per film against Pulse's long-video average, judged over 3 films.

## 14. One title frame and one thumbnail layout per long strand, plus title rules for Shorts

From the report, changes 10, 15 and 28. Needs the owner: one step, approve the layouts on before-and-after frames. After 22 Nov.

**Why:** the small channels with the highest views per subscriber each use one sentence shape and one thumbnail layout (Game Gauntlet 17.5 times subscribers, JarGames 6.0, Selwen 5.8, nelvox 3.2) while anonymous list brands sit at 0.03 to 0.04. On 277 small-channel GTA videos, outliers start with a number more often (21% against 12%), rarely use a question mark (5%), and every video over 200K names the game (median 43.5 characters). On Shorts, "why/how plus a named subject" lifted medians from 5,850 to 26,500 and from 2,200 to 14,500 on two channels. A third of Pulse's views come from search by game name. Pulse's own data: Shorts with a number in the title broke out 15% of the time against 30% without.

**Build:** per long strand (documentary, "every game", guide), one fixed title shape and one layout rule with the game's art changing inside it, 0 to 4 words on the thumbnail. Shorts titles: game name first, then the why or how; numbers only where the number is the point. Long titles: short statements that name the game. Chapters every one to two minutes with plain story labels.

**Measure:** click-through on long videos by strand; YouTube A/B tests one at a time; search click-through by title form.

## 15. Open Shorts on the game's own moving footage, with an ad-safe first seven seconds

From the report, change 11. Needs the owner: one step, approve the changed opening on before-and-after frames. After 22 Nov.

**Why:** in 48 first frames on 12 channels, those opening on their own gameplay (subject centred and moving, one or two caption words) convert at 0.72 to 1.60 subscribers per 1,000 views; those opening on a generic background with an inset or on a headline card convert at 0.22 to 0.33. The link is a judgement on few frames. Separately, YouTube gives limited or no ads to graphic game violence in the first seven seconds or the cover, a rule it restated ahead of GTA VI.

**Build:** an opening rule: frame one is the named game's footage, no title card or headline box, captions of one or two words. A gate that rejects a graphic kill in the first seven seconds or as the cover frame.

**Measure:** viewed-against-swiped share and 3-hour views for game-footage openers against card openers, 20 Shorts each.

## 16. Same-day angle rule for official drops; no trailer or screenshot breakdowns as long videos

From the report, change 12. An editorial rule; no build needed for launch week.

**Why:** on the 10 Nov trailer a 765-subscriber channel that published inside 3 hours got 290 views (0.1 times its median) and a 3,800-subscriber channel that published 12 hours later with a reframing idea got 28K (5.6 times); a large channel that kept its normal slot six hours late did 2.8 times its median. One event, early read. Trailer and screenshot breakdowns flop on 54% of 41 small-channel videos, and pre-launch story or character videos on 60% of 20.

**Build:** when an official drop lands, the factory keeps its usual slot and produces one reframing idea within about 12 hours instead of a detail list. Long-form breakdowns of trailers and screenshots are switched off as a story type.

**Measure:** views against Pulse's median for drop-day videos with and without a stated angle.

## 17. Amendment to item 1: change the follow-up franchises for "every game" videos

From the report, change 13. Planning only. Item 1 above is left as written; this entry changes its follow-up list.

**Why:** the "every game" format paid for small channels on nostalgic mid-size series nobody else had surveyed: 333K to 541K on toy and anime tie-in series against 15K for a PlayStation superhero series (Game Gauntlet, 6.5K subscribers); 366K for a cartoon-licence series against 55K for GTA made in launch month and 10K for Spyro (whyat); 857K to 1.5M for flight series and an awards-winners set (SpongeDidTheMath). Zenkai Goose's every-Fallout video got about 4% of his every-Rockstar video. Plot-recap frames did well (JarGames' GTA story recap 649K) while release-by-release rankings from small channels got 13K to 15K.

**Build:** after the GTA run, pick licensed and toy-era series, racing and flight series, and awards-style cross-franchise sets ahead of Need for Speed, Mario Kart, Call of Duty and Resident Evil. Use the "story of every game" framing. Expect a modest long version for GTA itself, since the angle is crowded this month.

**Measure:** views per "every game" video against Pulse's rankings and documentary average, by franchise type.

## 18. Shorts-to-long funnel as a narrow test; stop linking unrelated Shorts

From the report, change 17. After 22 Nov. This replaces the GTA plan's line that every Short should point to a long video.

**Why:** 26 Pulse Shorts carry a related-video link and YouTube credits the Shorts feed with no long-video views in 30 days. That is expected: one vendor puts the usual rate at about 0.04% (about 16 viewers on 41,042 views); across 5,000 channels only 2% got a noticeable share of long traffic from the link, with about 10% more first-month views where it worked, and best where the Short was cut from the long video and posted within three days (Spotter). YouTube's own guide says to say and show the link in the last 5 seconds and to open the long video on the Short's subject within 5 to 10 seconds.

**Build:** for each long video, two or three Shorts cut from it, published within three days, the only Shorts that link to it, with the link said and shown in the final 5 seconds. Long videos open on the subject with no logo sting. Remove the link from unrelated news Shorts.

**Measure:** long-video views credited to the Shorts feed in YouTube Analytics, per linked Short.

## 19. First comments: unique and fewer; hearts, replies and a pinned viewer comment instead

From the report, change 20. Builds on item 3 and does not replace it. After 22 Nov for any change to the comment job. Possibly needs the owner: one step, approving held comments in Studio's "Held for review" tab.

**Why:** YouTube's help page says "repeatedly posting comments can be detected as spam" and holds such comments for up to 60 days; Pulse logged 64 automated first comments in 14 days, most with the same wording. None of 12 small and mid gaming channels sampled pins its own first comment; one pins a viewer's comment and hearts 17 of the top 40. Pulse left 16 of 25 YouTube comments and 11 of 11 Instagram comments unanswered. Replies are associated with 21% more engagement on Instagram (Buffer; not measured for YouTube).

**Build:** after item 3's status check, post a first comment only where the video has a real closing question, worded for that video, with no link or hashtag. Heart every real viewer comment, answer each once in plain words, and pin the best viewer comment. Vary reply openings.

**Measure:** visible share in the weekly first-comment check; share of viewer comments answered within a day (target all).

## 20. Reviewer-readiness pack: About page, disclosure line, sources page, records and the Rockstar decision

From the report, changes 23, 24 and 25. Needs the owner: one step to approve the About text, and one decision on Rockstar's wording before any application. Description changes after 22 Nov.

**Why:** Partner Programme reviewers read the About section, titles, thumbnails and descriptions as well as the newest and most-viewed videos. YouTube says a disclosure label "alone won't limit a video's audience or impact its eligibility to earn money", while repeated failure to label realistic synthetic content can bring suspension. The fake-trailer channels were terminated for "spam and misleading metadata". Rockstar's policy is described as for non-commercial fan use (second-hand; its page would not open). A rejection costs a 21-day appeal window and a wait of 30 or 90 days (blogs disagree), which could land Pulse past 1 Feb 2027.

**Build:** an About text saying what Pulse is, that a person reviews every video and that narration is AI-voiced. The standard AI line on every description and one sources link per video on the Pulse website. The altered-content label ticked whenever a realistic synthetic picture or sound appears, and a gate against any AI image that could pass as official game material. Three private records: a per-video production log, a footage ledger and a claims log. The owner reads Rockstar's policy and records his decision.

**Measure:** share of uploads with the line, a sources link and a complete log (target all); the decision recorded with its date.

## 21. Post-launch GTA VI rankings with a stance, and one "complete" GTA compilation

From the report, changes 16, 22 and 26. Rankings from week 2 or 3 of the plan; the compilation after 22 Nov, for late December or January.

**Why:** three launch-window "every [thing] ranked" videos did 274K to 611K on a channel with an 18K median, while anonymous top-10 brands draw 3% to 4% of their subscribers per video. Numbered parts shed about half (sequels at 51% and 54% of the first part; a "Part 1" follow-up at 109K against 3.1M), while one channel's "complete" compilations did 228K to 4.0M against 3K to 15K for its separate episodes (5 to 7 years old, so a test).

**Build:** ranking pieces made from the owner's play once players have finished the game, each with an argument in the title and no "top N" or year wording. No long video numbered as a part after Part 2; multi-part ideas ship as complete films. Once four to six GTA films exist, one 60 to 100 minute "complete" cut.

**Measure:** views and subscribers per ranking against the rankings average; the compilation's watch hours in its first 30 days against the sum of its parts in the same period.
