# Local TTS Overnight Report

Generated: 2026-05-12T18:26:40.791Z
Verdict: AMBER
Expected local voice: pulse-sleepy-liam-20260502
Local proof duration target: 64-70s target

## Doctor
- verdict=green action=none ready=true voice=liam loaded=true ref=true
- reason=local TTS is ready with the accepted voice loaded

## Proof Batch
- applied=6 voice_ready=0 rejected=6 skipped=2
- failures=duration_too_short:5, reject_duration_above_local_target:1, tts_timeout:2

## Voice-Ready MP3s
- none

## Rejected Proofs
- rss_6edbb38dc280fc96: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_6d8aaac7eccad2ff: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_1b7c404fc657548f: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_2d69aa8506934c5e: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_ef7e6e464509e0bc: source=local_media_repair | reject_duration_too_short (duration_too_short)
- 1t0x9ui: source=local_script_extension | reject_duration_above_local_target

## Skipped
- 1t186u4: generate_tts_failed (tts_timeout)
- 1t0zhng: generate_tts_failed (tts_timeout)

## Safety
- Local proof/reporting only.
- Production voice, renderer, Railway, OAuth, tokens, DB rows and platform posting are unchanged.
- Old low/demonic local fallback voice is not allowed as an approved proof path.
