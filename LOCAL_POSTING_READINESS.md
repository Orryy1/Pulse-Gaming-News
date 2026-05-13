# Local Posting Readiness

Generated: 2026-05-13T08:55:07.657Z
Verdict: GREEN
Status: ready_to_resume_local_posting
Safety: read-only report; does not edit .env, start primary jobs, post, mutate DB, touch Railway or trigger OAuth

## Strategy
- Railway: standby/optional only, not the active publisher target.
- Hosting target: this PC running Pulse locally through pulse.orryy.com.
- Voice target: local Liam. ElevenLabs is a temporary bridge, not the long-term plan.

## Readiness
- local_health: true
- public_health: true
- tunnel_connected: true
- duplicate_control_keys: none
- primary_enabled: true
- queue_enabled: true
- auto_publish_enabled: true
- local_tts_green: true
- local_voice_ready_count: 6

## Warnings
- local TTS has recovered from at least one timeout; keep the supervisor/watchdog enabled

## Next Steps
- Keep Railway as standby only; do not restore it as the active publisher for cost reasons.
- Keep ElevenLabs as a temporary live bridge only while local Liam TTS is hardened.
- Clean duplicate .env control switches so AUTO_PUBLISH and USE_JOB_QUEUE appear once.
- Run the local server in mirror mode and keep /api/health green before any cutover.
- Start the pulse.orryy.com Cloudflare tunnel from this PC when ready.
- Only after the readiness report is green, intentionally flip local primary, queue and auto-publish flags.

## Commands
- local_cutover_plan: `npm run ops:local-cutover-plan`
- local_primary_readiness: `npm run ops:local-primary-readiness`
- local_tts_report: `npm run tts:overnight-report`
- cloudflare_tunnel: `cloudflared tunnel --config D:/pulse-data/cloudflared-pulse.yml run pulse-gaming-local`