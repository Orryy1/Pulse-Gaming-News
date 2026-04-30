# Local Migration — Phase 0 Readiness Status

**Date:** 2026-04-30 evening
**Host:** Martin's Windows PC (`C:\Users\MORR\gaming-studio\pulse-gaming`)
**Mission scope:** Phase 0 only. Read-only diagnostics + safe local-binary checks. NO Railway changes, NO OAuth, NO cutover, NO primary flag flips.
**Result:** 🟡 **AMBER** — one env-fill away from ready. PC is materially closer to ready than the runbook anticipated.

---

## Headline

**The home PC option is ~95% ready.** The only true blocker is one missing env-var value (`ANTHROPIC_API_KEY` — exists as a key in `.env` but the value is empty). Every binary is installed. Cloudflare Tunnel is already authenticated and tunnelled. The domain `orryy.com` is in your control. Phase 1 (mirror mode) becomes practical the moment that one variable is filled in.

**Oracle Cloud Always-Free is still a valid alternative**, but given how much is already on this PC, Option A (home PC) is now the lower-friction choice unless the PC truly cannot stay on overnight.

---

## Local doctor result

`node tools/local-mode-doctor.js` (with `.env` loaded via `node -r dotenv/config`):

### Binaries — all green ✓

| Binary      | Version                                   |
| ----------- | ----------------------------------------- |
| Node        | v24.14.0                                  |
| npm         | 11.9.0                                    |
| ffmpeg      | 2025-09-04 (Gyan full build)              |
| ffprobe     | 2025-09-04 (Gyan full build)              |
| yt-dlp      | 2026.03.17                                |
| cloudflared | 2025.8.1 _(advisory: 2026.3.0 available)_ |

No installs required.

### Filesystem — green ✓

- `MEDIA_ROOT` candidate path is writable
- DB dir candidate path is writable

### Env vars present in `.env`

✓ `ELEVENLABS_API_KEY` (51 chars)
✓ `DISCORD_WEBHOOK_URL` (121 chars)
✓ `AMAZON_AFFILIATE_TAG` (8 chars)
✓ `RAILWAY_PUBLIC_URL` (21 chars)
✓ `USE_SQLITE` (4 chars)
✓ `YOUTUBE_API_KEY` (39 chars)
✓ `INSTAGRAM_ACCESS_TOKEN` (197 chars)
✓ `INSTAGRAM_BUSINESS_ACCOUNT_ID` (17 chars)
✓ `FACEBOOK_PAGE_TOKEN` (197 chars)
✓ `FACEBOOK_PAGE_ID` (16 chars)
✓ `TIKTOK_CLIENT_KEY` (16 chars)
✓ `TWITCH_CLIENT_ID` (30 chars)
✓ `TWITCH_CLIENT_SECRET` (30 chars)
✓ `PEXELS_API_KEY` (56 chars)
✓ `AUTO_PUBLISH` (4 chars)
✓ `API_TOKEN` (25 chars)

(Lengths reported, **values never printed** — secrets stay in `.env`.)

### Env vars MISSING (RED blocker)

🔴 **`ANTHROPIC_API_KEY` — key exists in `.env` but value is empty.**
Production Railway has it set (otherwise script generation wouldn't work today). It just hasn't been copied to the local `.env` file.

### Env vars MISSING (Phase 1+ only — not blockers for Phase 0)

- `PULSE_PUBLIC_URL` / `LOCAL_PUBLIC_URL` — needed when actually starting in local mode (Phase 1). Cloudflare Tunnel can supply this.
- `MEDIA_ROOT` / `SQLITE_DB_PATH` — needed at cutover, points to local Windows paths.
- `DEPLOYMENT_MODE` / `PULSE_PRIMARY_INSTANCE` — set explicitly only when you want this PC to act as a mirror (Phase 1) or primary (Phase 2).

These are intentionally absent now; they get set when Phase 1 actually begins.

---

## Cloudflare Tunnel — already configured ✓

**Big positive surprise.** You already have:

- `cloudflared` binary installed (v2025.8.1)
- `~/.cloudflared/cert.pem` — authenticated to your Cloudflare account
- `~/.cloudflared/config.yml` — ingress already pointing at `localhost:3001`
- A live tunnel `orryy-live` (UUID `eb816f8f-…`) with 4 active connections to Frankfurt edge
- A second tunnel UUID referenced in `config.yml` (`334951fa-…`) — see "Reconciliation" below

The DNS for `https://orryy.com` resolves and returns HTTP 200 — but currently to a **different** site (a separate Cloudflare Pages / static page, not Pulse Gaming). So a small reconciliation is needed before flipping `orryy.com` at the local Pulse instance, OR the simpler path: pick a subdomain like `pulse.orryy.com` for Pulse and leave `orryy.com` as-is.

**This is Phase 1 work. Phase 0 only confirms the infrastructure exists.**

---

## What's missing — exact next safe step

### Step 1 (the only true blocker): fill in `ANTHROPIC_API_KEY` locally

Open the Railway dashboard:

1. https://railway.app → your project → marvelous-curiosity service → **Variables** tab.
2. Find `ANTHROPIC_API_KEY`. Click the row to reveal the value, copy it.
3. Open `C:\Users\MORR\gaming-studio\pulse-gaming\.env` in any editor.
4. Find the line `ANTHROPIC_API_KEY=` and paste the value after `=` (no quotes, no spaces).
5. Save.

**I cannot do this for you.** The safety rules forbid me from reading secrets out of Railway and writing them into local files. This is an explicit human step.

### Step 2 (optional, advisory): bump cloudflared

```powershell
winget upgrade Cloudflare.cloudflared
```

Not blocking. The 2025.8.1 → 2026.3.0 jump is a maintenance bump.

### Step 3 (NOT YET): wait for Phase 1

Once Step 1 is done, `npm run ops:local-doctor` should go to **GREEN**. At that point you're ready to enter Phase 1 (mirror mode) per the runbook. **Do NOT enter Phase 1 in this session** — the mission brief explicitly forbids starting any local instance.

---

## Verification (after Step 1)

Run the doctor again:

```powershell
cd C:\Users\MORR\gaming-studio\pulse-gaming
node -r dotenv/config tools/local-mode-doctor.js
```

Expected: 🟢 GREEN, with the only advisory being "cloudflared binary slightly outdated" (which doesn't block anything).

---

## Is the home PC ready for mirror mode?

After Step 1: **yes.**

Specifically:

- All binaries → ready
- Cloudflare Tunnel infrastructure → ready (one config reconciliation when you choose a hostname)
- Filesystem → ready
- Platform tokens → already in `.env`, ready to be reused locally
- Code path (`lib/deployment-mode.js`, `tools/local-mode-doctor.js`) → shipped to `main`
- Tests → 1396/1396 pass

The PC has more pre-existing infrastructure than the runbook anticipated. The ~60-minute Phase 0 estimate in the runbook collapses to ~5 minutes for you — copy one env value, run the doctor again, done.

---

## Is Oracle Cloud Always-Free still recommended?

**Recommended only if you don't want this PC running 24/7.**

Tradeoffs:

| Factor                 | Home PC                                 | Oracle Always-Free                     |
| ---------------------- | --------------------------------------- | -------------------------------------- |
| Setup effort from here | 5 min                                   | ~90 min (signup + provision + install) |
| Marginal cost          | £0 if PC is on anyway, ~£5–10/mo if not | £0/mo forever                          |
| Reliability            | Tied to your home power + internet      | 99.9%+ datacenter                      |
| Bandwidth cost         | None (your home connection)             | None (10 TB/mo free)                   |
| Maintenance            | OS patches when you remember            | OS patches you SSH in for              |
| Resources              | Whatever your PC has                    | 4 vCPU + 24 GB RAM ARM (fixed)         |

**My recommendation:** start with home PC (5-min finish from here). If reliability becomes a concern (frequent power cuts, internet outages, plans to be away), migrate to Oracle later — same code, same flags, same runbook procedure.

---

## What I did NOT do (per safety rules)

- ❌ Did not modify `.env` (would have meant copying ANTHROPIC_API_KEY)
- ❌ Did not change Railway env vars
- ❌ Did not change OAuth callback URLs
- ❌ Did not stop the Railway service
- ❌ Did not start any local Pulse instance
- ❌ Did not flip `PULSE_PRIMARY_INSTANCE` anywhere
- ❌ Did not trigger any publish/produce manually
- ❌ Did not mutate the production DB
- ❌ Did not modify the Cloudflare Tunnel config
- ❌ Did not run `cloudflared tunnel run`

Everything done in this session was read-only inspection.

---

## Summary table

| Checkpoint                      | State                                             |
| ------------------------------- | ------------------------------------------------- |
| Node + npm                      | ✅                                                |
| ffmpeg + ffprobe                | ✅                                                |
| yt-dlp                          | ✅                                                |
| cloudflared binary              | ✅ (slight version bump available)                |
| Cloudflare Tunnel authenticated | ✅                                                |
| `.env` exists                   | ✅                                                |
| `ANTHROPIC_API_KEY`             | 🔴 empty value — **only blocker**                 |
| All other platform tokens       | ✅                                                |
| Filesystem writability          | ✅                                                |
| Code path for switch            | ✅ shipped (`9a421cd`)                            |
| **Phase 0 readiness**           | 🟡 **AMBER — one env-fill away from GREEN**       |
| **Operator next safe step**     | Fill `ANTHROPIC_API_KEY` in `.env`, re-run doctor |

---

## Once you're back at the keyboard

1. Copy `ANTHROPIC_API_KEY` from Railway → paste into local `.env`.
2. Run `node -r dotenv/config tools/local-mode-doctor.js` — confirm GREEN.
3. Tell me — I'll then walk you through Phase 1 (mirror mode) **with your hand on the keyboard** for the OAuth-touching steps.

I won't start Phase 1 until you confirm Step 1 is done and you've decided between PC and Oracle.
