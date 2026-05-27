# TTS Audio Quality Fix Report

Date: 2026-05-14

## Problem

Recent Pulse Gaming videos had narration that sounded less clean, clear and loud than the earlier approved Liam local TTS proof.

Measured evidence showed:

- Recent raw local TTS MP3s were about -23.5 to -24.6 LUFS.
- Recent final MP4s were about -29.5 to -30.5 LUFS.
- The final render was roughly 6 dB quieter than the raw narration because the legacy FFmpeg `amix` path used default normalisation when music was present.

That made the voice feel buried and weak in final Shorts.

## Fix

Two safe, reversible changes were added:

1. Local TTS voice mastering
   - Applies only to local TTS by default.
   - Can be disabled with `LOCAL_TTS_VOICE_MASTERING=false`.
   - Remote ElevenLabs mastering remains opt-in with `TTS_VOICE_MASTERING=true`.
   - Uses high-pass cleanup, light EQ, compression, loudness normalisation and a limiter.
   - Outputs 44.1 kHz, 192 kbps MP3.

2. Narration-preserving final mix
   - `assemble.js` now uses `amix=normalize=0` for voice plus music.
   - A limiter is applied after the mix.
   - This stops background music from halving the narration level.

## Proof

Local A/B proof files:

- Raw source: `D:\pulse-data\media\output\audio\1tcabvy.mp3`
- Mastered voice proof: `C:\Users\MORR\gaming-studio\pulse-gaming\test\output\audio-quality\1tcabvy_voice_mastered.mp3`
- Fixed voice/music mix proof: `C:\Users\MORR\gaming-studio\pulse-gaming\test\output\audio-quality\1tcabvy_voice_music_mix_fixed.mp3`
- Metrics JSON: `C:\Users\MORR\gaming-studio\pulse-gaming\test\output\audio-quality\voice_mastering_ab.json`

Measured result:

- Raw voice: -24.57 LUFS
- Mastered voice: -15.59 LUFS
- Existing baked final MP4: -30.52 LUFS
- Fixed proof mix: about -15 LUFS

## Safety

- No production DB mutation.
- No OAuth or tokens touched.
- No social posting triggered.
- Existing published MP4s are not modified.
- New renders get the improved audio path.

## Validation

- Targeted audio/subtitle tests passed.
- `npm run build` passed.
- Full `npm test` passed: 2532 tests.

## Next Step

Re-render the next candidate locally before publishing and listen for:

- narration loudness,
- clarity,
- no clipping,
- subtitle sync,
- music not overpowering the voice.
