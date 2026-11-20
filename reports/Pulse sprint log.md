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
