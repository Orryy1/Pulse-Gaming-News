# Pulse sprint log

Daily record of the 30-day growth sprint (21 Nov to 20 Dec 2026), written by the pulse-growth-sprint task. Plan: Pulse growth war plan.md.

## 20 Nov (set-up)

- Long-video fixes deployed (a041faa10): a documentary drops a refused chapter instead of dying, poll winner goes on the ranking shortlist, daily OUTPUT_AUDIT.
- FACT_REPAIR live on long rankings (328cfaaec).
- Five long videos a week: LONGFORM_DAYS=mon,thu,sat and DOC_DAYS=wed weekly; calendar topics to 27 Jan.
- Five LIVE stubs set private with the owner's yes.
- YouTube's new bar from 1 Feb 2027 (8,000 hours or 20M Shorts views) confirmed on the YouTube Blog post of 10 Aug 2026.

## 20 Nov 06:00 (owner: take everything into new long videos and documentaries)

- Live on the Mac for long videos and documentaries (.env.bak-20261120b): PARALLAX_DEEP, DEPTH_ORBIT, SUBJECT_POP, BOX_3D, CHAPTER_WALL, DEPTH_TYPE, COMPARE_WIPE, BLENDER_SCENES (share 1, cap 180 min, wait 150), MENTION_GAMES/LOGOS/CHARACTERS, GAME_SPEECH_DIALOGUE, TRAILER_QUOTES.
- Blender renders on the Mac itself via the new com.pulse.blender service (mac/blender.sh, port 8797); about 6-12 minutes a clip.
- Still off: ACE_BEDS (music not generated yet, queued on the PC), GAME_SFX_STEMS (Content ID risk until a private test upload passes), UPSCALE (no weights on the Mac), ILLUSTRATE (FLUX licence).
- First real ones: Sat 21 Nov 17:00 long ranking and the launch documentary.
- 07:50 Concept sketches: FLUX.2 klein 4B (Apache 2.0) on the Mac, com.pulse.sketch service (port 8798, about 87 s a sketch, about 10 GB peak); ILLUSTRATE_ENABLED=true (.env.bak-20261120c). Waits for one owner step: Full Disk Access for Homebrew Python on the Mac mini, because the weights are on /Volumes/Storage. Until then every video skips sketches safely.

## 20 Nov (pulse-growth-sprint scheduled run)

- Sprint starts Sat 21 Nov; the plan has no Part 3 section for 20 Nov and no earlier Me items exist, so nothing was built or deployed in this run. No new faults.

- 20 Nov ~10:30 Started three more helpers (owner: do all): claude/semantic (meaning-based picture matching MATCH_SEMANTIC plus VOD_TAGS on the owner's streams), claude/sources (press kits, achievement art incl. TrueAchievements/TrueTrophies terms check, wiki leads), claude/maplook (MAP_PINS and GAME_LOOK). Also running: claude/footage-fix, claude/wikiart, claude/gpu-visuals.
- 12:25 Deployed 65928a508: footage fix, semantic matching, press kits/achievement cards/wiki leads, 3D map pins and game look (new deps @remotion/three etc. installed on PC and Mac; bundle builds on both). 12:30 switched on MAP_PINS, GAME_LOOK, MATCH_SEMANTIC (.env.bak-20261120e). Found and stashed leftover staged changes in C:\PulseFactory that would have reverted 13 files (patch D:/pulse-data/scratch/pulsefactory-staged-20261120.patch, stash@{0}).
- 12:40 Owner: post ALL Shorts to TikTok via Buffer. TIKTOK_DAILY 4->0 (every Short), TIKTOK_GAP_MINUTES 180->45 (.env.bak-20261120f); TIKTOK_FROM_HOUR 16 unchanged; INSTAGRAM_DAILY=3 left as is. SHORT_PARALLAX_SHARE 0.5->1 (ends the 29 Nov 50/50 test by owner's wish). Helper claude/shorts-upgrades bringing map pins, game look, Blender, depth moves, sketches to Shorts; explainers helper told to cover Shorts.
- 12:50 Wiki art library merged (5ab68d5a6), PC game library server restarted with /wikiart routes (now started by hand from C:\PulseFactory\factory; no auto-restart task exists for it), Mac WIKIART_LOOKUP_URL=http://10.77.0.1:8793/wikiart/lookup (.env.bak-20261120g), crawl tasks 04:10/15:10 re-pointed to the main checkout. Fandom image host blocks automated clients with a Cloudflare challenge, so GTA Wiki brand art (Scooter Bros etc.) is unavailable within the rules.
- 13:10 Explainers merged (2bbdb51bb) and on: EXPLAINERS=all (.env.bak-20261120h). Steps board in Shorts a little small, note for tuning.
- 13:50 Shorts upgrades merged and live (5620a4c37): SHORT_MAP_PINS, SHORT_GAME_LOOK, SHORT_BOX_3D, SHORT_DEPTH_TYPE, SHORT_DEPTH_ORBIT, SHORT_COMPARE_WIPE on; SHORT_BLENDER=false until the vertical podium scene is fixed (.env.bak-20261120i); com.pulse.blender restarted on the new code. Vice City, Port Gellhorn, Little Cuba map spots checked by eye. Wiki art drop folder live (D:\pulse-data\wikiart-drop, task every 30 min); PC game library server restarted through its new logon task.
- 15:10 Polish merged and deployed (58f35ad7b): vertical podium fixed, bigger tall explainer boards; SHORT_BLENDER=true again (.env.bak-20261120j); relay leftover-broadcast fix deployed (relay service restart pending until the owner's stream ends).
- 23:56 Waiting to deploy (claude/stage, pushed, all 3121 tests green): narration check sound-alike fix, HDMI/LCD/LED as letters, GTA VI treated as released for documentary gameplay. Not deployed at midnight because the Mac was producing 2 videos (likely the rescued Friday explainer); the next routine deploy at a safe, idle moment carries them. Owner's 20 Nov stream downloaded to the PC: D:\pulse-data\vods\TinoTV VODs (15.7 GB, 6 h 28 min).

## Sat 21 Nov (day 1, run at 09:20 UK)

- Merge the minimum-length relay guard from claude/game-speech: DONE (already). Commit 1fe90adee ("no public broadcast until Twitch and streamlink are steady") is in claude/stage and the deployed branch; the guard code is on the Mac and com.pulse.streamrelay has run it since 20 Nov 22:08. Tuned today: STREAM_RELAY_MIN_LIVE_MINUTES 3 -> 5 so 1-4 minute dropouts never go public (.env.bak-20261121a). Relay restarted while idle; log "relay on ... public" at 09:23:39Z, setting reads 5; tests/streamrelay.test.ts 22/22 pass.
- Check the relay after Xbox's block lifts (~11:00 UK): PARTLY DONE. Relay is on, idle and healthy; Twitch detection works now (detect tinotv: live false, no 401). The owner was not live at 09:40, so the first post-block stream is not yet seen. Carried: the hourly watch checks the first stream goes public after the 5-minute warm-up.
- Make sure archives are public: DONE, with a problem found. 5BiBlfAsi7I (7 h 14 min, 20 Nov) is public but blocked worldwide by 16 blocking music claims (radio); the five 18-19 Nov stubs (5 s to 7 min) stay private with the owner's earlier yes. Erase song is available; not applied without the owner's yes because it edits a published video. Logged in the fault ledger.
- OWNER (Xbox): stream GTA VI 2 h+ today, radio volume at 0. Sent in the final reply.
- Not done by this run (not a sprint item): the waiting claude/stage deploy (narration sound-alike fix, GTA VI gameplay in docs) is left to the routine deploy.

## 22-25 Nov

- No sprint-log entries were written for these days (the pulse-growth-sprint task was replaced by this daily review on 25 Nov). Status of their "Me" items is not verified here; the weekly review on Fri 27 Nov should audit them against the plan.

## Thu 26 Nov (day 6, daily review, run at about 09:20-11:15 UK)

- Judge fact repair: DONE (by the improvement engine at 15:00 on 25 Nov, re-read here). Missed its pass mark: 22 attempts in 7 days, 2 repaired, none saved a video yet. Kept on (it cannot publish anything that failed its recheck); verdict extended to 28 Nov, with tonight's 17:00 Half-Life ranking (a repaired script) as the live test.
- Set Test and compare on the four old long videos: PARTLY DONE. Found why no tests had run since about 12 Nov: the PC's thumbnail copier task is missing. Ran it by hand; 3 old long videos (GTA ranking, GTA 13 years doc, Call of Duty ranking) are now marked ready for the pulse-studio-abtest run at 11:32 today. The other 4 have lost their spare thumbnails on the Mac. Carried: check the 11:32 run's report; title-only tests for the 4 once the route drops missing files.
- OWNER (Reporting API, PC Brave): not opened today; carried to the weekly review, since the plan says only if Google asks.
- OWNER inbox 36: double-click install-routine-files-pull.cmd on the PC (the session could not recreate the task).
- Also shipped (fault fix, not a sprint item): LONG_RESLOT 24748f3e5, so the late Cyberpunk documentary goes out at 19:00 tonight instead of in the night.

## Fri 27 Nov (day 7, daily review, run at about 09:35-11:30 UK)

- Weekly report with the GTA against non-GTA split and subscribers per 1,000 for the strand: DONE. reports\Pulse weekly report 27 Nov 2026.md. Shorts published 20-24 Nov: GTA 139 views a Short (58% viewed, 0 subscribers) against 333 for other games (50%, 0.43 per 1,000); the strand had one Short with data (23 views), too few to judge; the one long video earned as many subscribers as all the week's Shorts.
- Carried from 26 Nov, Test and compare on old long videos: NOT CHECKED this run (the 11:32 abtest report from 26 Nov was not re-read). Carried to 28 Nov.
- Carried, 22-25 Nov Me items unaudited: the weekly review is on Mondays, not Fridays, so this audit is carried to the Mon 30 Nov weekly review.
- Fault work this run: two broken live titles retitled (YouTube API confirms); opening-caption fragments on footage-opening Shorts fixed on claude/opencaption (see the fault ledger); long-video lane traced (deploy restarts and a 2 h 40 min preparation ate the render gap; no further change while the 00:15 and 07:00 fixes are judged).
