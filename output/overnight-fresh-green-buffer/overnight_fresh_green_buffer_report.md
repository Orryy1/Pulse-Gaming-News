# Overnight Fresh GREEN Buffer Report

Generated: 2026-06-12T18:48:11.143Z
Verdict: PARTIAL

## Result

- GREEN candidates: 3 / 5 minimum, 10 stretch
- Strict dry-run ready stories: 3
- Enabled-platform dry-run actions: 9
- Enabled-platform hard blockers: 0
- Deferred disabled-platform actions: 10
- Queue inspect: pass
- Platform doctor: AMBER
- Publish cadence: amber

## GREEN Candidates

- rss_0b39e0171f59712c: Dragonwilds Has One Last Early Access Test (46.344s, script score 94, preflight pass)
- fresh_xbox_halo_campaign_evolved_demo_20260610: Halo: Campaign Evolved Shows The Real Remake Test (43.9s, script score 90, preflight pass)
- fresh_xbox_stranger_than_heaven_20260611: Stranger Than Heaven Gives RGG A Real Combat Reset (50.6s, script score 94, preflight pass)

## Remaining Blockers

- rss_600fca97d3e40552: GTA 5 Became The GTA 6 Waiting Room ? tts_caption; Official/direct GTA motion was materialised, but local Whisper alignment rejected the narration because ASR inserted words above the zero-insert threshold.
- rss_2922a1471f7897be: Gears E-Day Is Xbox's Comeback Test ? motion; Fresh source, but official/direct video motion floor is not met safely.
- rss_aa1c4b00ddd7c28c: Valor Mortis Shows The Soulslike Test ? motion; Only one story-correct validated direct segment was found; motion diversity floor not met.
- rss_97ea52eac6466a01: Fable Delay Is Xbox's GTA 6 Problem ? motion; Fresh source, but direct motion floor not met.
- rss_c9e8b69ee7d15384: The Elder Scrolls 6 Still Has No Real Date ? motion; Fresh source, but direct-video motion evidence is missing.
- rss_eabd1bead492f47d: Dragon's Dogma 2 Update Needs Real Proof ? tts_motion; Fresh source, but audio/timestamps and direct motion are not publish-ready.
- rss_7391381aa4dd5606: Quake Champions Is Testing A Comeback ? motion; Fresh source, but materialised direct motion is missing.
- rss_1a5c9eee2fc739b5: Code Veronica Just Answered The Camera Question ? motion_audio; Fresh source, but motion evidence and/or final narration proof remains stale.

## Notes

- Today's Discord scoring digest is alive again: 23 scored, 13 auto, 7 review, 2 defer, 1 reject, 1 hard-stop.
- Render-health Discord still shows live DB stamped-row debt, but the bridge view is clean: 3/3 premium Visual V4 with direct video motion.
- Dragonwilds was repaired from stale voice/caption proof to strict-ready; GTA 5 was not promoted because Whisper alignment inserted ASR words.
- No manual publishing, DB mutation, OAuth/token mutation, billing change or disabled-platform enablement occurred.

## Next Action

Let the guarded scheduler continue only if runtime readiness is non-red; continue candidate supply repairs starting with GTA TTS/caption alignment and motion floors for Gears/Valor/Fable.
