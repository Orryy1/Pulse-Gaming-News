# Local TTS Overnight Report

Generated: 2026-05-12T23:32:21.502Z
Verdict: GREEN
Expected local voice: pulse-sleepy-liam-20260502
Local proof preferred duration: 64-70s preferred, 61-75s accepted

## Doctor
- verdict=green action=none ready=true voice=liam loaded=true ref=true
- reason=local TTS is ready with the accepted voice loaded

## Proof Batch
- applied=11 voice_ready=6 rejected=0 skipped=0 superseded=6
- failures=none
- superseded_failures=duration_too_short:5, tts_timeout:1

## Voice-Ready MP3s
- rss_2d69aa8506934c5e: source=local_script_extension | measured=68.48s | target=pass | estimated=68.82s | 201 words | 176 WPM | pitch=103.22Hz | outro=true | test/output/local-script-extension/audio/rss_2d69aa8506934c5e_liam_extended.mp3
- 1t0zhng: source=local_script_extension | measured=71.52s | target=above_target | estimated=67.75s | 198 words | 166 WPM | pitch=95.02Hz | outro=true | test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3
- rss_ef7e6e464509e0bc: source=local_script_extension | measured=73.92s | target=above_target | estimated=68.4s | 200 words | 162 WPM | pitch=102.43Hz | outro=true | test/output/local-script-extension/audio/rss_ef7e6e464509e0bc_liam_extended.mp3
- rss_6edbb38dc280fc96: source=local_script_extension | measured=62.08s | target=below_target | estimated=68.62s | 201 words | 194 WPM | pitch=100.79Hz | outro=true | test/output/local-script-extension/audio/rss_6edbb38dc280fc96_liam_extended.mp3
- rss_6d8aaac7eccad2ff: source=local_script_extension | measured=62.72s | target=below_target | estimated=67.02s | 196 words | 188 WPM | pitch=104Hz | outro=true | test/output/local-script-extension/audio/rss_6d8aaac7eccad2ff_liam_extended.mp3
- rss_1b7c404fc657548f: source=local_script_extension | measured=66.08s | target=pass | estimated=68.16s | 199 words | 181 WPM | pitch=100.72Hz | outro=true | test/output/local-script-extension/audio/rss_1b7c404fc657548f_liam_extended.mp3

## Superseded Failed Attempts
- rss_6edbb38dc280fc96: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_6d8aaac7eccad2ff: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_1b7c404fc657548f: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_2d69aa8506934c5e: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_ef7e6e464509e0bc: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_2d69aa8506934c5e: source=local_script_extension | generate_tts_failed (tts_timeout)

## Local Recovery Plan
- local_only=true
- extend_script_story_ids=none
- retry_tts_story_ids=none
- blocked_by_voice_quality=false
- notes:
  - no local recovery work required for the current proof batch

## Safety
- Local proof/reporting only.
- Production voice, renderer, Railway, OAuth, tokens, DB rows and platform posting are unchanged.
- Old low/demonic local fallback voice is not allowed as an approved proof path.
