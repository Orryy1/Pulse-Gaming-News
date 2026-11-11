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

## 7. Measure the translated titles (owner asked 11 Nov whether the Spanish side is worth it)

**Why:** the separate Spanish channel was never switched on (no second channel connected), so the only non-English work is the translated titles and descriptions on the main channel (LOCALIZE_LANGUAGES=es,pt,de,fr,ja). Nobody has measured whether they bring viewers.

**Build:** add a views-by-country and views-by-viewer-language breakdown (YouTube Analytics dimensions country and, where available, the localized-title traffic) to the weekly analytics loop, through the factory's stored login, compared with the weeks before translations started (26 Oct).

**Decide:** keep the translations if Spanish, Portuguese, German, French or Japanese speaking countries grow their share of views; drop the languages that bring nothing. The Spanish twin channel stays off unless a language shows real pull.
