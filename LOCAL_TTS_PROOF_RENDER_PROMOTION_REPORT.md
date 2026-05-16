# Local TTS Proof Render Promotion

Generated: 2026-05-16T08:58:38.001Z
Verdict: GREEN
Can replace ElevenLabs for proof renders: yes
Expected local voice: pulse-sleepy-liam-20260502
Recommendation: local_tts_can_replace_elevenlabs_for_proof_renders
Blockers: clear
Warnings: none

## Gates
- approved_voice_sample=true sample=pulse_liam_sleepy.wav hash=present
- health=true doctor=green voice=liam loaded=true ref=true
- generation_evidence=true ready=11/3 unresolved_rejected=4 unresolved_skipped=1
- timestamp_usability=true usable=11/11
- loudness_mastering=true mastered=11/11

## Proof Candidates
- rss_7945f462187bd7f8: source=local_media_repair duration=70.56s wpm=162 voice=pulse-sleepy-liam-20260502 audio=D:\pulse-data\media\test\output\local-media-repair\audio\rss_7945f462187bd7f8_liam.mp3
- 1tb2q61: source=local_media_repair duration=63.36s wpm=168 voice=pulse-sleepy-liam-20260502 audio=D:\pulse-data\media\test\output\local-media-repair\audio\1tb2q61_liam.mp3
- 1tcabvy: source=local_media_repair duration=69.44s wpm=159 voice=pulse-sleepy-liam-20260502 audio=D:\pulse-data\media\test\output\local-media-repair\audio\1tcabvy_liam.mp3
- 1tb5izu: source=local_media_repair duration=62.72s wpm=183 voice=pulse-sleepy-liam-20260502 audio=D:\pulse-data\media\test\output\local-media-repair\audio\1tb5izu_liam.mp3
- 1tb5izu: source=local_script_extension duration=67.52s wpm=170 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/1tb5izu_liam_extended.mp3
- 1t0zhng: source=local_script_extension duration=71.52s wpm=166 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3
- rss_ef7e6e464509e0bc: source=local_script_extension duration=73.92s wpm=162 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/rss_ef7e6e464509e0bc_liam_extended.mp3
- rss_6edbb38dc280fc96: source=local_script_extension duration=62.08s wpm=194 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/rss_6edbb38dc280fc96_liam_extended.mp3
- rss_6d8aaac7eccad2ff: source=local_script_extension duration=62.72s wpm=188 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/rss_6d8aaac7eccad2ff_liam_extended.mp3
- rss_1b7c404fc657548f: source=local_script_extension duration=66.08s wpm=181 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/rss_1b7c404fc657548f_liam_extended.mp3
- rss_2d69aa8506934c5e: source=local_script_extension duration=68.48s wpm=176 voice=pulse-sleepy-liam-20260502 audio=test/output/local-script-extension/audio/rss_2d69aa8506934c5e_liam_extended.mp3

## Safety
- Local-only read/report check.
- Production voice remains unchanged.
- No ElevenLabs credits, OAuth flow, Railway env var, token, production DB row or platform post is touched.
