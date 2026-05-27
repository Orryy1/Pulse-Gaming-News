# Local TTS Sleepy Liam Lock - 2026-05-03

## Summary

Pulse local TTS now locks the Pulse Gaming VoxCPM voice path to the approved Sleepy Liam reference.

The previous risk was that VoxCPM voice QA could reject a referenced candidate, then silently select an unreferenced fallback voice. That made the system look as if it was using the approved local voice while actually producing the wrong low/demonic voice.

## Safety Change

- Pulse voice id: `TX3LPaxmHKxFdv7VOQHJ`
- Local reference: `tts_server/voices/pulse_liam_sleepy.wav`
- `fallback_without_reference`: `false`
- `base_speed`: `1.0`
- `cfg_value`: `2.0`
- `inference_timesteps`: `20`
- `load_denoiser`: `false`

If the approved reference path cannot be used, the system must fail/review instead of silently swapping to a generic VoxCPM voice.

## Smoke Result

- Command: `npm run tts:smoke`
- MP3: `D:\pulse-data\media\output\audio\__local_tts_smoke.mp3`
- Timestamps: `D:\pulse-data\media\output\audio\__local_tts_smoke_timestamps.json`
- Health after warmup: `ready=true`, `voice=liam`, `loaded=true`, `ref=true`
- QA candidate used: `configured`
- Fallback used: no
- Median F0: `104.52 Hz`
- Accent check: timestamp JSON preserves `Pokémon` as `é` codepoint `e9`

## Flash Lane Voice Proof

- Command: `node tools/flash-lane-voice-workbench.js --fixture --generate-local --apply-local --approved-local-voice --rate 0.85 --out-dir test/output/flash-lane-voice-workbench-rate085`
- Report: `test/output/flash-lane-voice-workbench-rate085/flash_lane_voice_workbench_fixture_flash_lane_story.md`
- JSON: `test/output/flash-lane-voice-workbench-rate085/flash_lane_voice_workbench_fixture_flash_lane_story.json`
- MP3: `test/output/flash-lane-voice-workbench-rate085/flash-lane-voice-workbench-assets/fixture_flash_lane_story_voxcpm2_0_85.mp3`
- Verdict: `candidate_ready`
- Duration: `62.305873s`
- Pace: `155 WPM`
- Blockers: none
- Warnings: none
- Approved local voice reference: `pulse-sleepy-liam-20260502`
- Reference file: `pulse_liam_sleepy.wav`

## Boundaries

- No Railway environment variables changed.
- No OAuth was triggered.
- No production DB rows were changed.
- No social posts were made.
- No production voice default was switched.
- No production renderer default was switched.

## Next Use

For local Flash Lane voice trials, use the approved Sleepy Liam reference with `--rate 0.85` when the script is near the current fixture length. The exact rate should still be recalculated per script to keep narration between 61 and 75 seconds without forcing rushed delivery.
