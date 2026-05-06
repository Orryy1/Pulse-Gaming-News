# Local TTS Overnight Report

Generated: 2026-05-06 20:36 BST

## Verdict

- Status: `AMBER`
- Local Liam voice quality path: usable for local proof renders.
- Reliability: improved, but not yet production-safe.
- Production voice: unchanged. Do not switch production voice without morning approval.

## What Changed

- Added explicit local TTS failure classification:
  - `server_down`
  - `health_timeout`
  - `voice_not_loaded`
  - `tts_timeout`
  - `connection_reset`
  - `duration_too_short`
  - `duration_too_long`
  - `missing_timestamps`
  - `unsafe_voice`
- Local audio apply paths now keep batch processing after a failed story.
- Per-story skipped rows now record `failure_code` and whether a server reset was recorded.
- Local proof rows now record duration/timestamp/voice proof failures without hiding successful MP3s.
- The local TTS doctor JSON now includes its own report paths.

## Local Server

- Doctor report: `test/output/local_tts_doctor.md`
- Latest doctor verdict: `green`
- Voice alias: `liam`
- Accepted local voice reference: `pulse-sleepy-liam-20260502`
- Server action taken: local restart + prewarm only
- Server PID from latest doctor: `52924`
- Safety: local-only on `127.0.0.1`; no Railway, OAuth, token, production DB or posting changes.

## Smoke Proof

- MP3: `D:/pulse-data/media/output/audio/__local_tts_smoke_sleepy_liam_latest.mp3`
- Timestamps: `D:/pulse-data/media/output/audio/__local_tts_smoke_sleepy_liam_latest_timestamps.json`
- Smoke line includes both `Pokemon` and `Pokemon` with the accent-preserving timestamp text path.

## Proof Batch

Command used:

```text
npm run ops:local-media-repair -- --apply-local-audio --apply-limit 4
```

Output report:

- JSON: `test/output/local_media_repair_audio_apply.json`
- Markdown: `test/output/local_media_repair_audio_apply.md`

Successful proof MP3s:

- `rss_7945f462187bd7f8`: `68.00s`, pass, `D:/pulse-data/media/test/output/local-media-repair/audio/rss_7945f462187bd7f8_liam.mp3`
- `rss_a23224b1ea49574e`: `65.92s`, pass, `D:/pulse-data/media/test/output/local-media-repair/audio/rss_a23224b1ea49574e_liam.mp3`
- `rss_8ea7f2689732f31a`: `67.68s`, pass, `D:/pulse-data/media/test/output/local-media-repair/audio/rss_8ea7f2689732f31a_liam.mp3`

Skipped:

- `rss_60b58c29a07be301`: `server_down`, `connect ECONNREFUSED 127.0.0.1:8765`; server reset recorded.

## Queue

- Total approved/local repair candidates checked: `86`
- Ready for local audio proof: `4`
- Runtime blocked before TTS spend: `80`
- TTS blocked at planning time: `0`
- No action: `0`

## Safety Boundaries

- No production DB rows were changed.
- No OAuth or tokens were changed.
- No Railway variables were changed.
- No social posting occurred.
- No production voice switch occurred.
- No production renderer switch occurred.

## Next

- Keep local Liam as a local proof voice only.
- Use the three passed MP3s as candidates for Studio V2 proof packaging.
- Investigate why the local server dropped during the fourth proof before calling it production-reliable.
- Continue using ElevenLabs for production until a morning approval packet explicitly promotes local Liam.
