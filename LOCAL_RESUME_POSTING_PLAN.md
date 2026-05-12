# Local Resume Posting Plan

Generated: 2026-05-12T22:41:26.204Z
Verdict: AMBER
Status: local_resume_blocked_but_recoverable
Safety: read-only plan; does not edit .env, start Cloudflare, switch primary, mutate tokens, post, touch Railway or trigger OAuth

## Plain English
- Pulse is not ready to resume local automatic posting yet. The remaining work is local cutover plumbing, not a return to Railway.
- Railway stays standby only. The target is this PC running Pulse locally.
- Local Liam is the target voice. ElevenLabs is only a temporary bridge while local coverage improves.
- Current safe production lane: legacy_standard_lane.

## Readiness
- can_resume_local_automatic_posting: false
- local_posting_verdict: AMBER
- local_health: true
- public_health: false
- tunnel_connected: false
- duplicate_control_keys: AUTO_PUBLISH, USE_JOB_QUEUE
- primary_enabled: false
- queue_enabled: false
- auto_publish_enabled: false
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
- repair_voice_first_count: 4

### Closest Studio V2 Candidates
- 1t0zhng: audio_ready=true; exact=12; clips=3; next=acquire_motion_frames_or_exact_subject_assets
- rss_6edbb38dc280fc96: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_6d8aaac7eccad2ff: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_1b7c404fc657548f: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_2d69aa8506934c5e: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets

## Blockers
- duplicate local control switches in .env: AUTO_PUBLISH, USE_JOB_QUEUE
- pulse.orryy.com Cloudflare tunnel is not connected to this PC
- public pulse.orryy.com health check is not reaching local Pulse
- local instance is still mirror mode, not primary
- local job queue is disabled
- local AUTO_PUBLISH is disabled

## Warnings
- TikTok is not a blocker for resuming YouTube/Instagram/Facebook, but automated TikTok remains blocked.
- No Studio V2 Flash proof candidate is ready; resume posting should use the safer legacy/standard lane until media repair catches up.

## Next Actions
- Keep Railway standby only; do not restore Railway as the active publisher.
- Keep building local Liam; treat ElevenLabs as a temporary bridge only while local voice coverage improves.
- Resolve local cutover blockers in order: duplicate .env switches, Cloudflare tunnel, public health, primary flag, queue flag, AUTO_PUBLISH flag.
- Resume with the safe standard/legacy lane first; do not switch Studio V2 into production until a promotion packet is green.
- Use TikTok dispatch/inbox tooling only after token refresh/sync and creative-review blocker are resolved; do not rely on Railway.
- Keep Facebook Reels enabled behind verifier checks because manual Page UI proof succeeded.

## Morning Approval Queue
- local_primary_cutover: wait_until_local_resume_plan_is_green
- temporary_elevenlabs_bridge: allow_temporarily_but_keep_local_liam_as_target
- tiktok_route_recovery: prepare_tooling_now_operator_test_later

## Commands
- local_posting_readiness: `npm run ops:local-posting-readiness`
- local_cutover_plan: `npm run ops:local-cutover-plan`
- platform_doctor: `npm run ops:platform-doctor`
- social_platforms: `npm run ops:social-platforms`
- proof_candidates: `npm run studio:v2:proof-candidates -- --limit 10`
- local_tts_report: `npm run tts:overnight-report`