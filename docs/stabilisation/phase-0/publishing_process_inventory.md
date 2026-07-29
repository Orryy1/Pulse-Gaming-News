# Phase 0 Publishing Process Inventory

> **RED MULTIPLE-OWNER RISK.** This combines a static source inventory with bounded read-only runtime observations. It does not prove a single owner or complete child-process tree.

| metadata | value |
|---|---|
| generated_at | `2026-07-27T08:17:00.0885794Z` |
| source_commit_sha | `ed2745dd2cbeeb179ab54d47b8d380304baaf9e5` |
| runtime_commit_sha | `MISMATCH — local ec2ba4d98d3ee55f8c8999952cde5b378168e0c1; public 2c7f47c5f6e7544f4a16ef7e5b4d3df1ffc7cf10` |
| environment | `LOCAL_PROOF release worktree plus read-only local :3001, Windows task, public Railway and GitHub metadata observations; no mutation` |
| scope | Source inventory plus bounded read-only process and task observations for entry points capable of reaching publication work |
| expires_at | `2026-08-03T08:17:00.0885794Z` |
| supersedes | `none — first canonical Phase 0 static publishing-process inventory` |
| superseded_by | `none` |
| authoritative | `false` |

After expiry, display **STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS**.

## Summary

The intended production path is the durable scheduler and job runner started from `server.js` or `run.js`, gated by the runtime configuration and publication admission. Legacy in-process cron registries remain in both entry points for explicit local development compatibility. Multiple platform adapter scripts also exist.

A local `:3001` listener and four Pulse-named Windows tasks were observed. The local health endpoint reports scheduler and autonomous mode active. The live watchdog is explicitly publishing-capable and the OAuth task may mutate tokens, so ownership is not safely singular.

## Source entry points

| Path | Capability | Committed guard observed | Runtime state |
|---|---|---|---|
| `server.js` | HTTP server, queue bootstrap, scheduler and runner | production refuses legacy fallback; authenticated admission route | unknown |
| `run.js schedule` | queue scheduler and runner, or explicit legacy local-dev cron | runtime config validation and strict production queue path | unknown |
| `run.js publish` | legacy named pipeline mode | existence is not authority; effective downstream gates must still apply | unknown |
| `run.js full` | legacy complete-cycle mode | operating config is loaded first | unknown |
| `publisher.js` | production selection, scheduling and dispatch orchestration | committed admission, evidence and platform policy integrations | unknown |
| `upload_youtube.js` | YouTube adapter | governed admission and fingerprint checks in the committed release slice | unknown |
| `upload_tiktok.js` | TikTok adapter | platform policy is manual-only | unknown |
| `upload_instagram.js` | Instagram adapter | platform automation disabled by policy | unknown |
| Facebook/X helpers | secondary platform adapters or operational tools | automation disabled or frozen by policy | unknown |

## HTTP control paths

| Route | Static behaviour at source commit | Risk classification |
|---|---|---|
| `POST /api/publish` | spawns `node run.js produce`; despite the name it starts production, not direct upload | mutates local production state |
| `POST /api/autonomous/run` | returns `423` during stabilisation | blocked |
| `POST /api/autonomous/approve` | returns `423` during stabilisation | blocked |
| `POST /api/autonomous/publish` | returns `423`; requires guarded YouTube path | blocked |
| `POST /api/publication/admit` | records reviewed YouTube admission when all SQLite and evidence gates pass; does not upload | governed durable mutation |
| `POST /api/schedule` | returns `423`; legacy scheduling disabled | blocked |
| `POST /api/retry-publish` | returns `423`; directs post-create uncertainty to reconciliation | blocked |
| `POST /api/hunter/run` | can initiate discovery/production-side work | non-platform mutation |
| generation queue routes | append local image/video work | non-platform mutation |

Authentication and rate limiting are present on these operator routes, but no live authentication configuration was inspected.

## Scheduler models present in source

### Canonical production design

`lib/bootstrap-queue.js` starts `lib/scheduler.js` and the jobs runner. It requires SQLite, honours primary-instance rules and uses a durable scheduler lease. The stabilisation profile selects a reduced schedule set and enforces two publish windows per rolling 24 hours, a four-hour minimum gap and no catch-up.

### Legacy development model

`server.js` and `run.js` retain quarantined in-process cron registries when dispatch mode is explicitly `legacy_dev`. The committed production path is intended to make that branch unreachable.

The source design does not prove that a deployed runtime has the expected flags, only one replica or a healthy lease.

## Observed automation surfaces

| Observation | Schedule/state | Read-only classification |
|---|---|---|
| local listener PID `34536` | started `2026-07-26 19:59:11`; local health reports scheduler/autonomous active | process command, parent, lease and human owner remain unverified |
| `Orryy-PulseGaming` | daily 06:00, ready, last result success | `C:\Claude\orryy-expansion\agents\run_daily.py pulse_gaming`; research/brief/3–5 drafts, no direct publishing observed |
| `PulseGaming-GrowthAutopilot` | approximately every 30 minutes, ready, last result success | `tools/growth-autopilot.js`; reads database/reports and writes local artefacts, no external publishing observed |
| `PulseGaming-LiveWatchdog-Supervisor` | boot trigger, running, last result `267009` | `tools/local-live-watchdog.ps1`; live-publishing-capable, enforces local primary runtime/workers/tunnel and sets `AUTO_PUBLISH=true` plus queue mode |
| `PulseGaming-OAuthUptime` | approximately every six hours, ready, last result success | `tools/oauth-uptime-maintenance.js --refresh`; token-mutating with `allowTokenMutation=true` |

The Sleepy task observed alongside them was outside Pulse Gaming scope. No task or process was stopped, changed or triggered.

## Additional owners that remain unknown

This documentation pass did not fully inspect:

- complete Task Scheduler history and child-process trees
- local PowerShell or terminal sessions
- process supervisors
- Railway cron/services or replica count
- GitHub Actions with dispatch credentials
- third-party automation services
- platform-native scheduled posts
- mobile application drafts or scheduled posts

Each must be enumerated read-only before claiming one publishing owner.

## Required reconciliation

1. Capture every process command, PID, parent, start time and source path.
2. Capture provider services and replica counts.
3. List Windows tasks and external automations capable of invoking any path above.
4. Read scheduler lease, active schedules, queued publish jobs and running job attempts.
5. Map each owner to one approved responsibility.
6. Disable duplicates only through an explicitly approved change.
7. Re-run the inventory and record one authoritative owner.

## Decision

The repository contains a governed target architecture but the observed runtime surface has multiple potential owners. Status is **RED** until one scheduler, one queue and every publishing/token mutation action are reconciled.
