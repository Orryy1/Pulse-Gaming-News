# Local Resume Posting Plan

Generated: 2026-05-13T08:55:07.662Z
Verdict: GREEN
Status: ready_to_resume_local_automatic_posting
Safety: read-only plan; does not edit .env, start Cloudflare, switch primary, mutate tokens, post, touch Railway or trigger OAuth

## Plain English
- Pulse can resume local automatic posting once the operator intentionally starts the local primary path. Railway stays standby only.
- Railway stays standby only. The target is this PC running Pulse locally.
- Local Liam is the target voice. ElevenLabs is only a temporary bridge while local coverage improves.
- Current safe production lane: legacy_standard_lane.

## Readiness
- can_resume_local_automatic_posting: true
- local_posting_verdict: GREEN
- local_health: true
- public_health: true
- tunnel_connected: true
- duplicate_control_keys: none
- primary_enabled: true
- queue_enabled: true
- auto_publish_enabled: true
- local_tts_green: true
- local_voice_ready_count: 6
- core_platform_ready: true

## Platforms
- YouTube: working
- Instagram Reel: working
- Facebook Reel: working
- TikTok: blocked_external; token_ok=false; route=creative_review_required_before_inbox; blocks_core_resume=false

## Quality Lane
- ready_flash_proof_count: 0
- local_voice_ready_count: 6
- repair_media_first_count: 6
- repair_voice_first_count: 13

### Closest Studio V2 Candidates
- 1t0zhng: audio_ready=true; exact=24; clips=4; next=acquire_motion_frames_or_exact_subject_assets
- rss_2d69aa8506934c5e: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_ef7e6e464509e0bc: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_6edbb38dc280fc96: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_6d8aaac7eccad2ff: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets

## Warnings
- TikTok is not a blocker for resuming YouTube/Instagram/Facebook, but automated TikTok remains blocked.
- No Studio V2 Flash proof candidate is ready; resume posting should use the safer legacy/standard lane until media repair catches up.

## Next Actions
- Keep Railway standby only; do not restore Railway as the active publisher.
- Keep building local Liam; treat ElevenLabs as a temporary bridge only while local voice coverage improves.
- Resume with the safe standard/legacy lane first; do not switch Studio V2 into production until a promotion packet is green.
- Use TikTok dispatch/inbox tooling only after token refresh/sync and creative-review blocker are resolved; do not rely on Railway.
- Keep Facebook Reels enabled behind verifier checks because manual Page UI proof succeeded.

## Morning Approval Queue
- local_primary_cutover: approve_when_ready
- temporary_elevenlabs_bridge: allow_temporarily_but_keep_local_liam_as_target
- tiktok_route_recovery: prepare_tooling_now_operator_test_later

## Commands
- local_posting_readiness: `npm run ops:local-posting-readiness`
- local_cutover_plan: `npm run ops:local-cutover-plan`
- platform_doctor: `npm run ops:platform-doctor`
- social_platforms: `npm run ops:social-platforms`
- proof_candidates: `npm run studio:v2:proof-candidates -- --limit 10`
- local_tts_report: `npm run tts:overnight-report`