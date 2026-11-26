# Pulse experiments

The ledger for the weekly growth cycle (Thursdays, task pulse-weekly-improvement). Every change being tested has a hypothesis, the setting, how it is compared, a pass mark and an end date, written before it starts. The cycle judges each one: keep, revert or extend once.

Baseline, 14 Oct to 11 Nov 2026 (28 days): YouTube Shorts 41,042 views over 113 (16 subscribers gained, about 0.4 per 1,000 Shorts views); TikTok 46,850 over 54 posts (typical post 727); Instagram 26,771 over 117 Reels; long videos 1,770 views over 7; 49 subscribers in total.

## Running

| #   | Change (started)                                                             | Setting                                                           | Compared how                                                                         | Pass mark                                                                                    | Judge on                                   |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | Friend voice from the 11 Nov voice study, friend pass (11 Nov 18:50). NOTE 18 Nov: Claude refused every call from 12 Nov (API spend cap), so every pass and script since was written by Codex, and 8 to 11 Nov was mostly Codex too (trial). Read the verdict as friend voice + new narrator + Codex writer together, never as an Opus result | FRIEND_PASS, FRIEND_PASS_TIER=top                                 | Shorts from 12 Nov against 14 Oct to 11 Nov                                          | Average viewed up 3 points or more, and subscribers per 1,000 Shorts views up, on 40+ Shorts | 3 Dec                                      |
| 2   | Expressive narration, voice C with the creator mic (11 Nov 14:31)            | VOICE_STABILITY=0.5, VOICE_TAGS, VOICE_MIC_CHAIN, SHORT_SPEED=1.1 | Same before and after window as 1 (both started the same day, so read them together) | 3-second hold not worse; average viewed up                                                   | 3 Dec                                      |
| 3   | DECIDED 26 Nov (see Decided). TikTok 4 a day, 3 hours apart, best pick (11 Nov)                            | TIKTOK_DAILY=4, TIKTOK_GAP_MINUTES=180                            | Middle-post views against the 7 to 8 Nov runs                                        | No run of 3+ posts under a tenth of usual views; median post views at or above 727           | 2 Dec                                      |
| 4   | Instagram best 3 a day, 2 hours apart (11 Nov)                               | INSTAGRAM_DAILY=3, INSTAGRAM_GAP_MINUTES=120                      | Median Reel views against the baseline                                               | Median up                                                                                    | 2 Dec                                      |
| 5   | Fandom and "why" stories favoured in picks and posting (11 Nov)              | ANALYTICS_LOOP_POSTING, ANALYTICS_LOOP_SCORING                    | Breakout share and subscribers per 1,000 views                                       | 0.8 subscribers per 1,000 Shorts views over the 28 days to 9 Dec                             | 10 Dec                                     |
| 6   | Facebook paused (11 Nov)                                                     | CROSSPOST_FACEBOOK=false                                          | n/a                                                                                  | Revisit only if a reason appears                                                             | 10 Dec                                     |
| 7   | CLOSED 26 Nov, not measurable (see Decided). GTA Part 1 retitled for search (11 Nov)                                      | YouTube title                                                     | Views in the 48 hours before and after                                               | Views per day up                                                                             | 14 Nov                                     |
| 8   | The launch-day documentary as the long-video test (21 Nov)                   | n/a                                                               | Its own views                                                                        | 1,000+ views in its first 14 days, else pause long videos                                    | 5 Dec (task pulse-long-video-verdict-5dec) |

## Ready to start after 22 Nov (pre-built, off)

- The GTA VI strand and Shorts length lanes (branch claude/strand-lengths).
- Short structure rotation, the argues check and same-day angles (branch claude/skeletons).
- "The Story of Every GTA Game" (branch claude/everygame).
- Apple Vision framing (branch claude/appletools).
- Writer lessons from the analytics loop (ANALYTICS_LOOP_LESSONS) once its fit test reports on 25 Nov.

## Decided

### 26 Nov 2026 (weekly cycle)

- **3. TikTok 4 a day, 3 hours apart: passed, then superseded by the owner.** 11 to 20 Nov: 25 posts, median 730 views (pass mark 727), longest run under a tenth of usual 2 posts (pass: no run of 3+). On 20 Nov 12:40 the owner moved TikTok to every Short, 45 minutes apart (TIKTOK_DAILY=0, TIKTOK_GAP_MINUTES=45). First 12 posts since: median 160 and one dead run of 3 on 20 to 21 Nov (young posts, not judged). Owner's setting kept; result sent to Martin for information.
- **7. GTA Part 1 retitle: closed, not measurable.** No daily view history is stored for the 48 hours either side of 11 Nov. Title kept.
- **Pip (was e4) moved back to the backlog.** It never started: MASCOT_SHARE is unset on the Mac. First to start when the Instagram test ends on 2 Dec, if the guardrail is clear.

Interim readings (not verdicts):

- **1 and 2. Friend voice and voice:** 56 Shorts from 12 to 23 Nov against 117 from 14 Oct to 11 Nov: average viewed 56.7% against 62.1% views-weighted (median per Short 54.6% against 50.8%), subscribers per 1,000 0.30 against 0.37 (4 against 18). Failing so far; judge 3 Dec. If it fails, only FRIEND_PASS is ours to revert: the narrator and the friend tone are the owner's choices.
- **4. Instagram 3 a day:** 36 Reels with readings, median 133 (11 to 20 Nov) and 366 (20 to 23 Nov, 9 young Reels) against 143.5. Under 40; judge 2 Dec.
- **5. Fandom and why:** 0.36 subscribers per 1,000 Shorts views (19 to 26 Nov) against the 0.8 pass mark. The series report's "kill" for The Why rests on 3 subscribers against 3; the series verdict stays on 5 Dec as planned.

**Guardrail:** core numbers fell more than 20% week on week (Shorts views 5,596 against 9,399; watch hours 19 against 54). The cause is output (28 Shorts against 37 after the 24 to 25 Nov writing outage; median views per Short held, 168 against 149), so nothing new started this week. The newest change (story premise gate, 26 Nov 10:55) came after the drop, so it was not reverted.
