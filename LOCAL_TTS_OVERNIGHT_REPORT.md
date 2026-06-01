# Local TTS Overnight Report

Generated: 2026-06-01T04:46:16.912Z
Verdict: AMBER
Expected local voice: pulse-sleepy-liam-20260502
Local proof preferred duration: 64-70s preferred, 61-75s accepted

## Doctor
- verdict=green action=none ready=true voice=liam loaded=true ref=true
- reason=local TTS is ready with the accepted voice loaded

## Proof Batch
- applied=30 voice_ready=16 rejected=9 skipped=6 superseded=7
- failures=duration_too_short:8, duration_too_long:1, connection_reset:2, tts_timeout:4
- superseded_failures=duration_too_short:4, duration_too_long:1, tts_timeout:1, connection_reset:1

## Voice-Ready MP3s
- 1tl8akr: source=local_media_repair | measured=66.08s | target=pass | estimated=66.58s | 221 words | 201 WPM | pitch=107.68Hz | outro=true | D:\pulse-data\media\test\output\local-media-repair\audio\1tl8akr_liam.mp3
- 1tb2q61: source=local_media_repair | measured=61.44s | target=below_target | estimated=53.5s | 177 words | 173 WPM | pitch=99.02Hz | outro=true | D:\pulse-data\media\test\output\local-media-repair\audio\1tb2q61_liam.mp3
- rss_7945f462187bd7f8: source=local_media_repair | measured=70.56s | target=above_target | estimated=65.39s | 191 words | 162 WPM | pitch=109.12Hz | outro=true | D:\pulse-data\media\test\output\local-media-repair\audio\rss_7945f462187bd7f8_liam.mp3
- 1tb2q61: source=local_media_repair | measured=63.36s | target=below_target | estimated=60.58s | 177 words | 168 WPM | pitch=105.66Hz | outro=true | D:\pulse-data\media\test\output\local-media-repair\audio\1tb2q61_liam.mp3
- 1tcabvy: source=local_media_repair | measured=69.44s | target=pass | estimated=63.01s | 184 words | 159 WPM | pitch=95.28Hz | outro=true | D:\pulse-data\media\test\output\local-media-repair\audio\1tcabvy_liam.mp3
- 1tb5izu: source=local_media_repair | measured=62.72s | target=below_target | estimated=65.27s | 191 words | 183 WPM | pitch=98.3Hz | outro=true | D:\pulse-data\media\test\output\local-media-repair\audio\1tb5izu_liam.mp3
- 1tf39iq: source=local_script_extension | measured=66.24s | target=pass | estimated=68.9s | 196 words | 178 WPM | pitch=99.05Hz | outro=true | test/output/local-script-extension/audio/1tf39iq_liam_extended.mp3
- 1thb9qp: source=local_script_extension | measured=64s | target=pass | estimated=74.63s | 212 words | 199 WPM | pitch=106.06Hz | outro=true | test/output/local-script-extension/audio/1thb9qp_liam_extended.mp3
- 1t0zhng: source=local_script_extension | measured=71.52s | target=above_target | estimated=67.75s | 198 words | 166 WPM | pitch=95.02Hz | outro=true | test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3
- rss_ef7e6e464509e0bc: source=local_script_extension | measured=73.92s | target=above_target | estimated=68.4s | 200 words | 162 WPM | pitch=102.43Hz | outro=true | test/output/local-script-extension/audio/rss_ef7e6e464509e0bc_liam_extended.mp3
- rss_6edbb38dc280fc96: source=local_script_extension | measured=62.08s | target=below_target | estimated=68.62s | 201 words | 194 WPM | pitch=100.79Hz | outro=true | test/output/local-script-extension/audio/rss_6edbb38dc280fc96_liam_extended.mp3
- rss_6d8aaac7eccad2ff: source=local_script_extension | measured=62.72s | target=below_target | estimated=67.02s | 196 words | 188 WPM | pitch=104Hz | outro=true | test/output/local-script-extension/audio/rss_6d8aaac7eccad2ff_liam_extended.mp3
- rss_1b7c404fc657548f: source=local_script_extension | measured=66.08s | target=pass | estimated=68.16s | 199 words | 181 WPM | pitch=100.72Hz | outro=true | test/output/local-script-extension/audio/rss_1b7c404fc657548f_liam_extended.mp3
- rss_2d69aa8506934c5e: source=local_script_extension | measured=68.48s | target=pass | estimated=68.82s | 201 words | 176 WPM | pitch=103.22Hz | outro=true | test/output/local-script-extension/audio/rss_2d69aa8506934c5e_liam_extended.mp3
- 1tb13l5: source=local_script_extension | measured=64.8s | target=pass | estimated=64.75s | 184 words | 170 WPM | pitch=102.89Hz | outro=true | test/output/local-script-extension/audio/1tb13l5_liam_extended.mp3
- 1tkik53: source=local_script_extension | measured=66.72s | target=pass | estimated=69.65s | 198 words | 178 WPM | pitch=107.74Hz | outro=true | test/output/local-script-extension/audio/1tkik53_liam_extended.mp3

## Unresolved Rejected Proofs
- 1t186u4: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_c4cabfc862af7b64: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1tb3i1r: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1t186u4: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1tb3i1r: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1tk1lpr: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1tkzdfq: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1thnwdq: source=local_script_extension | reject_duration_too_long (duration_too_long)
- 1tayii3: source=local_script_extension | reject_duration_too_short (duration_too_short)

## Skipped
- 1tbdx3b: generate_tts_failed (connection_reset) | server reset recorded
- 1t186u4: generate_tts_failed (tts_timeout) | server reset recorded
- 1tgr15g: generate_tts_failed (tts_timeout) | server reset recorded
- 1tk1lpr: generate_tts_failed (tts_timeout) | server reset recorded
- 1tkzdfq: generate_tts_failed (tts_timeout) | server reset recorded
- 1te1oq7: generate_tts_failed (connection_reset) | server reset recorded

## Superseded Failed Attempts
- rss_6edbb38dc280fc96: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1tb5izu: source=local_script_extension | reject_duration_too_short (duration_too_short)
- 1tkik53: source=local_script_extension | reject_duration_too_long (duration_too_long)
- 1tkik53: source=local_script_extension | reject_duration_too_short (duration_too_short)
- 1t0zhng: source=local_script_extension | reject_duration_too_short (duration_too_short)
- rss_2d69aa8506934c5e: source=local_script_extension | generate_tts_failed (tts_timeout)
- 1tb5izu: source=local_script_extension | generate_tts_failed (connection_reset)

## Local Recovery Plan
- local_only=true
- extend_script_story_ids=1t186u4, rss_c4cabfc862af7b64, 1tb3i1r, 1tk1lpr, 1tkzdfq, 1tayii3
- retry_tts_story_ids=1tbdx3b, 1t186u4, 1tgr15g, 1tk1lpr, 1tkzdfq, 1te1oq7
- blocked_by_voice_quality=false
- commands:
  - `npm run ops:local-media-repair -- --dry-run`
  - `npm run ops:local-script-extension -- --dry-run`
  - `npm run ops:local-script-extension -- --apply-local-audio --apply-limit 3`
  - `npm run tts:overnight-report`
- notes:
  - duration_too_short proofs should be repaired by local script extension before another Studio V2 proof render
  - timeout/reset stories can be retried locally after the TTS server health check is green

## Safety
- Local proof/reporting only.
- Production voice, renderer, Railway, OAuth, tokens, DB rows and platform posting are unchanged.
- Old low/demonic local fallback voice is not allowed as an approved proof path.
