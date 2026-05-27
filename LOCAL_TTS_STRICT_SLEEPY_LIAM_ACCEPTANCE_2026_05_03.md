# Local TTS Strict Sleepy Liam Acceptance — 2026-05-03

## What Changed

Studio V2 and Flash Lane no longer treat `STUDIO_V2_LOCAL_VOICE_APPROVED=true` as enough to approve local TTS.

Local narration must now carry accepted Sleepy Liam reference metadata:

- `id`: `pulse-sleepy-liam-20260502`
- `fileName`: `pulse_liam_sleepy.wav`
- `referencePresent`: `true`
- `referenceHash`: valid SHA-style fingerprint

## Why

The previous approval path could allow stale local VoxCPM/Chatterbox audio to pass if the env flag or `approvedLocalVoice` boolean was set. That was too loose and could let old low/demonic cached narration into Studio V2 proof renders.

## Safety Boundary

- No production DB mutation.
- No OAuth or token changes.
- No Railway env changes.
- No posting.
- No render default switch.
- No Studio V2 production promotion.

## Result

Old local voice files without the accepted Sleepy Liam fingerprint now fail with:

`local_tts_voice_reference_unverified`

Clean local narration can still pass once it is generated through the accepted Sleepy Liam reference path and carries the fingerprint in the timestamp/report metadata.

## Validation

- `node --test tests/services/approved-voice-path.test.js tests/services/studio-v2-proof-render-safety.test.js tests/services/flash-lane-voice-workbench.test.js tests/services/studio-v2-regressions.test.js`
- `npm test`
- `npm run build`
