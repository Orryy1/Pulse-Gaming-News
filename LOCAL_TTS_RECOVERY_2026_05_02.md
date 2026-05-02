# Local TTS Recovery - 2026-05-02

## Summary

Pulse local VoxCPM voice synthesis is working again through the project TTS path.

The root cause was a mismatch with the working `sleepy-empire` VoxCPM server. Sleepy loads VoxCPM with `load_denoiser=False` and serialises GPU generation. Pulse was loading the VoxCPM denoiser and allowed unsynchronised generation calls. The denoiser path was visible in logs as `enable_denoiser: True`, then local generation hung during synth.

## Fix

- `tts_server/voxcpm_engine.py`
  - Added `load_denoiser=False` support.
  - Passes `load_denoiser=self.load_denoiser` into `VoxCPM.from_pretrained`.
  - Adds a process-wide generation lock around `model.generate`.
  - Adds `generate_begin`, `generate_end`, `stretch_begin` and `stretch_end` timing logs.
- `tts_server/server.py`
  - Passes per-voice `load_denoiser` into `VoxCPMEngine`.
  - Keeps the default fallback engine denoiser-disabled.
- `tts_server/voices.json`
  - Marks Pulse Liam and Sleepy Christopher local voices with `"load_denoiser": false`.
- `tests/services/local-tts-voice-config.test.js`
  - Adds regression coverage for denoiser safety, generation serialisation and stage timing.

## Local Proof

Server:

```text
http://127.0.0.1:8765
```

Prewarm:

```text
voice_id=TX3LPaxmHKxFdv7VOQHJ
loaded_ms=19125
engine_count=1
reused=false
```

Server log proof:

```text
enable_denoiser: False
generate_begin ... denoiser=False
generate_end elapsed_ms=8811
stretch_begin rate=1.650
stretch_end elapsed_ms=16
```

Smoke output:

```text
D:\pulse-data\media\output\audio\__local_tts_smoke.mp3
D:\pulse-data\media\output\audio\__local_tts_smoke_timestamps.json
```

`ffprobe`:

```text
duration=8.436372
size=135879
```

## Commands Run

```text
node --test tests\services\local-tts-voice-config.test.js
tts_server\venv\Scripts\python.exe -m py_compile tts_server\voxcpm_engine.py tts_server\server.py
Invoke-RestMethod /v1/prewarm
Invoke-RestMethod /v1/text-to-speech/.../with-timestamps
npm run tts:smoke
ffprobe D:\pulse-data\media\output\audio\__local_tts_smoke.mp3
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
