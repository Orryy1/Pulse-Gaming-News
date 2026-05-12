# Local TTS Overnight Report

Generated: 2026-05-12T18:39:25.692Z
Verdict: AMBER
Expected local voice: pulse-sleepy-liam-20260502
Local proof preferred duration: 64-70s preferred, 61-75s accepted

## Doctor
- verdict=green action=none ready=true voice=liam loaded=true ref=true
- reason=local TTS is ready with the accepted voice loaded

## Proof Batch
- applied=6 voice_ready=1 rejected=5 skipped=2
- failures=duration_too_short:5, tts_timeout:2

## Voice-Ready MP3s
- 1t0x9ui: source=local_script_extension | measured=72.96s | target=above_target | estimated=66.44s | 194 words | 160 WPM | pitch=95.56Hz | outro=true | test/output/local-script-extension/audio/1t0x9ui_liam_extended.mp3

## Rejected Proofs
- rss_6edbb38dc280fc96: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_6d8aaac7eccad2ff: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_1b7c404fc657548f: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_2d69aa8506934c5e: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_ef7e6e464509e0bc: source=local_media_repair | reject_duration_too_short (duration_too_short)

## Skipped
- 1t186u4: generate_tts_failed (tts_timeout)
- 1t0zhng: generate_tts_failed (tts_timeout)

## Safety
- Local proof/reporting only.
- Production voice, renderer, Railway, OAuth, tokens, DB rows and platform posting are unchanged.
- Old low/demonic local fallback voice is not allowed as an approved proof path.
