# Breakout playbook, 26 October 2026

Gaming channels that went from almost nothing to 100,000+ subscribers between April 2025 and October 2026, and what they did. About 3,000 channels were screened from the niche corpora and 30 searches in Pulse's lanes, with Social Blade monthly history for 567 of them before its bot check stopped the run. That left 48 candidates, 17 in the breakout set and 11 organic (no audience brought from elsewhere). Raw data is in the session scratchpad: `research2/breakout/channels.json`.

## The 11 organic breakouts

- Sam Explains Games: Minecraft and indie lore.
- Bind: long essays.
- StrawHatMidas: Nintendo rankings and the "Buying X in 2026!" series.
- The WatchOver: Overwatch explainers, "Every X DELETED".
- Cosmic Lore: horror and indie lore. Its Silksong Short drew 9.5M five days after launch.
- Dexter Menjelaskan: "Every X explained in N minutes", in Indonesian.
- Brainless Ranking: Minecraft horror-mob story Shorts.
- Call Sign Chan: ARC Raiders story Shorts.
- IanRankings: "Ranking the funniest X moments".
- The Daily Emerald: parody Minecraft news.
- jjaiirus: Roblox update news.

Built on existing authority or an audience (useful, not copyable): Jason Schreier, Chris Wilson, Clooless Gaming, MoistCr1TiKaL Gaming, Goblin Clips.

The closest counterexample is Mithrie - Gaming News: automated multi-game daily news at about four uploads a day. After 18 months its long videos get a median of about 177 views, and total views are flat at about 0.5M a month.

## What the organic breakouts shared (out of 11)

1. One repeatable title template: 11/11. The hit was usually an early instance of it.
2. A narrow beachhead: 11/11 kept one fixed angle; 8 stayed on one game or universe.
3. They rode a fresh release or trend: 7/11.
4. They pivoted or pruned before the breakout: 8/11.
5. The breakout came a median of about 180 days after the first public upload (range 1 to 594).
6. The hit itself was a Short for 7 and a long video for 4. Long hits brought more subscribers per video; Short hits needed 10-30 follow-ups to convert.
7. They doubled down on the same subject within days: 10/11. Topic focus mattered more than raw volume.
8. Cadence in days 1-90: 2.3-7.5 a week for Shorts-led channels, 0.2-1.4 for long-led ones. None won on multi-game news volume.
9. Shorts linked to the next video: 8 of the 10 channels that post Shorts.
10. Community tab: all 11 post, and 7 run polls.
11. Long videos ran 14-38 minutes and were built on a premise.
12. Faceless or voice-only: 9/11.

## The playbook for Pulse, and what was done

1. **GTA 6 as the beachhead for 90 days.** Done: FOCUS_UNTIL now runs to 31 Jan 2027, with the launch wave on 17-21 Nov.
2. **Two or three named, numbered templates.**
   - Open: "Why X" (the why lane) and rankings ("Every X Ranked") exist.
   - To add: "Every GTA 6 X Explained" for long videos and a launch-week "Part N" series.
3. **About 2 Shorts a day, mostly on one game.** Current volume is enough. The focus and the editors' hot-topic lean concentrate it.
4. **Likeliest breakout:** a 40-70 second Short about a mystery, secret or cut feature, within days of launch, then a 15-25 minute "Every X Explained" long video.
5. **Hit protocol.** Done: the take-off detector (src/hits.ts) announces a Short running at 6x the usual pace and makes the editors lean into its game for three days. Still open: a forced long version within 7 days.
6. **Related-video link on every Short.** The scheduled task exists, but only one link has ever been set. Runs stalled on permission prompts, and Studio's picker does not render while Brave is minimised. Needs the owner's "Run now" once, and Brave left open.
7. **Community tab two or three times a week with polls.** The factory now records its daily post for reuse at /admin/engage-latest. A browser task posts it.
8. **Monthly documentary:** 15-30 minutes, one story, a "Why X" or "What Happened to X" title. Done in the documentary writer (26 Oct).
9. **Give each template about 20 uploads before cutting it.** Judge on views per upload and subscribers per 1,000 views.
10. **Build the library behind the spike:** playlists (done), end screens, and one evergreen long video a week (done).

## Caveats

- View counts are today's, so breakouts were dated by the month with the biggest subscriber jump.
- Social Blade's figures are rounded and its coverage partial (567 of 1,349 channels).
- Only public uploads are visible.
- The sample is small and survivor-biased, so the counts are directional.
