# Local Primary Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home PC the primary Pulse Gaming runner while keeping Railway as a reversible standby.

**Architecture:** The system keeps two independent runtime profiles and elects exactly one primary via `PULSE_PRIMARY_INSTANCE`. Public URLs come from `lib/deployment-mode.js` so OAuth and platform media fetches follow the active host instead of hard-coded Railway URLs.

**Tech Stack:** Node.js CommonJS, Express, SQLite, Railway CLI, Cloudflare Tunnel, PowerShell.

---

### Task 1: Public URL Switch Safety

**Files:**
- Modify: `lib/deployment-mode.js`
- Modify: `server.js`
- Modify: `upload_tiktok.js`
- Modify: `upload_instagram.js`
- Modify: `upload_facebook.js`
- Modify: `publisher.js`
- Modify: `lib/job-handlers.js`
- Test: `tests/services/deployment-mode.test.js`
- Test: `tests/services/public-url-deployment-switch.test.js`

- [x] **Step 1: Prefer local tunnel URL in local mode**

`getPublicUrl()` must return `LOCAL_PUBLIC_URL` when `DEPLOYMENT_MODE=local`, even if `RAILWAY_PUBLIC_URL` is still present for comparison checks.

- [x] **Step 2: Replace hard-coded Railway callback/media URLs**

OAuth, TikTok auth alerts, Instagram/Facebook URL fallbacks and dashboard links must call `getPublicUrl()`.

- [x] **Step 3: Verify**

Run: `npm test`

Expected: all tests pass.

### Task 2: Operator Switchboard

**Files:**
- Create: `LOCAL_PRIMARY_SWITCHBOARD.md`

- [x] **Step 1: Document the three profiles**

Document current mirror, local primary and Railway primary again.

- [x] **Step 2: Document manual account steps**

List Cloudflare hostname, TikTok callback and Meta/Facebook callback requirements in plain operator language.

### Task 3: Cloudflare Stable Hostname

**Files:**
- Create: `D:/pulse-data/cloudflared-pulse.yml`
- Modify: local `.env`

- [x] **Step 1: Confirm hostname**

Use `pulse.orryy.com` unless the operator chooses a different hostname.

- [x] **Step 2: Create or route the tunnel**

Run:

```powershell
cloudflared tunnel create pulse-gaming-local
cloudflared tunnel route dns pulse-gaming-local pulse.orryy.com
```

Expected: Cloudflare creates a CNAME for `pulse.orryy.com`.

- [x] **Step 3: Point tunnel at the local server**

Update Cloudflare config so the hostname routes to `http://localhost:3001`.

- [x] **Step 4: Verify public health**

Run:

```powershell
Invoke-RestMethod https://pulse.orryy.com/api/health
```

Expected: deployment mode `local`, primary `false` during mirror mode.

Verification note: public DNS resolves through Cloudflare and forced Cloudflare routing returns local health. The home router DNS may briefly cache the earlier NXDOMAIN result.

### Task 4: Watched Cutover

**Files:**
- Modify: local `.env`
- Modify: Railway environment variables in Railway dashboard

- [ ] **Step 1: Put Railway in standby**

Set Railway `PULSE_PRIMARY_INSTANCE=false`, then restart Railway.

- [ ] **Step 2: Put local in primary mode**

Set local `.env`:

```text
PULSE_PRIMARY_INSTANCE=true
AUTO_PUBLISH=true
USE_JOB_QUEUE=true
```

Restart local server.

- [ ] **Step 3: Verify single primary**

Local `/api/health` must report `primary=true`; Railway `/api/health` must report `primary=false`.

- [ ] **Step 4: Watch one publish window**

Run `npm run ops:publish-readiness` before the window. Do not manually trigger publish.

### Task 5: Cost-Saving Railway Pause

**Files:**
- Railway dashboard only

- [ ] **Step 1: Pause Railway after 48-72h of clean local operation**

Use Railway dashboard Pause/Stop. Keep the volume so Railway can be resumed later.

- [ ] **Step 2: Verify local remains primary**

Run local health and readiness checks after Railway is paused.
