# Local Resume Posting Plan

Generated: 2026-06-01T02:55:10.092Z
Verdict: AMBER
Status: local_resume_blocked_but_recoverable
Safety: read-only plan; does not edit .env, start Cloudflare, switch primary, mutate tokens, post, touch Railway or trigger OAuth

## Plain English
- Pulse is not ready to resume local automatic posting yet. The remaining work is local cutover plumbing, not a return to Railway.
- Railway stays standby only. The target is this PC running Pulse locally.
- Local Liam is the target voice. ElevenLabs is only a temporary bridge while local coverage improves.
- Current safe production lane: studio_v2_pilot_candidate.

## Readiness
- can_resume_local_automatic_posting: false
- local_posting_verdict: GREEN
- local_restart_verdict: RED
- local_health: true
- public_health: true
- scheduler_visible_console_risk_count: 1
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
- TikTok: blocked_external; token_ok=false; route=prepared_not_executed; blocks_core_resume=false

## Quality Lane
- ready_flash_proof_count: 1
- local_voice_ready_count: 10
- repair_media_first_count: 9
- repair_voice_first_count: 0

### Closest Studio V2 Candidates
- 1t0zhng: audio_ready=true; exact=24; clips=13; next=run_local_studio_v2_proof
- 1tb5izu: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_6edbb38dc280fc96: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- rss_7945f462187bd7f8: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets
- 1tb2q61: audio_ready=true; exact=0; clips=0; next=acquire_motion_frames_or_exact_subject_assets

## Approved Local Liam Audio Proofs
- rss_ef7e6e464509e0bc: 73.92s; audio=test/output/local-script-extension/audio/rss_ef7e6e464509e0bc_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- 1t0zhng: 71.52s; audio=test/output/local-script-extension/audio/1t0zhng_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- rss_7945f462187bd7f8: 70.56s; audio=test/output/local-media-repair/audio/rss_7945f462187bd7f8_liam.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- 1tcabvy: 69.44s; audio=test/output/local-media-repair/audio/1tcabvy_liam.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- rss_2d69aa8506934c5e: 68.48s; audio=test/output/local-script-extension/audio/rss_2d69aa8506934c5e_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- 1tl8akr: 66.08s; audio=test/output/local-media-repair/audio/1tl8akr_liam.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- rss_1b7c404fc657548f: 66.08s; audio=test/output/local-script-extension/audio/rss_1b7c404fc657548f_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- 1tkik53: 65.6s; audio=test/output/local-script-extension/audio/1tkik53_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- 1tb2q61: 63.36s; audio=test/output/local-media-repair/audio/1tb2q61_liam.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- 1tb5izu: 62.72s; audio=test/output/local-media-repair/audio/1tb5izu_liam.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- rss_6d8aaac7eccad2ff: 62.72s; audio=test/output/local-script-extension/audio/rss_6d8aaac7eccad2ff_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender
- rss_6edbb38dc280fc96: 62.08s; audio=test/output/local-script-extension/audio/rss_6edbb38dc280fc96_liam_extended.mp3; safe_to_publish_now=false; requires clean local MP4 rerender

## Rejected Local Audio Proofs
- 1t186u4: duration_too_short; duration=59.36
- rss_6edbb38dc280fc96: duration_too_short; duration=57.12
- rss_c4cabfc862af7b64: duration_too_short; duration=54.56
- 1tb3i1r: duration_too_short; duration=56.48
- 1t186u4: duration_too_short; duration=60.8
- 1tb3i1r: duration_too_short; duration=57.76
- 1tbdx3b: connection_reset; duration=unknown
- 1t186u4: tts_timeout; duration=unknown

## Blockers
- local restart readiness is red: localhost /api/health is not reachable; public /api/health is not reachable

## Warnings
- Windows scheduled task hygiene risk: 1 visible-console Pulse launcher(s) (Orryy-PulseGaming)
- TikTok is not a blocker for resuming YouTube/Instagram/Facebook, but automated TikTok remains blocked.

## Next Actions
- Keep Railway standby only; do not restore Railway as the active publisher.
- Keep building local Liam; treat ElevenLabs as a temporary bridge only while local voice coverage improves.
- Resume with the safe standard/legacy lane first; do not switch Studio V2 into production until a promotion packet is green.
- Rerender locally with approved local Liam proof MP3s, then QA the MP4 before any DB promotion.
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
- local_media_repair: `npm run ops:local-media-repair -- --dry-run --limit 20`
- local_script_extension: `npm run ops:local-script-extension -- --dry-run --limit 20`
- local_resume_plan: `npm run ops:local-resume-plan`