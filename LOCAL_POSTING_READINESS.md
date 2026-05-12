# Local Posting Readiness

Generated: 2026-05-12T23:31:18.804Z
Verdict: AMBER
Status: local_foundation_ready_cutover_blocked
Safety: read-only report; does not edit .env, start primary jobs, post, mutate DB, touch Railway or trigger OAuth

## Strategy
- Railway: standby/optional only, not the active publisher target.
- Hosting target: this PC running Pulse locally through pulse.orryy.com.
- Voice target: local Liam. ElevenLabs is a temporary bridge, not the long-term plan.

## Readiness
- local_health: true
- public_health: false
- tunnel_connected: false
- duplicate_control_keys: AUTO_PUBLISH, USE_JOB_QUEUE
- primary_enabled: false
- queue_enabled: false
- auto_publish_enabled: false
- local_tts_green: true
- local_voice_ready_count: 6

## Blockers
- duplicate local control switches in .env: AUTO_PUBLISH, USE_JOB_QUEUE
- pulse.orryy.com Cloudflare tunnel is not connected to this PC
- public pulse.orryy.com health check is not reaching local Pulse
- local instance is still mirror mode, not primary
- local job queue is disabled
- local AUTO_PUBLISH is disabled

## Warnings
- local TTS has recovered from at least one timeout; keep the supervisor/watchdog enabled
- local cutover plan is still red; use it as the authoritative blocker list before posting

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