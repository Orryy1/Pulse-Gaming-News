# Approved Voice Path v1

## What Was Built

Added a local proof-safety gate for narration paths.

It now verifies:

- an audio path is present
- the audio file exists
- the audio file is not empty
- silent fixture audio is blocked unless explicitly diagnostic
- unapproved local TTS is blocked
- low-pitch/demonic voice risk is blocked when acoustic evidence is available
- the spoken outro is present when transcript evidence is supplied

## Why It Matters

The latest enriched proof rendered with no narration in at least one playback path, and earlier proofs regressed into the low/demonic local voice. Studio V2 proof renders now have a stricter voice-path gate before they can be treated as pilot-quality.

## Command

```bash
npm run studio:v2:approved-voice -- --fixture
```

Alias:

```bash
npm run ops:approved-voice -- --fixture
```

Outputs:

- `test/output/approved_voice_path_v1.json`
- `test/output/approved_voice_path_v1.md`

## Safety Boundaries

- no TTS generation
- no video render
- no posting
- no Railway changes
- no OAuth or token changes
- no production DB changes
- no production voice switch

## Proof Safety Integration

`lib/studio/v2/proof-render-safety.js` now uses the approved voice-path gate. A Studio V2 proof can no longer silently pass with a missing narration path or missing narration file.
