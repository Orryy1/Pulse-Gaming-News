# Pulse Gaming — Off-Railway Deployment Runbook

**Goal:** stop paying ~£60/month for Railway while Pulse Gaming is unmonetised. Two equally-supported targets:

- **Option A — Home PC** (your existing dev machine). Free if it's already on overnight; ~£5–10/mo if it isn't.
- **Option B — Oracle Cloud Always-Free** ARM VM. Genuinely £0/mo forever. **Recommended if you don't want your PC running 24/7.**

Both use the same code, the same env vars, and the same `LOCAL_DEPLOYMENT_RUNBOOK.md` flow — only the host differs.

Keep Railway code paths intact so you can switch back when revenue justifies the cost.

**Risk:** medium. The migration touches OAuth callback URLs, env vars, and scheduler ownership. Reversible at every step.

**Time:** ~60 minutes for a clean cutover (PC option). ~90 minutes for Oracle (extra signup + provisioning).

---

## Why NOT other options (rejected after analysis)

- **Claude Agents / Routines:** stateless per-fire, no persistent SQLite, no inbound webhooks for OAuth, ~960 fires/month would blow through Pro quota. Scheduler-by-cron-job model doesn't work for a stateful pipeline. Use case mismatch.
- **GitHub Actions cron:** same statelessness problem as Claude Agents — fresh checkout per run, no DB persistence.
- **Fly.io / Render free tiers:** containers sleep on inactivity; node-cron stops firing during sleep.
- **Cloudflare Workers:** no ffmpeg runtime, no large file storage.

---

## Architecture overview

Pulse Gaming is platform-agnostic Node.js with three external dependencies:

- **HTTPS public URL** — needed for OAuth callbacks (FB/IG/YouTube) and IG/FB media-fetch URLs
- **Persistent storage** — SQLite DB + downloaded media + tokens
- **Always-on process** — scheduler fires hunt/produce/publish jobs throughout the day

Railway provides all three packaged. On a home PC:

- HTTPS public URL → **Cloudflare Tunnel** (free, no port forwarding, stable URL)
- Persistent storage → **local folder** (e.g. `D:\pulse-data`)
- Always-on → your dev PC running 24/7

The `lib/deployment-mode.js` module (shipped today) is the single switch. Set `DEPLOYMENT_MODE=local` and the rest of the code adapts.

---

## Phase 0 — Pre-cutover checklist (do this WHILE Railway is still running)

### 0.1 Run the doctor

```bash
cd C:\Users\MORR\gaming-studio\pulse-gaming
node tools/local-mode-doctor.js
```

Expected output: GREEN or AMBER. Resolve every RED blocker before continuing. Common ones:

- `ffmpeg / ffprobe binary not found on PATH` — install via https://www.gyan.dev/ffmpeg/builds/ or `winget install Gyan.FFmpeg`
- `node binary not found` — already installed since Claude Code uses it
- `MEDIA_ROOT not writable` — pick a folder you control, e.g. `D:\pulse-data\media`

### 0.2 Decide the local data location

Pick a path with enough disk for:

- SQLite DB (small, ~50 MB)
- Downloaded media cache (`output/image_cache`, `output/video_cache`) — can grow to ~5 GB over months
- Generated MP4s (`output/final`) — ~10 MB per video, ~30 videos/month

Recommended: `D:\pulse-data` (or wherever you have spare disk).

### 0.3 Set up Cloudflare Tunnel (free)

This gives you a stable HTTPS URL pointing at your home PC without opening firewall ports.

1. Install: `winget install Cloudflare.cloudflared`
2. Authenticate: `cloudflared tunnel login` (opens browser, approves with your Cloudflare account — sign up free if you don't have one, no card required)
3. Create the tunnel: `cloudflared tunnel create pulse-gaming-local`
4. Pick a hostname. You can use a random Cloudflare-provided subdomain OR your own domain. Cheapest: a free `*.trycloudflare.com` URL (test purposes) or use any domain you already own.
5. Configure the tunnel to forward to localhost:3001:
   ```yaml
   # ~/.cloudflared/config.yml
   tunnel: pulse-gaming-local
   credentials-file: C:\Users\MORR\.cloudflared\<tunnel-id>.json
   ingress:
     - hostname: pulse.your-domain.com
       service: http://localhost:3001
     - service: http_status:404
   ```
6. Start the tunnel: `cloudflared tunnel run pulse-gaming-local`
7. Test: `curl https://pulse.your-domain.com/api/health` — should return your local server's health

Keep this tunnel running while testing local mode in parallel with Railway. Don't change Railway until Phase 3.

### 0.4 Copy the Railway env vars to a local `.env`

**Do NOT edit `.env` while Railway is reading the same values — it doesn't, since Railway uses its own dashboard env vars, but be tidy.**

Create `.env` in the repo root with all the same secrets currently set on Railway, plus the new local-mode flags:

```
# Existing secrets (copy from Railway dashboard, don't print to chat)
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=TX3LPaxmHKxFdv7VOQHJ
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
AMAZON_AFFILIATE_TAG=pulsegaming-21
INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_BUSINESS_ACCOUNT_ID=...
FACEBOOK_PAGE_TOKEN=...
FACEBOOK_PAGE_ID=...
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
YOUTUBE_API_KEY=...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
PEXELS_API_KEY=...
API_TOKEN=<same 64-char token as Railway>
INTELLIGENCE_REAL_MODE=true

# Channel + content config
CHANNEL=pulse-gaming
AUTO_PUBLISH=true
INCLUDE_RUMOURS=true
STAGGER_UPLOADS=true

# Phase 1 LOCAL flags — leave commented while testing in parallel
# DEPLOYMENT_MODE=local
# PULSE_PRIMARY_INSTANCE=false
# PULSE_PUBLIC_URL=https://pulse.your-domain.com

# Persistence (local)
USE_SQLITE=true
USE_JOB_QUEUE=true
MEDIA_ROOT=D:/pulse-data/media
SQLITE_DB_PATH=D:/pulse-data/pulse.db

# Server
PORT=3001
NODE_ENV=production

# Tonight's overnight workshop + live analyst (env-gated)
OVERNIGHT_WORKSHOP_ENABLED=true
LIVE_ANALYST_ENABLED=true
```

`.env` is in `.gitignore`, never commits. Verify: `git status` should NOT list `.env`.

### 0.5 Copy the SQLite DB from Railway to local (one-time)

This preserves story history, scoring, analytics snapshots, and platform post IDs. Without it, the local instance starts blind and might re-publish stories Railway already published.

Easiest path:

```bash
# On Railway (one-time):
railway run --service marvelous-curiosity -- bash -c "cp /data/pulse.db /tmp/pulse-export.db"
railway run --service marvelous-curiosity -- bash -c "cat /tmp/pulse-export.db" > D:\pulse-data\pulse.db
```

Or use the existing backup tooling:

```bash
railway run --service marvelous-curiosity -- npm run ops:db:backup-dry-run
# Then download the backup file via Railway dashboard → Volumes → /data
```

Verify: `sqlite3 D:\pulse-data\pulse.db "SELECT COUNT(*) FROM stories;"` — should match Railway's count.

### 0.6 Copy the tokens/ folder

`tokens/instagram_token.json`, `tokens/facebook_token.json`, `tokens/youtube_token.json`, `tokens/tiktok_token.json`. These are the persisted OAuth tokens. Same one-time copy:

```bash
railway run --service marvelous-curiosity -- bash -c "tar -cf /tmp/tokens.tar tokens/"
# Download via Railway dashboard, extract to repo root
```

---

## Phase 0.5 — Oracle Cloud Always-Free path (alternative to home PC)

**Skip this phase if you're going with the home PC option.** Otherwise, this replaces "your PC" with "an Oracle Cloud VM" everywhere later in the runbook.

### Why Oracle Always-Free

- **Free forever.** Not a 12-month trial. The "Always Free" tier is permanent as long as you stay within the quotas.
- **Generous quotas.** 4 vCPU + 24 GB RAM ARM (Ampere A1) instance, 200 GB block storage, 10 TB/mo bandwidth.
- **Real Linux, full root.** Same Ubuntu / Debian you'd use anywhere. ffmpeg installs natively. No provider lock-in.
- **Works for Pulse.** ffmpeg renders run in ~3 min on the ARM A1 quota — comparable to Railway.

### Why people warn about Oracle

- The signup requires a **credit card** for fraud verification. They state explicitly they don't auto-charge for Always-Free usage. Most people who get billed have either deployed a non-free resource by accident or exceeded the always-free quota. Stay within Always-Free and you stay £0.
- The Always-Free ARM capacity is **sometimes waitlisted** in popular regions. Pick `UK South` or `Germany Central` (Frankfurt). If full, try a less-popular region or retry over a few days.
- The console UX is busier than Railway's. One-time pain.

### 0.5.1 Sign up + provision

1. Go to https://www.oracle.com/cloud/free/ → "Start for Free"
2. Sign up with email + card. **Do NOT pick a paid tier or "Pay-as-you-go".** Stay on **"Always Free Eligible"** flagged resources only.
3. Once your tenancy is provisioned, navigate: Compute → Instances → Create instance.
4. Settings:
   - **Name:** `pulse-gaming`
   - **Image:** Ubuntu 22.04 (Always Free Eligible)
   - **Shape:** click "Change shape" → Ampere → `VM.Standard.A1.Flex`. Set OCPUs to 4, memory to 24 GB. **This is the always-free max — taking it all is fine since the limit is per-tenancy not per-instance.**
   - **Networking:** new VCN, public IP enabled.
   - **SSH key:** generate new locally with `ssh-keygen -t ed25519 -f ~/.ssh/oracle-pulse` and paste the `.pub` content.
5. Click "Create". Provisioning takes ~2 minutes.
6. Once running, note the **public IP**. SSH in: `ssh -i ~/.ssh/oracle-pulse ubuntu@<public-ip>`
7. Open inbound port 80 + 443 (for Cloudflare Tunnel — even though we don't NEED inbound ports, it doesn't hurt). Networking → Virtual Cloud Networks → your VCN → Security Lists → Add Ingress Rules: `0.0.0.0/0` TCP 80, 443.

### 0.5.2 Install dependencies

Once SSH'd in:

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ffmpeg git build-essential python3 python3-pip
# Node 20.x (Pulse Gaming's required runtime)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
# yt-dlp for the optional B-roll fallback
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
# Cloudflare Tunnel for the stable public URL
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
# Verify all binaries
ffmpeg -version | head -1
node --version
npm --version
yt-dlp --version
cloudflared --version
```

### 0.5.3 Clone the repo + bootstrap

```bash
# Choose your data directory — it persists in the 200 GB block volume
sudo mkdir -p /pulse-data/media
sudo chown -R ubuntu:ubuntu /pulse-data

# Clone
cd ~
git clone https://github.com/Orryy1/Pulse-Gaming-News.git pulse-gaming
cd pulse-gaming
npm install --production
```

### 0.5.4 Configure as a systemd service

Edit `~/pulse-gaming/.env` with all the secrets from your Railway dashboard (same content as the home-PC `.env` block in section 0.4 below, but with Linux paths):

```
MEDIA_ROOT=/pulse-data/media
SQLITE_DB_PATH=/pulse-data/pulse.db
DEPLOYMENT_MODE=local
PULSE_PRIMARY_INSTANCE=false   # ← still false during Phase 1
PULSE_PUBLIC_URL=https://pulse.your-domain.com
# … all other secrets per section 0.4
```

Create the systemd unit at `/etc/systemd/system/pulse-gaming.service`:

```ini
[Unit]
Description=Pulse Gaming Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/pulse-gaming
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/pulse-gaming.log
StandardError=append:/var/log/pulse-gaming.log

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
sudo touch /var/log/pulse-gaming.log
sudo chown ubuntu:ubuntu /var/log/pulse-gaming.log
sudo systemctl daemon-reload
sudo systemctl enable pulse-gaming
sudo systemctl start pulse-gaming
sudo systemctl status pulse-gaming
```

Same for Cloudflare Tunnel (after `cloudflared tunnel login` + `cloudflared tunnel create`):

```bash
sudo cloudflared service install <YOUR-TUNNEL-TOKEN>
sudo systemctl enable --now cloudflared
```

### 0.5.5 Verify

From your laptop:

```bash
curl https://pulse.your-domain.com/api/health | jq .deployment
# { mode: "local", primary: false, public_url: "https://pulse.your-domain.com", ... }
```

Same as the home-PC option. Continue with Phase 1.

### 0.5.6 Cost watch

Keep an eye on your Oracle billing dashboard for the first few days to confirm usage stays in the Always-Free meter. The instance + 200 GB block volume + 10 TB/mo bandwidth are all free forever; you'd only get charged if you accidentally provision a paid resource (don't click "upgrade", don't enable Object Storage above the free 20 GB, etc.). Set a Budget Alert at $1 to catch any surprise.

---

## Phase 1 — Run local in parallel as a MIRROR (zero risk)

Goal: prove the local instance can read state, render, and report — without it actually publishing. Railway stays primary.

In `.env`:

```
DEPLOYMENT_MODE=local
PULSE_PRIMARY_INSTANCE=false   # ← critical: this instance is observation-only
PULSE_PUBLIC_URL=https://pulse.your-domain.com
```

Start it:

```bash
cd C:\Users\MORR\gaming-studio\pulse-gaming
node server.js
```

Verify:

1. `curl http://localhost:3001/api/health` returns `deployment.mode = "local"`, `deployment.primary = false`
2. Discord posts from this instance (if any) prefix with `[MIRROR]`
3. The scheduler still registers but `PULSE_PRIMARY_INSTANCE=false` means produce/publish handlers should refuse to run (we'll honour this in code-path #4 below)

Run for 24 hours alongside Railway. Compare the daily render-health digest from each — they should agree on which stories are in the queue.

**While in Phase 1, Railway is still doing all the actual work. Cost-saving hasn't kicked in yet.**

---

## Phase 2 — Disable Railway scheduler, keep Railway up as warm spare

In Railway dashboard, set:

```
PULSE_PRIMARY_INSTANCE=false
```

Restart Railway. Now Railway runs but doesn't fire scheduled jobs. The 32 schedules still exist; they just no-op for the primary check.

In your local `.env`, flip:

```
PULSE_PRIMARY_INSTANCE=true
```

Restart local. Local is now the primary scheduler.

Watch one full publish cycle (next 18:00 UTC produce → 19:00 UTC publish window). Things to verify:

- Local Discord posts WITHOUT `[MIRROR]` prefix → it's primary
- Story rendered locally (check file at `D:\pulse-data\media\output\final\<id>.mp4`)
- YouTube + IG + FB Card uploads land via local
- Railway is silent (no Discord posts, no scheduler activity)

If any platform fails uniquely from local (and didn't fail from Railway):

- IG/FB might reject because the `video_url` in their fetch points to your Cloudflare Tunnel hostname which they may not have seen before. **Solution:** re-test the OAuth flow from the new public URL once: visit `https://pulse.your-domain.com/auth/facebook` to refresh the token. (This is the one OAuth-touching step that needs your hand on it.)
- YouTube uses uploaded binary, no public URL dependency — should "just work".
- TikTok is externally blocked anyway (per audit).

If anything breaks irrecoverably, flip back: set `PULSE_PRIMARY_INSTANCE=true` on Railway, `=false` on local, restart both. ~30 second rollback.

**Cost so far:** still paying Railway full price during Phase 2. Monitoring window is the cost.

---

## Phase 3 — Stop the Railway service (cost saving kicks in)

Once Phase 2 has run cleanly for 48–72 hours:

1. In Railway dashboard, click the marvelous-curiosity service → Settings → **Pause / Stop**.
2. Railway billing meter pauses. Your data on the persistent volume is preserved (Railway charges a small fee for paused storage but it's cents/month vs the £60/mo for active compute).
3. Verify local is still the only active publisher. Watch a daily produce cycle.

**Cost from this point:** ~£0–5/mo Railway storage + ~£10/mo extra electricity for your PC running 24/7. Down from £60+/mo.

---

## Phase 4 — Switch back to Railway when monetised

When the channel earns enough to justify £60/mo:

1. Restart the Railway service. It boots from the persisted volume; SQLite DB is intact.
2. Sync any new state from local back to Railway (latest `pulse.db`, `tokens/*`, recent media):
   ```bash
   # Export from local
   tar -cf D:\pulse-export.tar D:\pulse-data\pulse.db
   # Push to Railway via railway run + cat (or via the volume browser)
   ```
3. In Railway dashboard, set `PULSE_PRIMARY_INSTANCE=true`.
4. In local `.env`, set `PULSE_PRIMARY_INSTANCE=false` (keep local as warm mirror) OR shut down local entirely.
5. Verify next produce cycle fires from Railway.

The `DEPLOYMENT_MODE` stays as-is — Railway always reports `railway`, local always reports `local`. Only the `PRIMARY` flag determines which one fires jobs.

---

## Verification commands (run on either instance)

```bash
# Confirm which mode + primary state this instance is in
curl -s http://localhost:3001/api/health | jq .deployment

# Doctor scan (paths, binaries, env vars)
node tools/local-mode-doctor.js

# Full publish-readiness verdict
npm run ops:publish-readiness

# Render health for last 24h
npm run ops:render-health
```

---

## Rollback (any phase)

| Phase               | Rollback                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| 1 (mirror)          | Stop local server. Railway already running. Zero impact.                      |
| 2 (cutover)         | `PULSE_PRIMARY_INSTANCE=true` on Railway, `=false` on local. ~30s.            |
| 3 (Railway stopped) | Resume the Railway service in dashboard. ~2 min cold start. Phase 2 reversal. |
| 4 (back to Railway) | Symmetric. Stop Railway, restart local.                                       |

Every phase is reversible. Nothing in this runbook deletes data or revokes auth.

---

## Things this runbook intentionally does NOT touch

- Production Railway env vars — you do those by hand in the dashboard
- OAuth flows — you visit `/auth/facebook` etc once when ready
- Scheduler timing/frequency — the cron expressions stay identical, they just run on a different machine
- Platform upload behaviour — same uploaders, same code, same tokens
- Production DB rows — the SQLite copy is byte-identical; no row migration

If you want me to assist with any of those steps interactively, ask and I'll do it with you. I won't do them autonomously.

---

## Open questions to flag before Phase 2

1. **Domain for Cloudflare Tunnel.** You'll need a domain. Cheap option: ~£10/year for a `.com` from any registrar; or use the free `*.trycloudflare.com` pattern (test purposes only — URL changes per session).
2. **PC always-on rule.** If your PC sleeps, jobs miss. Set Windows Power Options → "Never sleep when plugged in".
3. **Internet reliability.** A 5-minute home internet outage during a publish window means the publish window misses. The job-queue retry logic recovers automatically once connectivity returns. Acceptable for an unmonetised channel; revisit when monetised.
4. **Backup story.** Snapshot `D:\pulse-data\pulse.db` weekly to OneDrive/Dropbox/etc. The `npm run ops:db:backup-dry-run` script can be wired into a Windows Task Scheduler entry.
