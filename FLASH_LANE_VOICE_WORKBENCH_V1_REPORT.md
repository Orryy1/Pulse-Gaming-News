# Flash Lane Voice Workbench v1

Generated: 2026-05-02

## What Was Built

Flash Lane now has a local-only voice workbench for Shorts narration candidates.

Command:

```bash
npm run studio:v2:voice-workbench
```

Useful modes:

```bash
npm run studio:v2:voice-workbench -- --fixture
npm run studio:v2:voice-workbench -- --fixture --generate-local --apply-local --engine voxcpm2 --rate 1.9 --pitch-factor 2.1 --out-dir test/output/flash-lane-voice-workbench-pitch210
npm run studio:v2:voice-workbench -- --story rss_5b3abe925b27a199 --audio D:\pulse-data\media\output\audio\rss_5b3abe925b27a199.mp3 --timestamps D:\pulse-data\media\output\audio\rss_5b3abe925b27a199_timestamps.json --provider local --source local-production-voxcpm-path
```

The workbench checks:

- 61-75s Flash Lane runtime.
- Actual transcript WPM when timestamps/transcript are available.
- Demonic/low voice risk with local pitch probing.
- Loudness and true peak using FFmpeg ebur128.
- Spoken outro presence: `Follow Pulse Gaming so you never miss a beat.`
- Local voice human approval status.
- Local-only generation safety.

## Safety Boundaries

- Local-only.
- Writes only under `test/output`.
- No Railway changes.
- No OAuth.
- No production DB mutation.
- No social posting.
- No production voice switch.
- No production renderer switch.

## Local TTS Status

The local TTS server was cold but reachable after restart.

Prewarm succeeded:

- Voice: `TX3LPaxmHKxFdv7VOQHJ`
- Engine count: `1`
- Load time: about `41s`

The helper script `scripts/prewarm-infer.ps1` currently has a PowerShell parser error, so the successful proof used the local API prewarm endpoint directly.

## Bad Cached Voice Result

Known-bad cached GTA/Take-Two audio was tested:

- Audio: `D:\pulse-data\media\output\audio\rss_5b3abe925b27a199.mp3`
- Verdict: rejected
- Duration: `118.03s`
- Main blockers: too long, too slow, clipping/voice risk depending probe path

This prevents the demonic low cached voice from being treated as acceptable.

## Local Candidate Results

Raw/local VoxCPM2 was initially usable but not acceptable:

- 67-72s depending run
- Too quiet before normalisation
- Low-pitch/demonic risk before pitch correction
- Spoken outro is now appended automatically for local TTS generation

Best local candidate so far:

- Report: `test/output/flash-lane-voice-workbench-pitch210/flash_lane_voice_workbench_fixture_flash_lane_story.json`
- Markdown: `test/output/flash-lane-voice-workbench-pitch210/flash_lane_voice_workbench_fixture_flash_lane_story.md`
- Audio: `test/output/flash-lane-voice-workbench-pitch210/flash-lane-voice-workbench-assets/fixture_flash_lane_story_voxcpm2_1_9.mp3`
- Raw audio: `test/output/flash-lane-voice-workbench-pitch210/flash-lane-voice-workbench-assets/fixture_flash_lane_story_voxcpm2_1_9_raw.mp3`
- Runtime: `66.86s`
- Pace: `144.5 WPM`
- Median pitch: `92.05 Hz`
- Loudness: `-16.9 LUFS`
- True peak: `-1.7 dB`
- Spoken outro: present
- Blockers: none
- Remaining warning: local voice requires human approval

Local post-processing used:

```text
rubberband=pitch=2.100,loudnorm=I=-16:TP=-1.5:LRA=11
```

## Verdict

Local TTS is now operational and can produce a technically valid Flash Lane candidate.

It is not approved for live production because the final voice quality still needs human listening approval. That is intentional: a local model should not replace ElevenLabs silently just because metrics pass.

## Validation

- Focused Flash Lane suite: 30/30 pass.
- Full `npm test`: 1,693/1,693 pass.
- `npm run build`: pass.

## Next Step

The next build should be Flash Lane Visual Director v1:

- reject rating cards, black slates and publisher logos from trailer starts;
- score trailer frames for blur, text dominance and subject visibility;
- prefer action/gameplay segments over cover art;
- make captions TikTok-native and punchier;
- require clip-backed scene beats before another Studio V2 proof render.
