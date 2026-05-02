# Short Runtime Contract Fix - 2026-05-02

## Root cause

Today's Discord failure was not a video-QA false positive.

The failed publish candidates had cleaned TTS scripts around 159-178 words and measured audio durations of 109-123 seconds:

- `rss_a8e7d56725bf20cc` - 166 TTS words, 112.43s
- `rss_c3c6731708e35fc0` - 166 TTS words, 109.16s
- `rss_bfb13e642d536b03` - 178 TTS words, 122.83s

The old Pulse prompt and processor validation still asked for 160-180 words while claiming that would produce 63-75 seconds. With the current Pulse voice, that is wrong. Live output is closer to 0.68 seconds per cleaned spoken word, so a Flash Lane script needs roughly 90-110 spoken words.

## What changed

- Added `lib/services/short-runtime-planner.js`.
- Calibrated Pulse Flash Lane to 61-75 seconds and 90-110 spoken words.
- Added a review band up to 90 seconds and a hard block above 90 seconds.
- Updated Pulse script validation to count actual cleaned spoken words instead of trusting the model's `word_count`.
- Updated Pulse generation retry prompts away from 160-180 words.
- Added an audio-stage gate before TTS generation, so overlong scripts stop before spending voice/render time.
- Added a post-TTS hard block if measured generated audio still exceeds 75 seconds.
- Updated the Pulse channel prompt and fallback system prompt to the new runtime target.

## Safety boundaries

- No Railway env vars changed.
- No OAuth or tokens touched.
- No production DB mutation was performed by this fix.
- No manual publish or produce was run.
- No render default was changed.
- This is a normal production safety gate for the existing legacy path, not a Studio V2 promotion.

## Validation

- `npm test` passed: 1793/1793.
- `npm run build` passed.
- `npm run ops:publish-readiness` passed read-only with AMBER status. The remaining amber item is historical/recent QA failures from already produced overlong videos, plus known TikTok/Facebook external blockers.

## Deploy note

The live system will keep using the old 160-180 word generation target until this branch is deployed or merged into the deployed branch. The already failed stories are now `qa_failed=true` locally and should not be retried unless regenerated.
