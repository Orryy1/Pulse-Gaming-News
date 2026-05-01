# Local Primary / Railway Standby Switchboard

## Target

Run Pulse Gaming from this PC while the channels are pre-monetisation, with Railway kept as a standby cloud host that can be resumed later.

## Current State

- Local primary is running on `http://localhost:3001`.
- Railway is standby.
- Local DB and `/data/tokens` have been copied from Railway.
- Local startup owns scheduling, queue running, Discord bot and publishing.
- Railway startup is observation-only while `PULSE_PRIMARY_INSTANCE=false`.
- Cloudflare tunnel `pulse-gaming-local` is connected from this PC.
- `pulse.orryy.com` is routed to the local primary and the local app now advertises that URL.

## Switch Model

Exactly one instance should be primary:

| Mode | Local `.env` | Railway env | Result |
| --- | --- | --- | --- |
| Current safe mirror | `PULSE_PRIMARY_INSTANCE=false`, `AUTO_PUBLISH=false`, `USE_JOB_QUEUE=false` | `PULSE_PRIMARY_INSTANCE=true` | Railway publishes, local observes |
| Local primary | `PULSE_PRIMARY_INSTANCE=true`, `AUTO_PUBLISH=true`, `USE_JOB_QUEUE=true` | `PULSE_PRIMARY_INSTANCE=false` | Local publishes, Railway is warm standby |
| Railway primary again | `PULSE_PRIMARY_INSTANCE=false` | `PULSE_PRIMARY_INSTANCE=true` | Railway publishes, local observes or can be stopped |

Never set both sides to primary at the same time.

## Required Before Local Primary

1. Stable HTTPS URL for this PC.
   - Hostname: `pulse.orryy.com`
   - Cloudflare Tunnel: `pulse-gaming-local`
   - Tunnel target: `http://localhost:3001`
   - Health check: returns local mode through Cloudflare public routing
   - Note: the home router DNS may briefly cache the earlier NXDOMAIN result. Public DNS already resolves the hostname.

2. Local `.env` public URL.
   - `LOCAL_PUBLIC_URL=https://pulse.orryy.com` is set.
   - `PULSE_TOKEN_DIR=D:/pulse-data/tokens` is set so future Facebook/Instagram re-auth writes tokens to the persistent local data folder.

3. OAuth callback URLs.
   - TikTok app must allow `https://pulse.orryy.com/auth/tiktok/callback`
   - Meta/Facebook app must allow `https://pulse.orryy.com/auth/facebook/callback`
   - Meta/Facebook app domain should include `pulse.orryy.com`
   - Meta/Facebook data deletion URL can use `https://pulse.orryy.com/data-deletion`
   - Status: TikTok and Meta/Facebook dashboard settings have been completed by the operator.

4. Re-auth tokens from the local URL if needed.
   - Visit `https://pulse.orryy.com/auth/facebook`
   - Visit `https://pulse.orryy.com/auth/tiktok`
   - Status: Facebook/Instagram re-auth completed locally on 2026-05-01; token files are in `D:/pulse-data/tokens`.

## Manual Work Likely Needed

Cloudflare and platform developer dashboards may require browser clicks. The safe manual sequence is:

1. In TikTok developer settings, add exactly:
   `https://pulse.orryy.com/auth/tiktok/callback`
2. In Meta/Facebook developer settings, add exactly:
   `https://pulse.orryy.com/auth/facebook/callback`
3. In Meta/Facebook basic settings, set:
   - App domain: `pulse.orryy.com`
   - Privacy Policy URL: `https://pulse.orryy.com/privacy`
   - Terms URL: `https://pulse.orryy.com/terms`
   - User Data Deletion URL: `https://pulse.orryy.com/data-deletion`
4. Tell Codex when those dashboard changes are saved.

## Cutover Order

1. Verify local mirror health.
2. Verify Cloudflare public health returns local mode.
3. Set Railway `PULSE_PRIMARY_INSTANCE=false`.
4. Restart Railway.
5. Set local `.env`:
   - `PULSE_PRIMARY_INSTANCE=true`
   - `AUTO_PUBLISH=true`
   - `USE_JOB_QUEUE=true`
6. Restart local server.
7. Verify:
   - Local health says `primary=true`
   - Railway health says `primary=false`
   - Exactly one scheduler is active
8. Watch one produce/publish window.

Status: cutover completed on 2026-05-01. Local is primary and Railway is standby.

## Rollback

Set local back to mirror:

```powershell
PULSE_PRIMARY_INSTANCE=false
AUTO_PUBLISH=false
USE_JOB_QUEUE=false
```

Set Railway back to primary:

```text
PULSE_PRIMARY_INSTANCE=true
```

Then restart both. Railway resumes as the publishing instance.
