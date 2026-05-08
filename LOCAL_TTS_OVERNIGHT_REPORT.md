# Local TTS Overnight Report

Generated: 2026-05-08T08:16:11.629Z
Verdict: AMBER
Expected local voice: pulse-sleepy-liam-20260502

## Doctor
- verdict=green action=none ready=true voice=liam loaded=true ref=true
- reason=local TTS is ready with the accepted voice loaded

## Proof Batch
- applied=8 voice_ready=3 rejected=5 skipped=0
- failures=duration_too_short:5

## Voice-Ready MP3s
- 1t186u4: source=local_script_extension | measured=71.84s | estimated=68s | 200 words | 167 WPM | pitch=107.33Hz | outro=true | test/output/local-script-extension/audio/1t186u4_liam_extended.mp3
- 1t0zhng: source=local_script_extension | measured=64.8s | estimated=66.3s | 195 words | 181 WPM | pitch=106.91Hz | outro=true | test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3
- 1t0x9ui: source=local_script_extension | measured=69.12s | estimated=66.3s | 195 words | 169 WPM | pitch=100.27Hz | outro=true | test/output/local-script-extension/audio/1t0x9ui_liam_extended.mp3

## Rejected Proofs
- rss_6edbb38dc280fc96: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_6d8aaac7eccad2ff: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_1b7c404fc657548f: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_2d69aa8506934c5e: source=local_media_repair | reject_duration_too_short (duration_too_short)
- rss_ef7e6e464509e0bc: source=local_media_repair | reject_duration_too_short (duration_too_short)

## Safety
- Local proof/reporting only.
- Production voice, renderer, Railway, OAuth, tokens, DB rows and platform posting are unchanged.
- Old low/demonic local fallback voice is not allowed as an approved proof path.
