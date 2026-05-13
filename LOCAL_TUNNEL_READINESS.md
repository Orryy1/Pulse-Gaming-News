# Local Tunnel Readiness

Generated: 2026-05-13T00:04:31.887Z
Verdict: GREEN
Safety: read-only; does not start Cloudflare, change DNS, edit env vars, start jobs, post or mutate tokens

## Cloudflared
- binary: C:\Program Files (x86)\cloudflared\cloudflared.exe
- version: 2025.8.1

## Tunnel Config
- config: D:/pulse-data/cloudflared-pulse.yml
- tunnel: 8c94c81a-8bdc-483d-a2a9-3326a79059c3
- credentials file present: true
- expected route: pulse.orryy.com -> http://localhost:3001
- actual route: http://localhost:3001

## Connection And Health
- tunnel status: active
- local health: pass
- public health: pass

## Controlled Start Command
- cloudflared tunnel --config D:/pulse-data/cloudflared-pulse.yml run pulse-gaming-local

## Next Steps
- Do not flip local primary, queue or AUTO_PUBLISH from this report.
- Start the existing tunnel only in a controlled cutover window: cloudflared tunnel --config D:/pulse-data/cloudflared-pulse.yml run pulse-gaming-local
- After starting the tunnel, verify https://pulse.orryy.com/api/health reports mode=local and primary=false.
- Only after public health is green should local primary readiness be re-run.
