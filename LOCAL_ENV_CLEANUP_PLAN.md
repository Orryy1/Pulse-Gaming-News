# Local Env Cleanup Plan

Generated: 2026-05-13T07:38:26.425Z
Verdict: GREEN
Safety: read-only; does not edit .env, print secrets, start jobs, post, mutate tokens, touch Railway or change Cloudflare

## Effective Control Values
- AUTO_PUBLISH: false
- DEPLOYMENT_MODE: local
- LOCAL_PUBLIC_URL: https://pulse.orryy.com
- MEDIA_ROOT: D:/pulse-data/media
- PORT: 3001
- PULSE_PRIMARY_INSTANCE: false
- PULSE_TOKEN_DIR: D:/pulse-data/tokens
- SQLITE_DB_PATH: D:/pulse-data/pulse.db
- USE_JOB_QUEUE: false
- USE_SQLITE: true

## Duplicate Actions
- RAILWAY_PUBLIC_URL: keep line 63; stale line(s) 10; action=manual_review; effective=(set, len 53)

## Next Steps
- Do not edit secret values from this report; values are intentionally redacted.
- For duplicate local control switches, keep only the final effective line and comment/remove older duplicate lines.
- Keep local mirror-safe values until public health and Cloudflare tunnel checks are green.
- Only after local posting readiness is green should primary, queue and auto-publish be flipped in a controlled cutover.
