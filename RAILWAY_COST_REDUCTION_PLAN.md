# Railway Cost Reduction Plan

**Date:** 2026-04-30
**Source data:** Railway invoices `ZFWE4ORR-0002` + `Receipt 2490-8054`
**Status:** plan only. **DO NOT CUT OVER UNTIL PHASE 1 MIRROR PASSES.**

---

## Current Railway monthly cost

| Item                | USD                | % of bill |
| ------------------- | ------------------ | --------- |
| **Gross**           | **$86.38**         | 100%      |
| Less prepaid credit | -$5.00             |           |
| **Charged**         | **$81.38** (≈ £64) |           |

Cost drivers in the bill:

| Resource       | USD        | % of bill |
| -------------- | ---------- | --------- |
| vCPU           | **$44.76** | **51.8%** |
| Memory         | **$37.66** | **43.6%** |
| Network egress | $3.82      | 4.4%      |
| Disk / volume  | $0.14      | 0.2%      |
| **Total**      | **$86.38** | **100%**  |

### Conclusion: compute is the problem

**95.4% of the bill is compute (vCPU + memory).** Storage and bandwidth are essentially free at our scale. This means:

- Migrating to ANY non-Railway compute host (home PC, Oracle Always Free, anywhere) recovers ~$82/mo regardless of where the SQLite + media files live.
- The persistent volume on Railway can stay parked at $0.14/mo as a warm spare during migration without meaningful cost impact.
- Network egress at $3.82/mo is tiny and won't change materially when running locally (most outbound is platform uploads — same volume from any host).

**Annual rate:** $86.38 × 12 = **$1,036/year (≈ £815/year)** for an unmonetised channel. This is the headline number that makes migration worth doing.

---

## Expected savings — Option A: home PC

Marginal compute cost on a PC that's already powered on for development:

| Resource       | Cost                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| vCPU + memory  | $0 (existing hardware)                                                        |
| Network egress | $0 (existing broadband)                                                       |
| Disk           | $0 (existing disk)                                                            |
| Electricity    | ~£5–10/mo if PC runs 24/7 (else $0 marginal if only when you'd use it anyway) |

**Net savings:** **~$82/mo (≈ £64/mo)** if PC is on anyway. **~$70/mo** if the PC runs solely to host Pulse.

**Tradeoffs:** reliability tied to home power + internet. Job queue auto-recovers after outages but a 19:00 UTC publish window during a power cut would miss.

---

## Expected savings — Option B: Oracle Cloud Always Free

| Resource                                  | Cost                                  |
| ----------------------------------------- | ------------------------------------- |
| 4 vCPU + 24 GB RAM ARM Ampere A1 instance | **$0/mo forever** (Always Free quota) |
| 200 GB block storage                      | $0/mo (Always Free)                   |
| 10 TB/mo egress                           | $0/mo (Always Free)                   |
| Public IP                                 | $0/mo (Always Free)                   |

**Net savings:** **~$82/mo (≈ £64/mo).** Same as PC but without the electricity tail and without home-internet reliability risk.

**Tradeoffs:** signup requires a credit card (Oracle confirms they don't auto-charge for Always Free); ARM A1 capacity is occasionally waitlisted in popular regions; one-time setup is ~90 min vs ~5 min for PC.

---

## Comparison summary

| Path               | Setup time                      | Marginal cost/mo | Reliability | Recommended when                                  |
| ------------------ | ------------------------------- | ---------------- | ----------- | ------------------------------------------------- |
| Stay on Railway    | 0                               | **$81 paid**     | High        | Channel is monetised at >$100/mo profit           |
| Home PC            | ~5 min remaining (Phase 0 done) | $0–10            | Medium      | PC is on anyway; you're patient with outages      |
| Oracle Always Free | ~90 min                         | **$0**           | High        | Channel unmonetised AND PC-availability uncertain |

**Today's recommendation:** **start with home PC** because Phase 0 is GREEN and you already have all the infrastructure. If reliability becomes an issue once running, migrate to Oracle (Phase 4 below) — the same `lib/deployment-mode.js` switch + the same runbook works for both.

---

## Migration phases (each is independently rollback-able)

### Phase 1 — Mirror mode (NO cost saving yet)

**Status:** approved, instructions in `PHASE1_MIRROR_INSTRUCTIONS.md`. Ready for operator to execute.

**What happens:**

- Local PC runs a second Pulse Gaming process with `PULSE_PRIMARY_INSTANCE=false`, `AUTO_PUBLISH=false`, `USE_JOB_QUEUE=false`.
- Three independent safety layers prevent any accidental publish.
- Local instance reads a snapshot of production DB (one-time copy via `railway run`).
- Railway stays primary throughout; £60/mo bill unchanged.
- 24-hour observation window: compare local `/api/health` and `npm run ops:*` against Railway.

**Cost saving:** **$0/mo**. Phase 1 is validation only.

**Decision gate after 24h:** healthy → Phase 2. Issues → diagnose. Not confident → stop migration here.

### Phase 2 — Watched cutover

**Goal:** flip the primary scheduler from Railway to local. Both processes still running.

**What happens:**

- Local instance: flip `PULSE_PRIMARY_INSTANCE=true`, `AUTO_PUBLISH=true`, `USE_JOB_QUEUE=true` in local `.env`. Restart.
- Railway: in dashboard, set `PULSE_PRIMARY_INSTANCE=false`. Restart Railway.
- Now local fires the schedule; Railway is silent but warm.
- One OAuth-touching step: refresh FB/IG token via the local public URL (Cloudflare Tunnel `https://pulse.orryy.com` or similar). This is the only step that requires the operator's hand on the keyboard; I won't do it.
- Watch one full publish cycle (next 18:00 UTC produce → 19:00 UTC publish).

**Cost saving:** **partial** (~$10–20/mo). Railway's compute meter still ticks because the service is running, just not firing schedules. Full saving is Phase 3.

**Decision gate after 48–72h:** clean publishes locally → Phase 3. Issues → flip flags back, you're on Railway again in ~30s.

### Phase 3 — Pause Railway service (FULL cost saving kicks in)

**Goal:** stop paying for Railway compute.

**What happens:**

- In Railway dashboard: **Pause** or **Stop** the marvelous-curiosity service.
- Railway's vCPU + memory meters stop ticking.
- Persistent volume stays mounted (charges ~$0.14/mo for storage retention — preserves the DB + token snapshots in case you ever come back).
- Local instance continues as primary. £0/mo Railway compute from this point.

**Cost saving:** **$80+/mo (~£63/mo)**. Annual: ~£760 saved.

**Decision gate:** none — this is the steady state until either:

- (a) channel monetises and you want Railway back (see Phase 4 reverse), or
- (b) reliability is an issue and you want Oracle (see Phase 4 forward).

### Phase 4 — Optional Oracle migration

**Goal:** move from home PC to Oracle Always Free. Skip if PC reliability is fine.

**What happens:**

- Sign up Oracle Cloud free tier; provision Ampere A1 ARM VM (4 vCPU, 24 GB RAM).
- SSH in, install Node + ffmpeg + yt-dlp + cloudflared (commands in `LOCAL_DEPLOYMENT_RUNBOOK.md` §0.5).
- Clone repo, set up systemd service for `node server.js`.
- Copy local SQLite + tokens to Oracle (same `cat`-pipe pattern as Phase 1).
- Set `PULSE_PRIMARY_INSTANCE=false` on home PC, `=true` on Oracle. Local PC becomes warm spare.
- Cloudflare Tunnel re-points at Oracle's IP (one operator step).

**Cost saving:** $0 marginal vs Phase 3 (both are free). Mainly a reliability upgrade — datacentre power + internet vs home power + internet.

**Tradeoffs:** more moving parts; requires Oracle account hygiene to stay in always-free tier.

---

## Rollback plan (any phase)

| Phase                    | Rollback                                                                                                                             | Time    | Production impact                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------- |
| Phase 1 (mirror)         | Ctrl+C the local `node server.js` window. Optionally remove the 6 Phase 1 lines from `.env`.                                         | ~10 sec | Zero — Railway untouched throughout.                 |
| Phase 2 (cutover)        | In Railway dashboard set `PULSE_PRIMARY_INSTANCE=true`. In local `.env` set `=false`. Restart both.                                  | ~30 sec | One missed publish window at most.                   |
| Phase 3 (Railway paused) | In Railway dashboard click **Resume**. Railway warm-boots in ~2 min and resumes scheduler. Set local `PULSE_PRIMARY_INSTANCE=false`. | ~2 min  | Possible 1-hour publish window miss during the boot. |
| Phase 4 (Oracle)         | Reverse migration: copy data back to PC or Railway, flip flags. ~30 min if practiced.                                                | ~30 min | One missed publish window.                           |

**At every phase, rollback is reversible. Nothing in this plan deletes data, revokes auth, or burns OAuth tokens.**

---

## What this plan does NOT recommend

- ❌ **Immediate cutover.** Phase 1 mirror MUST pass 24h observation before Phase 2.
- ❌ **Stopping Railway today.** Until Phase 2 has run cleanly for 48–72h, Railway stays primary.
- ❌ **Skipping Phase 1.** The single biggest risk in this migration is "I thought it would work locally and it didn't" — Phase 1 closes that risk for £0.
- ❌ **Touching OAuth tokens before Phase 2.** Tokens stay where they are during Phase 1.
- ❌ **Manually triggering publishes from local during Phase 1.** The mirror is observation-only.
- ❌ **Concurrent primary instances.** At any moment, exactly one instance has `PULSE_PRIMARY_INSTANCE=true` — never zero, never two.

---

## Decision needed (after Phase 1 24h window)

When you've completed Phase 1, reply with:

- **"Phase 1 healthy — proceed to Phase 2"** → I write Phase 2 step-by-step (touches Railway env, requires explicit approval per step).
- **"Phase 1 saw issue X"** → I diagnose with you, no further migration moves.
- **"Stop migration here, stay on Railway"** → I close the track. We pick this back up if the channel monetises.

---

## Annualised summary

| Scenario           | Annual cost | Annual saving vs Railway |
| ------------------ | ----------- | ------------------------ |
| Stay on Railway    | ~£815       | —                        |
| Home PC            | ~£60–120    | **~£695–755**            |
| Oracle Always Free | ~£0         | **~£815**                |

For an unmonetised channel, that's the difference between a noticeable monthly burn and effectively zero. Worth the ~5 minutes of Phase 1 setup once you have a free hour.
