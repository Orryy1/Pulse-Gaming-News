# Pulse scoreboard

The owner's goal, 4 Nov 2026: never miss a story, world-class videos in every format, an active community on every platform, and views in the hundreds of thousands to millions per video. Keep this current; numbers come from the factory, not from memory.

| Goal               | Measure                                                                                                   | Now (week to 11 Nov)                                                                                  | Target                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Never miss a story | Big stories made / big stories that day (daily miss report)                                               | 4 big-story-missed alerts in 7 days, falling; 0 in the last 24 h                                      | Every one, with a reason logged for any exception                |
| World-class videos | Score per format in `World class audit November 2026.md`, gate failures per week, defects found by frames | 3 video faults, 12 sentence-matching and 9 narration alerts in 7 days, most on "GTA 6 Before You Buy" | 9/10 or better in each format                                    |
| Retention          | Average viewed per format (YouTube, views-weighted)                                                       | News 67%, breaking 75%, evergreen 46%, long 21%                                                       | Rising; top of the niche per format                              |
| Hold               | Engaged views / views (nearest to 3-second hold)                                                          | News 44%, breaking 48%, evergreen 33%, long 52%                                                       | 60%+ on Shorts                                                   |
| Community          | Comments per 1,000 views                                                                                  | News 0.44, breaking 1.32, evergreen 2.36, long 0                                                      | Every genuine comment answered within hours                      |
| Growth             | Subscribers per 1,000 views                                                                               | 0.45 overall (5 from 11,040 views); news 0.58, breaking 0, evergreen 0, long 1.85                     | 1,000 subscribers and 8,000 hours before 1 Feb 2027, then upward |
| Output             | Uploads a day; gaps over 6 hours outside the night                                                        | 4 to 8 a day (43 public, 1 private); the long gaps are the planned night (about 22:00 to 12:00 UK)    | Plan's slots, no daytime gap                                     |

Numbers: `/admin/channel-report?days=7` on the Mac, 11 Nov 21:00 (YouTube Analytics lags about 2 days, so 138 of 305 listed videos have rows) and `data/logs/alert_digest.md`.

## Week to 26 Nov (weekly cycle)

YouTube, 19 to 26 Nov against 12 to 19 Nov (channel report on the Mac; Analytics lags about 2 days):

| Format | Views | Average viewed | Engaged | Subscribers (per 1,000) | Watch hours | Comments |
| --- | --- | --- | --- | --- | --- | --- |
| Shorts | 5,596 (9,399) | 57.0% (67.1%) | 42.2% (41.7%) | 2 (0.36) | 14.1 (27.4) | 14 (12) |
| Long videos | 303 (1,023) | 27.7% (17.2%) | 22.4% (29.6%) | 1 (3.3) | 4.8 (26.8) | 4 (0) |

Published: 28 Shorts and 6 long (37 Shorts the week before). Median views per Short 168 (149). Channel: 54 subscribers (49 on 11 Nov). TikTok 4 a day passed (median 730) before the owner moved to every Short on 20 Nov.

**Three weakest spots:** (1) output: 28 Shorts against 37, 1 long of the planned 5, slots lost on 24 and 25 Nov; (2) watch hours: about 19 a week, far off 8,000 a year; (3) subscribers: 0.36 per 1,000 Shorts views, the 1,000 plan needs about 14 a day.

**Three biggest wins:** (1) views per Short held through the outage (median 168 against 149); (2) long videos are watched longer (average viewed 27.7% against 17.2%) and earned a subscriber; (3) TikTok's 4 a day test passed with no dead runs.

## Three weakest spots this week

1. **Long videos are watched for 21% of their length** (540 views on 7 videos, 482 of them on San Andreas). The ranking long video "Every Mainline GTA Game, Ranked" got 2 views.
2. **Evergreen Shorts (deals and rankings) draw almost nothing**: 424 views on 18, 33% hold, 0 subscribers.
3. **Breaking Shorts earn no subscribers**: 3,019 views, 0 subscribers; several news Shorts stalled at 1 to 10 views.

## Work under way, 11 Nov

- Voice study and friend pass live (VOICE_TEST_SHARE=1: every news and Why Short uses the personal voice)
- Hard daily caps and a best pick per platform (crosspost)
- Scene index for every game (Ocarina first, GTA VI from 19 Nov)
- Writer model trial: Fable against Opus on 5 real Shorts (`reports/Writer model trial November 2026.md`)
- Daily review: scheduled task `pulse-daily-director`, 09:30
