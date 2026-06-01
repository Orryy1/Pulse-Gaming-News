# Local Posting Readiness

Generated: 2026-06-01T04:52:01.859Z
Verdict: RED
Status: not_ready
Safety: read-only report; does not edit .env, start primary jobs, post, mutate DB, touch Railway or trigger OAuth

## Strategy
- Railway: standby/optional only, not the active publisher target.
- Hosting target: this PC running Pulse locally through pulse.orryy.com.
- Voice target: local Liam. ElevenLabs is a temporary bridge, not the long-term plan.

## Readiness
- local_health: true
- public_health: false
- tunnel_connected: false
- duplicate_control_keys: none
- configured_primary_enabled: true
- configured_queue_enabled: true
- configured_auto_publish_enabled: true
- running_primary_enabled: false
- running_auto_publish_enabled: false
- safe_observation_mode: true
- primary_enabled: false
- queue_enabled: true
- auto_publish_enabled: false
- local_tts_green: false
- local_voice_ready_count: 16

## Blockers
- pulse.orryy.com Cloudflare tunnel is not connected to this PC
- public pulse.orryy.com health check is not reaching local Pulse
- local server is running safe observation mode, not primary posting mode
- running local server reports primary=false
- running local server reports AUTO_PUBLISH=false
- local instance is still mirror mode, not primary
- local AUTO_PUBLISH is disabled
- local Liam TTS readiness is not green

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