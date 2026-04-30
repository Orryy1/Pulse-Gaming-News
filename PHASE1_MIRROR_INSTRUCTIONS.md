# Phase 1 — Mirror Mode (Operator Instructions)

**Status:** Phase 1 approved by operator. Claude Code has NOT executed any of these — you run them yourself in a regular PowerShell window.

**Goal:** stand up a local Pulse Gaming process on this PC for 24 hours that:

- Reads the same DB state as Railway (one-time snapshot copy)
- Reports its own readiness/health endpoints
- **Does NOT publish anything**, anywhere
- **Does NOT fire scheduled jobs**
- Lets you compare its `/api/health` and `npm run ops:*` against Railway's

**Cost during Phase 1:** still £60/mo Railway. Phase 1 doesn't save money — it's the de-risk step before Phase 2 (the actual cutover).

---

## Three layers of safety in this config

The mirror runs with all three of these set:

| Flag                           | Effect                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `PULSE_PRIMARY_INSTANCE=false` | The deployment-mode helper reports `primary: false`. Discord posts (if any) carry `[MIRROR]` prefix.  |
| `AUTO_PUBLISH=false`           | Multi-platform uploads disabled. Even if a publish handler somehow fires, no platform upload happens. |
| `USE_JOB_QUEUE=false`          | The scheduler / job-runner does NOT start. No jobs fire automatically. Observation-only.              |

Three independent layers. Any one of them stops a publish.

**Do not flip these to anything else during Phase 1.** If you want to test what happens when one is wrong, do it after Phase 2 in a sandbox branch.

---

## Step 1 — Pick your local data folder

Pick a path with at least 5 GB free. Examples:

- `D:\pulse-data` (if you have a D drive)
- `C:\Users\MORR\pulse-data`
- `E:\pulse-data`

**Whatever you pick, use forward slashes in `.env` because Node parses paths cross-platform — Windows handles forward slashes fine.**

For the rest of this doc I'll write `D:/pulse-data` as the example. Substitute your actual choice everywhere.

In a PowerShell window, create the folder:

```powershell
New-Item -ItemType Directory -Force -Path "D:\pulse-data\media"
New-Item -ItemType Directory -Force -Path "D:\pulse-data\tokens"
```

---

## Step 2 — Add the Phase 1 lines to `.env`

Open `C:\Users\MORR\gaming-studio\pulse-gaming\.env` in any editor.

**Append these lines to the bottom of the file** (don't replace existing lines, don't reorder):

```
# --- Phase 1 mirror config (added 2026-04-30, remove to revert) ---
DEPLOYMENT_MODE=local
PULSE_PRIMARY_INSTANCE=false
AUTO_PUBLISH=false
USE_JOB_QUEUE=false
MEDIA_ROOT=D:/pulse-data/media
SQLITE_DB_PATH=D:/pulse-data/pulse.db
```

Substitute your `D:/pulse-data` with whatever you picked in Step 1.

**Important:**

- Do NOT change any existing line. The Phase 1 additions are purely new lines at the bottom.
- Do NOT remove the existing `RAILWAY_PUBLIC_URL=...` line — it stays as a reference.
- Do NOT add `PULSE_PUBLIC_URL` or `LOCAL_PUBLIC_URL` for Phase 1. The mirror runs on `localhost:3001` only and doesn't need a public URL because it doesn't publish.

Save the file.

---

## Step 3 — Verify the doctor still reports GREEN with the new lines

In a regular PowerShell (NOT inside Claude Code, since Claude Code's wrapper would inject `ANTHROPIC_API_KEY=""`):

```powershell
cd C:\Users\MORR\gaming-studio\pulse-gaming
node -r dotenv/config tools/local-mode-doctor.js
```

Expected:

```
🟢 ✅ Local-mode prerequisites met. Safe to start `node server.js` here.

Deployment:
  • mode: local
  • primary: false
  • public_url: <your RAILWAY_PUBLIC_URL still>
  • media_root: D:/pulse-data/media
  • sqlite_db_path: D:/pulse-data/pulse.db
```

If it says `mode: local` and `primary: false`, the .env is wired correctly.

---

## Step 4 — One-time copy of production DB to local

This snapshot lets the mirror read the same story state Railway is publishing from. Railway's DB keeps evolving as it publishes; the mirror is fine being a few hours stale because it's never publishing.

The Railway CLI command pattern:

```powershell
cd C:\Users\MORR\gaming-studio\pulse-gaming

# 4a. From Railway, copy the SQLite file to the local PowerShell.
# This reads /data/pulse.db on Railway's persistent volume and pipes
# the bytes to a local file. NEVER mutates Railway.

railway run --service marvelous-curiosity -- bash -c "cat /data/pulse.db" > D:\pulse-data\pulse.db

# 4b. Verify the copy succeeded
node -e "const Database = require('better-sqlite3'); const db = new Database('D:/pulse-data/pulse.db', { readonly: true }); console.log('story count:', db.prepare('SELECT COUNT(*) AS n FROM stories').get().n);"
```

Expected: prints something like `story count: 73` — should match what production has.

If `railway run` complains "command not found", install the Railway CLI: `npm install -g @railway/cli` then `railway login`.

If the file ends up tiny (< 1 MB), the pipe was corrupted — try again. SQLite files for Pulse are typically 5-50 MB.

---

## Step 5 — One-time copy of production tokens

`tokens/` holds OAuth tokens for YouTube, Facebook, Instagram, TikTok. The mirror needs these to read its own auth state, BUT since `AUTO_PUBLISH=false` it won't actually post anywhere.

```powershell
# 5a. Tar up the tokens/ folder on Railway
railway run --service marvelous-curiosity -- bash -c "tar -cf - tokens/ 2>/dev/null" > D:\pulse-data\tokens-snapshot.tar

# 5b. Extract locally — extracts to current working dir
cd D:\pulse-data
tar -xf tokens-snapshot.tar

# 5c. Move into the repo so the local server finds them
Copy-Item -Force -Recurse D:\pulse-data\tokens\* C:\Users\MORR\gaming-studio\pulse-gaming\tokens\
Remove-Item D:\pulse-data\tokens-snapshot.tar
```

Verify:

```powershell
Get-ChildItem C:\Users\MORR\gaming-studio\pulse-gaming\tokens\
```

Expected output includes some/all of: `instagram_token.json`, `facebook_token.json`, `youtube_token.json`, `tiktok_token.json`.

---

## Step 6 — Start the mirror

In a fresh PowerShell window (NOT inside Claude Code, NOT in WSL — a regular Windows PowerShell session reading the `.env`):

```powershell
cd C:\Users\MORR\gaming-studio\pulse-gaming
node server.js
```

You should see startup logs like:

```
[server] Pulse Gaming Command Centre v2 running on http://localhost:3001
[bootstrap-queue] up: scheduler=false runner=false ...      ← KEY: scheduler=false because USE_JOB_QUEUE=false
[scheduler] not started (USE_JOB_QUEUE != true)
[Bot] Logged in as Pulse Gaming Bot#2338
```

The Discord bot will probably log in (same token as Railway). **That's fine — the bot doesn't post on its own without a slash command, and no schedule fires because `USE_JOB_QUEUE=false`.**

If you see `[scheduler] registered 32 schedules` — STOP. Check that `USE_JOB_QUEUE=false` is in `.env` and there's no override.

---

## Step 7 — Verify mirror is in observation mode

In another PowerShell window (you can use Claude Code or any terminal):

```powershell
curl http://localhost:3001/api/health | ConvertFrom-Json | Select-Object -ExpandProperty deployment
```

Expected:

```
mode             : local
primary          : False
public_url       : https://marvelous-curiosity-production.up.railway.app   # ← still pointing at Railway, that's fine
media_root       : D:/pulse-data/media
sqlite_db_path   : D:/pulse-data/pulse.db
```

Confirm:

- `mode: local` ✓
- `primary: False` ✓ — this is THE critical safety flag
- `media_root` and `sqlite_db_path` match what's in `.env` ✓

Try the readiness report:

```powershell
npm run ops:publish-readiness
```

Expected: a green/amber verdict from the local instance based on the local DB snapshot.

Try the news endpoint to confirm it's reading the local DB:

```powershell
curl http://localhost:3001/api/news?token=<YOUR_API_TOKEN> | ConvertFrom-Json | Measure-Object | Select-Object -ExpandProperty Count
```

(Or simply skip auth in dev — the news endpoint should work.)

Compare to Railway:

```powershell
curl https://marvelous-curiosity-production.up.railway.app/api/news?token=<YOUR_API_TOKEN> | ConvertFrom-Json | Measure-Object | Select-Object -ExpandProperty Count
```

The two counts should be identical (or close — Railway might have ingested 1-2 new stories since your snapshot).

---

## Step 8 — 24-hour observation window

Leave the local `node server.js` process running in its PowerShell window. **DO NOT** close that window — closing it stops the mirror.

Throughout the next 24 hours, **periodically (every few hours)** run these checks from another window:

```powershell
# 1. Confirm mirror is alive + still in observation mode
curl http://localhost:3001/api/health | ConvertFrom-Json | Select-Object -ExpandProperty deployment

# 2. Local readiness verdict
npm run ops:publish-readiness

# 3. Local render-health (24h window)
npm run ops:render-health

# 4. Compare against Railway
curl https://marvelous-curiosity-production.up.railway.app/api/health | ConvertFrom-Json | Select-Object commit_sha, autonomousMode, schedulerActive
```

### Things to watch for

| Signal                | Healthy                                        | Concerning                                                        |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Local mode/primary    | `mode=local, primary=False`                    | Anything else — stop immediately                                  |
| Discord posts         | Mirror posts (if any) prefixed with `[MIRROR]` | A `[MIRROR]` post claiming a publish actually happened — escalate |
| Local CPU/RAM         | Low/idle                                       | Constant 100% CPU — may indicate a runaway loop                   |
| Railway primary check | Discord deploys as normal, scheduled jobs fire | Railway falls silent — call me, something's odd                   |
| Railway publishes     | Continue at 19:00 UTC daily                    | Stop — but this would be a separate issue                         |

### Specifically NOT expected during Phase 1

- ❌ No new MP4s should appear in `D:/pulse-data/media/output/final/` (no produce fires)
- ❌ No platform_posts rows added to local DB (no publish fires)
- ❌ No Discord post saying "Pulse Gaming Published" with `[MIRROR]` prefix

If you see any of those — **stop the mirror immediately** (Ctrl+C in its PowerShell window) and tell me what you saw.

---

## Step 9 — Rollback (if anything misbehaves at any point)

```powershell
# Stop the mirror
# In its PowerShell window: press Ctrl+C
# Or from another window:
Get-Process node | Where-Object { $_.MainWindowTitle -like "*server.js*" } | Stop-Process

# Optionally clear the Phase 1 lines from .env
# Open .env, remove the block beginning "# --- Phase 1 mirror config"
# Save

# Verify the doctor reverts to the railway-mode default
node -r dotenv/config tools/local-mode-doctor.js
# Expected: mode=railway, primary=true (because RAILWAY_PUBLIC_URL is set)
```

Railway is untouched throughout. Zero rollback needed on the production side.

---

## Step 10 — After 24 hours

When the observation window completes:

1. Run all four ops commands one more time and capture output.
2. If everything looks healthy, reply to me:
   - **"Phase 1 healthy — proceed to Phase 2"** — I'll write Phase 2 instructions (the actual cutover that touches Railway env + saves £60/mo)
   - **"Phase 1 saw issue X — pause"** — I'll diagnose with you, no further migration steps
   - **"Stopping migration here, stay on Railway"** — I close the migration track

---

## Quick FAQ

**Q: Will the mirror cost me anything during the 24h?**
A: No. With `USE_JOB_QUEUE=false`, no jobs fire — no Anthropic calls, no ElevenLabs TTS, no Steam/IGDB downloads. The mirror is purely an Express server reading from the local DB snapshot. Marginal cost ≈ £0.

**Q: Why three safety flags? Isn't one enough?**
A: Defence in depth. Each flag stops publishing on its own. Three together means no single typo or env-mishap can cause an accidental publish. The audit's "do not burn auto-publish on heuristics" guidance applies here.

**Q: Will my Discord get spammed by the mirror?**
A: No. With `USE_JOB_QUEUE=false`, no scheduled jobs fire, so no Discord posts. The Discord bot will log in (same token) but it only posts when a slash command is invoked. **Don't invoke slash commands at the mirror's bot during Phase 1.**

**Q: Does the mirror read the same Railway DB live?**
A: No — the mirror reads a SNAPSHOT copy at `D:/pulse-data/pulse.db`. Railway's `/data/pulse.db` keeps evolving. They drift apart over the 24h window. That's expected and fine — the mirror is observing, not synchronising.

**Q: What if Railway deploys a new commit during the 24h?**
A: That's fine. Both Railway and the mirror are on the same git branch. Railway redeploys; the mirror keeps running on whatever commit was checked out when you started `node server.js`. No conflict.

**Q: Can I run `npm run ops:control-room` against the mirror?**
A: Yes. All read-only ops commands work. They read local DB + local env. They never write anywhere.

**Q: What if I close the mirror's PowerShell window by accident?**
A: The local `node server.js` process dies. No data lost (DB snapshot still on disk). Just re-run Step 6 in a new window. Railway stays primary throughout.

---

## What I will NOT do during Phase 1

- ❌ Execute any of the commands above (operator does Steps 1-7)
- ❌ Write to `.env` (operator pastes the new lines)
- ❌ Touch Railway env vars
- ❌ Trigger OAuth flows
- ❌ Start the local server myself
- ❌ Trigger a publish or produce manually
- ❌ Modify the production DB

I'll only respond to your observations, run read-only diagnostics, or write follow-up reports if you ask.
