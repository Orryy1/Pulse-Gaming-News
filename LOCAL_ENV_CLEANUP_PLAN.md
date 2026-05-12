# Local Env Cleanup Plan

Generated: 2026-05-12T23:48:49.617Z
Verdict: RED
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
- AUTO_PUBLISH: keep line 57; stale line(s) 16; action=comment_or_remove_stale_occurrences; effective=false
  mirror safe: yes; expected while mirrored=false
- RAILWAY_PUBLIC_URL: keep line 65; stale line(s) 10; action=manual_review; effective=(set, len 53)
- USE_JOB_QUEUE: keep line 58; stale line(s) 50; action=comment_or_remove_stale_occurrences; effective=false
  mirror safe: yes; expected while mirrored=false

## Blockers
- duplicate local control switches: AUTO_PUBLISH, USE_JOB_QUEUE

## Next Steps
- Do not edit secret values from this report; values are intentionally redacted.
- For duplicate local control switches, keep only the final effective line and comment/remove older duplicate lines.
- Keep local mirror-safe values until public health and Cloudflare tunnel checks are green.
- Only after local posting readiness is green should primary, queue and auto-publish be flipped in a controlled cutover.
