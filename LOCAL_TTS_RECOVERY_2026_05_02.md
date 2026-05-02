# Local TTS Recovery - 2026-05-02

## Summary

Pulse local VoxCPM voice synthesis is working again through the project TTS path.

The root cause was a mismatch with the working `sleepy-empire` VoxCPM server. Sleepy loads VoxCPM with `load_denoiser=False` and serialises GPU generation. Pulse was loading the VoxCPM denoiser and allowed unsynchronised generation calls. The denoiser path was visible in logs as `enable_denoiser: True`, then local generation hung during synth.

Second-pass audio QA found an additional voice-quality issue: the first smoke MP3s could still sound too low because Pulse accepted any VoxCPM take that returned bytes. The server now uses VoxCPM's real model sample rate, disables prompt conditioning for Pulse Liam by default, removes the old speed compensation and rejects low-F0 local takes before returning them.

## Fix

- `tts_server/voxcpm_engine.py`
  - Added `load_denoiser=False` support.
  - Passes `load_denoiser=self.load_denoiser` into `VoxCPM.from_pretrained`.
  - Adds a process-wide generation lock around `model.generate`.
  - Adds `generate_begin`, `generate_end`, `stretch_begin` and `stretch_end` timing logs.
  - Uses VoxCPM's native `tts_model.sample_rate` instead of hardcoding 16 kHz.
  - Adds local voice QA metrics and fallback candidates for low/demonic takes.
- `tts_server/server.py`
  - Passes per-voice `load_denoiser` into `VoxCPMEngine`.
  - Keeps the default fallback engine denoiser-disabled.
  - Respects per-voice prompt policy and voice QA settings.
- `tts_server/voices.json`
  - Marks Pulse Liam and Sleepy Christopher local voices with `"load_denoiser": false`.
  - Sets Pulse Liam to `base_speed=1.0`, disables prompt text conditioning and enables acoustic QA.
- `audio.js`, `lib/studio/sound-layer.js`, `tools/studio-v2-local-render.js`
  - Removes the old local VoxCPM speed compensation defaults that were created around the broken 16 kHz path.
- `tests/services/local-tts-voice-config.test.js`
  - Adds regression coverage for denoiser safety, generation serialisation, model sample-rate use, prompt policy and voice QA.

## Local Proof

Server:

```text
http://127.0.0.1:8765
```

Prewarm:

```text
voice_id=TX3LPaxmHKxFdv7VOQHJ
loaded_ms=16672
engine_count=1
reused=false
```

Server log proof:

```text
enable_denoiser: False
VoxCPM 2 loaded (sample_rate=48000)
generate_begin candidate=configured ... ref=True prompt=False denoiser=False
voice_qa candidate=configured metrics={'duration_s': 7.2, 'median_f0_hz': 116.26, ...} rejection=None
stretch_begin rate=1.150
```

Smoke output:

```text
D:\pulse-data\media\output\audio\__local_tts_smoke.mp3
D:\pulse-data\media\output\audio\__local_tts_smoke_timestamps.json
D:\pulse-data\media\output\audio\__local_tts_smoke_fixed_20260502.mp3
```

Acoustic check:

```text
__local_tts_smoke.mp3: duration=6.261s median_f0=119.90Hz
__local_tts_smoke_fixed_20260502.mp3: duration=9.183s median_f0=135.84Hz
Pulse voice reference: duration=25.000s median_f0=127.30Hz
ElevenLabs comparison: duration=54.976s median_f0=126.91Hz
```

## Commands Run

```text
node --test tests\services\local-tts-voice-config.test.js
node --test tests\services\studio-v2-regressions.test.js
tts_server\venv\Scripts\python.exe -m py_compile tts_server\voxcpm_engine.py tts_server\server.py tools\local_tts_voice_audition.py
Invoke-RestMethod /v1/prewarm
Invoke-RestMethod /v1/text-to-speech/.../with-timestamps
npm run tts:smoke
python acoustic metrics for smoke/reference/ElevenLabs comparison
```

## Safety Boundaries

- No Railway variables changed.
- No production DB writes.
- No OAuth changes.
- No social posting.
- No renderer default switch.
- Existing old MP4s are not fixed retroactively. They need new audio or fresh renders.

## Next

Use this server for a controlled local render proof only after the smoke MP3 is manually listened to. If the voice is accepted, the next code step is a local render command that refuses old demonic audio caches and regenerates Pulse narration through this fixed local path.
